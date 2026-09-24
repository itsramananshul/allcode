import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { getAdapter } from "./adapters.js"
import { ApprovalBroker, type ApprovalHandler } from "./approval-broker.js"
import { resolveExecutable } from "./executable.js"
import { activityDetail, record } from "./activity.js"
import type { ActivityHandler, AgentResult, Invocation, RunRequest } from "./types.js"

type InvocationFactory = (request: RunRequest) => Invocation

interface PendingTurn {
  started: number
  events: number
  stderr: string
  timer: NodeJS.Timeout
  resolve: (result: AgentResult) => void
  reject: (error: Error) => void
  onActivity?: ActivityHandler
  partialText: boolean
  partialReasoning: boolean
  seenTools: Set<string>
}

const defaultInvocation: InvocationFactory = (request) =>
  getAdapter("claude").buildInvocation(request, resolveExecutable("claude"))

function streamInvocation(invocation: Invocation): Invocation {
  const args = [...invocation.args]
  const outputFormat = args.indexOf("--output-format")
  if (outputFormat < 0 || !args[outputFormat + 1]) throw new Error("Claude invocation has no output format")
  args[outputFormat + 1] = "stream-json"
  args.push("--input-format", "stream-json", "--verbose", "--include-partial-messages")
  return { ...invocation, args, stdin: undefined }
}

function modeKey(request: RunRequest): string {
  return JSON.stringify([request.cwd, request.model ?? "", request.effort ?? "", request.permissionMode ?? ""])
}

export class ClaudeStreamRunner {
  private child?: ChildProcessWithoutNullStreams
  private broker?: ApprovalBroker
  private closeEvent?: Promise<void>
  private key?: string
  private sessionId?: string
  private pending?: PendingTurn
  private approvalHandler?: ApprovalHandler
  private lineBuffer = ""

  constructor(private readonly makeInvocation: InvocationFactory = defaultInvocation) {}

  async prepare(request: RunRequest): Promise<void> {
    if (request.agent !== "claude") throw new Error("ClaudeStreamRunner only accepts Claude requests")
    if (this.pending) throw new Error("A Claude turn is already running")
    if (!this.child || this.key !== modeKey(request) ||
        (request.sessionId && this.sessionId && request.sessionId !== this.sessionId)) {
      await this.close()
      await this.start(request)
    }
  }

  async run(request: RunRequest, onApproval: ApprovalHandler, signal?: AbortSignal, onActivity?: ActivityHandler): Promise<AgentResult> {
    const abort = (): void => { void this.close() }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      signal?.throwIfAborted()
      await this.prepare(request)
      signal?.throwIfAborted()
      this.approvalHandler = onApproval
      return await new Promise<AgentResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.fail(new Error("Claude turn timed out"))
          void this.close()
        }, request.timeoutMs ?? 30 * 60 * 1000)
        this.pending = { started: Date.now(), events: 0, stderr: "", timer, resolve, reject, onActivity, partialText: false, partialReasoning: false, seenTools: new Set() }
        const message = JSON.stringify({ type: "user", message: { role: "user", content: request.prompt } }) + "\n"
        this.child!.stdin.write(message, "utf8", (error) => {
          if (error) this.fail(error)
        })
      })
    } finally {
      signal?.removeEventListener("abort", abort)
    }
  }

  private async start(request: RunRequest): Promise<void> {
    const broker = new ApprovalBroker((approval) => this.approvalHandler?.(approval) ?? Promise.resolve(false))
    await broker.start()
    try {
      const invocation = streamInvocation(this.makeInvocation({
        ...request,
        approval: { port: broker.port, token: broker.token },
      }))
      const child = spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: { ...process.env, ...invocation.env },
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      })
      this.child = child
      this.broker = broker
      this.key = modeKey(request)
      this.sessionId = request.sessionId
      this.lineBuffer = ""
      const decoder = new StringDecoder("utf8")
      child.stdout.on("data", (chunk: Buffer) => { if (this.child === child) this.readLines(decoder.write(chunk)) })
      child.stdout.on("end", () => { if (this.child === child) this.readLines(decoder.end()) })
      child.stderr.on("data", (chunk: Buffer) => {
        if (this.child === child && this.pending) this.pending.stderr = (this.pending.stderr + chunk.toString("utf8")).slice(-8192)
      })
      child.on("error", (error) => { if (this.child === child) this.fail(error) })
      this.closeEvent = new Promise<void>((resolve) => {
        child.once("close", (code) => {
          if (this.child === child) {
            this.fail(new Error(`Claude stream exited${code === null ? "" : ` with code ${code}`}`))
            this.child = undefined
            this.key = undefined
          }
          resolve()
        })
      })
    } catch (error) {
      await broker.close()
      throw error
    }
  }

  private readLines(chunk: string): void {
    this.lineBuffer += chunk
    let newline: number
    while ((newline = this.lineBuffer.indexOf("\n")) >= 0) {
      const line = this.lineBuffer.slice(0, newline).trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      if (!line) continue
      let event: Record<string, unknown>
      try { event = JSON.parse(line) as Record<string, unknown> } catch { continue }
      const pending = this.pending
      if (!pending) continue
      pending.events += 1
      if (event.type === "stream_event") {
        const stream = record(event.event)
        const delta = record(stream.delta)
        if (stream.type === "content_block_delta" && delta.type === "text_delta" && typeof delta.text === "string") {
          pending.partialText = true
          pending.onActivity?.({ kind: "text", text: delta.text })
        } else if (stream.type === "content_block_delta" && delta.type === "thinking_delta" && typeof delta.thinking === "string") {
          pending.partialReasoning = true
          pending.onActivity?.({ kind: "reasoning", text: delta.thinking })
        } else if (stream.type === "content_block_start") {
          const block = record(stream.content_block)
          if (block.type === "tool_use") {
            const id = String(block.id ?? block.name ?? "tool")
            pending.seenTools.add(id)
            pending.onActivity?.({ kind: "tool", text: `Calling ${String(block.name ?? "tool")}` })
          }
        }
      } else if (event.type === "assistant") {
        const message = record(event.message)
        const content = Array.isArray(message.content) ? message.content : []
        for (const value of content) {
          const block = record(value)
          if (block.type === "text" && typeof block.text === "string" && !pending.partialText) pending.onActivity?.({ kind: "text", text: block.text })
          if (block.type === "thinking" && typeof block.thinking === "string" && !pending.partialReasoning) pending.onActivity?.({ kind: "reasoning", text: block.thinking })
          if (block.type === "tool_use") {
            const id = String(block.id ?? block.name ?? "tool")
            if (!pending.seenTools.has(id)) pending.onActivity?.({ kind: "tool", text: `Calling ${String(block.name ?? "tool")} · ${activityDetail(block.input)}` })
            pending.seenTools.add(id)
          }
        }
        pending.partialText = false
        pending.partialReasoning = false
      } else if (event.type === "user") {
        const content = record(event.message).content
        for (const value of Array.isArray(content) ? content : []) {
          const block = record(value)
          if (block.type === "tool_result") pending.onActivity?.({ kind: "tool", text: `Tool result · ${activityDetail(block.content)}` })
        }
      }
      if (event.type !== "result") continue
      clearTimeout(pending.timer)
      this.pending = undefined
      this.approvalHandler = undefined
      if (typeof event.session_id === "string") this.sessionId = event.session_id
      if (event.is_error === true) {
        pending.reject(new Error(typeof event.result === "string" ? event.result : "Claude returned an error"))
        continue
      }
      pending.resolve({
        agent: "claude",
        sessionId: this.sessionId,
        finalText: typeof event.result === "string" ? event.result.trim() : "",
        eventCount: pending.events,
        exitCode: 0,
        stdout: line,
        stderr: pending.stderr,
        durationMs: Date.now() - pending.started,
        timedOut: false,
      })
    }
    if (this.lineBuffer.length > 8 * 1024 * 1024) this.lineBuffer = this.lineBuffer.slice(-8192)
  }

  private fail(error: Error): void {
    const pending = this.pending
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending = undefined
    this.approvalHandler = undefined
    pending.reject(error)
  }

  async close(): Promise<void> {
    const child = this.child
    const broker = this.broker
    const closeEvent = this.closeEvent
    this.child = undefined
    this.broker = undefined
    this.closeEvent = undefined
    this.key = undefined
    this.sessionId = undefined
    this.approvalHandler = undefined
    this.fail(new Error("Claude stream closed"))
    if (child && child.exitCode === null) {
      child.stdin.end()
      let timer: NodeJS.Timeout | undefined
      const stopped = await Promise.race([
        closeEvent?.then(() => true) ?? Promise.resolve(false),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1500) }),
      ])
      if (timer) clearTimeout(timer)
      if (!stopped && child.exitCode === null) child.kill()
    }
    await broker?.close()
  }
}
