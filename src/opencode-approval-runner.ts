import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { randomUUID } from "node:crypto"
import type { ApprovalHandler } from "./approval-broker.js"
import type { Invocation, ProcessResult, RunRequest } from "./types.js"

interface PendingPermission {
  id: string
  sessionID: string
  permission?: string
  action?: string
  patterns?: string[]
  resources?: string[]
  metadata?: Record<string, unknown>
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Unable to choose an OpenCode server port")
  const port = address.port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

export async function runOpenCodeWithApprovals(
  invocation: Invocation,
  request: RunRequest,
  handler: ApprovalHandler,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const started = Date.now()
  const port = await availablePort()
  const password = randomUUID()
  const base = `http://127.0.0.1:${port}`
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const headers = { Authorization: authorization, "Content-Type": "application/json" }
  const env = { ...process.env, ...invocation.env, OPENCODE_SERVER_PASSWORD: password }
  const server = spawn(invocation.command, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: request.cwd,
    env,
    windowsHide: true,
    stdio: "ignore",
  })
  let startupError: Error | undefined
  server.once("error", (error) => { startupError = error })
  const abort = new AbortController()
  const forwardAbort = () => abort.abort()
  signal?.addEventListener("abort", forwardAbort, { once: true })
  const api = async (path: string, method = "GET", body?: unknown): Promise<unknown> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok) throw new Error(`OpenCode server ${method} ${path}: HTTP ${response.status}`)
    return response.status === 204 ? undefined : await response.json()
  }

  try {
    let ready = false
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (startupError) throw startupError
      if (server.exitCode !== null || abort.signal.aborted) throw new Error("OpenCode approval server exited before startup")
      try { await api("/global/health"); ready = true; break } catch { /* still starting */ }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    if (!ready) throw new Error("OpenCode approval server did not become ready")

    const directory = `?directory=${encodeURIComponent(request.cwd)}`
    const sessionID = request.sessionId ?? (await api(`/session${directory}`, "POST", {}) as { id: string }).id
    if (!sessionID?.startsWith("ses")) throw new Error("OpenCode did not return a session ID")
    const before = await api(`/session/${encodeURIComponent(sessionID)}/message${directory}`) as Array<{ info: { id: string } }>
    const seenMessages = new Set(before.map((message) => message.info.id))
    const handled = new Set<string>()
    let deniedCount = 0
    const reply = async (permission: PendingPermission, version: "v1" | "v2"): Promise<void> => {
      if (handled.has(permission.id)) return
      handled.add(permission.id)
      const approved = await handler({
        toolName: permission.action ?? permission.permission ?? "OpenCode action",
        input: { resources: permission.resources ?? permission.patterns ?? [], ...permission.metadata },
      })
      if (!approved) deniedCount += 1
      if (version === "v2") {
        await api(`/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(permission.id)}/reply`, "POST", { reply: approved ? "once" : "reject" })
      } else {
        await api(`/permission/${encodeURIComponent(permission.id)}/reply${directory}`, "POST", { reply: approved ? "once" : "reject" })
      }
    }
    const model = request.model?.split("/")
    await api(`/session/${encodeURIComponent(sessionID)}/prompt_async${directory}`, "POST", {
      ...(model && model.length > 1 ? { model: { providerID: model[0], modelID: model.slice(1).join("/") } } : {}),
      ...(request.effort ? { variant: request.effort } : {}),
      parts: [{ type: "text", text: request.prompt }],
    })

    while (!abort.signal.aborted && Date.now() - started < (request.timeoutMs ?? 30 * 60 * 1000)) {
      const v1 = await api(`/permission${directory}`) as PendingPermission[]
      for (const permission of v1.filter((item) => item.sessionID === sessionID)) await reply(permission, "v1")
      const v2 = await api(`/api/session/${encodeURIComponent(sessionID)}/permission`) as { data?: PendingPermission[] }
      for (const permission of v2.data ?? []) await reply(permission, "v2")

      const messages = await api(`/session/${encodeURIComponent(sessionID)}/message${directory}`) as Array<{
        info: { id: string; role: string; time?: { completed?: number }; finish?: string; error?: unknown }
        parts: Array<{ type: string; text?: string }>
      }>
      const latest = messages.filter((message) => message.info.role === "assistant" && !seenMessages.has(message.info.id)).at(-1)
      const status = await api(`/session/status${directory}`) as Record<string, unknown>
      if (latest?.info.error) throw new Error(`OpenCode response failed: ${JSON.stringify(latest.info.error)}`)
      if (latest?.info.time?.completed && !status[sessionID]) {
        const finalText = latest.parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim()
          || (deniedCount ? "Permission denied; OpenCode stopped without a text response." : "")
        if (!finalText) throw new Error("OpenCode completed without a text response")
        return {
          exitCode: 0,
          stdout: JSON.stringify({ type: "text", sessionID, part: { type: "text", text: finalText } }),
          stderr: "",
          durationMs: Date.now() - started,
          timedOut: false,
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error("OpenCode approval run was cancelled or timed out")
  } finally {
    abort.abort()
    signal?.removeEventListener("abort", forwardAbort)
    server.kill()
  }
}
