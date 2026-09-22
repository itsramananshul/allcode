import { spawn } from "node:child_process"
import type { Invocation, ProcessResult } from "./types.js"

const MAX_CAPTURE_BYTES = 8 * 1024 * 1024

function appendBounded(current: string, chunk: Buffer): string {
  const next = current + chunk.toString("utf8")
  return Buffer.byteLength(next) <= MAX_CAPTURE_BYTES
    ? next
    : next.slice(next.length - MAX_CAPTURE_BYTES)
}

function terminateTree(pid: number | undefined): void {
  if (!pid) return
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    })
    killer.unref()
    return
  }
  try {
    process.kill(-pid, "SIGTERM")
  } catch {
    try { process.kill(pid, "SIGTERM") } catch { /* already exited */ }
  }
}

export async function runProcess(
  invocation: Invocation,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const started = Date.now()
  let stdout = ""
  let stderr = ""
  let timedOut = false

  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    })

    const abort = () => terminateTree(child.pid)
    signal?.addEventListener("abort", abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      abort()
    }, timeoutMs)

    child.stdout.on("data", (chunk: Buffer) => { stdout = appendBounded(stdout, chunk) })
    child.stderr.on("data", (chunk: Buffer) => { stderr = appendBounded(stderr, chunk) })
    child.on("error", (error) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      reject(error)
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolve({
        exitCode: code ?? (signal?.aborted ? 130 : 1),
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut,
      })
    })

    if (invocation.stdin !== undefined) child.stdin.end(invocation.stdin)
    else child.stdin.end()
  })
}
