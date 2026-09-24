import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { StringDecoder } from "node:string_decoder"
import { fileURLToPath } from "node:url"
import { getAdapter } from "./adapters.js"
import { type ApprovalHandler } from "./approval-broker.js"
import { resolveExecutable } from "./executable.js"
import type { AgentResult, Invocation, RunRequest } from "./types.js"

type InvocationFactory = (request: RunRequest) => Invocation

interface PendingRpc {
  resolve: (value: Record<string, unknown>) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

interface HermesModel {
  modelId?: unknown
  name?: unknown
  description?: unknown
}

export interface HermesModelState {
  availableModels: HermesModel[]
  currentModelId?: string
}

const defaultInvocation: InvocationFactory = (request) =>
  getAdapter("hermes").buildInvocation(request, resolveExecutable("hermes"))

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function rpcError(value: unknown): Error {
  const error = record(value)
  return new Error(typeof error.message === "string" ? error.message : "Hermes ACP request failed")
}

export class HermesAcpRunner {
  private child?: ChildProcessWithoutNullStreams
  private closeEvent?: Promise<void>
  private pending = new Map<number, PendingRpc>()
  private nextId = 0
  private lineBuffer = ""
  private stderr = ""
  private sessionId?: string
  private cwd?: string
  private model?: string
  private defaultModel?: string
  private mode?: string
  private models?: HermesModelState
  private collecting = false
  private chunks: string[] = []
  private events = 0
  private approvalHandler?: ApprovalHandler

  constructor(private readonly makeInvocation: InvocationFactory = defaultInvocation, private readonly agentName = "hermes") {}

  async prepare(request: RunRequest): Promise<void> {
    if (request.agent !== this.agentName) throw new Error(`ACP runner expected ${this.agentName}`)
    if (this.collecting) throw new Error("A Hermes turn is already running")
    if (!this.child || this.cwd !== request.cwd || (request.sessionId && this.sessionId !== request.sessionId)) {
      await this.close()
      await this.start(request)
    }
    const nextModel = request.model === "default" ? this.defaultModel : request.model
    if (nextModel && nextModel !== this.model) {
      await this.rpc("session/set_model", { sessionId: this.sessionId, modelId: nextModel }, 60_000)
      this.model = nextModel
    }
    const nextMode = request.permissionMode ?? "default"
    if (nextMode !== this.mode) {
      await this.rpc("session/set_mode", { sessionId: this.sessionId, modeId: nextMode }, 30_000)
      this.mode = nextMode
    }
    if (request.effort) throw new Error("Hermes ACP does not expose a per-session reasoning effort setting")
  }

  async listModels(request: RunRequest): Promise<HermesModelState> {
    await this.prepare(request)
    return this.models ?? { availableModels: [] }
  }

  async run(request: RunRequest, onApproval?: ApprovalHandler, signal?: AbortSignal): Promise<AgentResult> {
    const started = Date.now()
    const abort = (): void => {
      if (this.collecting) void this.rpc("session/cancel", { sessionId: this.sessionId }, 5_000).catch(() => {})
      void this.close()
    }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      signal?.throwIfAborted()
      await this.prepare(request)
      signal?.throwIfAborted()
      this.approvalHandler = onApproval
      this.collecting = true
      this.chunks = []
      this.events = 0
      const result = await this.rpc("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text: request.prompt }],
      }, request.timeoutMs ?? 30 * 60 * 1000)
      return {
        agent: this.agentName,
        sessionId: this.sessionId,
        finalText: this.chunks.join("").trim(),
        eventCount: this.events,
        exitCode: result.stopReason === "end_turn" ? 0 : 1,
        stdout: JSON.stringify(result),
        stderr: this.stderr,
        durationMs: Date.now() - started,
        timedOut: false,
      }
    } finally {
      signal?.removeEventListener("abort", abort)
      this.collecting = false
      this.approvalHandler = undefined
    }
  }

  private async start(request: RunRequest): Promise<void> {
    const invocation = this.makeInvocation(request)
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: { ...process.env, ...invocation.env },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child
    this.cwd = request.cwd
    this.stderr = ""
    this.lineBuffer = ""
    const decoder = new StringDecoder("utf8")
    child.stdout.on("data", (chunk: Buffer) => this.readLines(decoder.write(chunk)))
    child.stdout.on("end", () => this.readLines(decoder.end()))
    child.stderr.on("data", (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString("utf8")).slice(-8192) })
    child.on("error", (error) => this.failAll(error))
    this.closeEvent = new Promise<void>((resolve) => child.once("close", (code) => {
      this.failAll(new Error(`Hermes ACP exited${code === null ? "" : ` with code ${code}`}: ${this.stderr}`))
      if (this.child === child) this.child = undefined
      resolve()
    }))
    try {
      await this.rpc("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "allcode", version: "0.2.0" },
      }, 60_000)
      const bridge = fileURLToPath(new URL("./cli.js", import.meta.url))
      const env = invocation.env ?? {}
      const mcpServers = [{
        name: "allcode", command: process.execPath, args: [bridge, "mcp"],
        env: ["ALL_CODE_HOST", "ALL_CODE_ALLOWED_ROOTS", "ALL_CODE_DEPTH", "ALL_CODE_MAX_DEPTH"]
          .flatMap((name) => typeof env[name] === "string" ? [{ name, value: env[name] }] : []),
      }]
      const method = request.sessionId ? "session/load" : "session/new"
      const session = await this.rpc(method, {
        cwd: request.cwd, mcpServers,
        ...(request.sessionId ? { sessionId: request.sessionId } : {}),
      }, 120_000)
      this.sessionId = request.sessionId ?? (typeof session.sessionId === "string" ? session.sessionId : undefined)
      if (!this.sessionId) throw new Error("Hermes ACP did not return a session ID")
      const models = record(session.models)
      this.models = {
        availableModels: Array.isArray(models.availableModels) ? models.availableModels as HermesModel[] : [],
        currentModelId: typeof models.currentModelId === "string" ? models.currentModelId : undefined,
      }
      this.model = this.models.currentModelId
      this.defaultModel = this.models.currentModelId
      const modes = record(session.modes)
      this.mode = typeof modes.currentModeId === "string" ? modes.currentModeId : "default"
    } catch (error) {
      await this.close()
      throw error
    }
  }

  private rpc(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    if (!this.child) return Promise.reject(new Error("Hermes ACP is not running"))
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Hermes ACP ${method} timed out after ${Math.round(timeoutMs / 1000)} seconds`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, "utf8", (error) => {
        if (error && this.pending.delete(id)) { clearTimeout(timer); reject(error) }
      })
    })
  }

  private readLines(chunk: string): void {
    this.lineBuffer += chunk
    let newline: number
    while ((newline = this.lineBuffer.indexOf("\n")) >= 0) {
      const line = this.lineBuffer.slice(0, newline).trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      if (!line) continue
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { continue }
      if (message.method === "session/update") {
        const update = record(record(message.params).update)
        if (this.collecting) {
          this.events += 1
          const content = record(update.content)
          if (update.sessionUpdate === "agent_message_chunk" && content.type === "text" && typeof content.text === "string") {
            this.chunks.push(content.text)
          }
        }
        continue
      }
      if (message.method === "session/request_permission" && message.id !== undefined) {
        void this.answerPermission(message)
        continue
      }
      if (typeof message.id === "number") {
        const pending = this.pending.get(message.id)
        if (!pending) continue
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if (message.error) pending.reject(rpcError(message.error))
        else pending.resolve(record(message.result))
      }
    }
    if (this.lineBuffer.length > 8 * 1024 * 1024) this.lineBuffer = this.lineBuffer.slice(-8192)
  }

  private async answerPermission(message: Record<string, unknown>): Promise<void> {
    const params = record(message.params)
    const tool = record(params.toolCall)
    const options = Array.isArray(params.options) ? params.options.map(record) : []
    const name = typeof tool.title === "string" ? tool.title : "Hermes tool"
    let approved = false
    try { approved = await this.approvalHandler?.({ toolName: name, input: record(tool.rawInput) }) === true } catch { /* fail closed */ }
    const selected = approved
      ? options.find((option) => option.optionId === "allow_once" || option.kind === "allow_once")
      : options.find((option) => option.optionId === "deny" || option.kind === "reject_once")
    const outcome = selected && typeof selected.optionId === "string"
      ? { outcome: "selected", optionId: selected.optionId }
      : { outcome: "cancelled" }
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { outcome } })}\n`)
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  async close(): Promise<void> {
    const child = this.child
    const closeEvent = this.closeEvent
    this.child = undefined
    this.closeEvent = undefined
    this.sessionId = undefined
    this.models = undefined
    this.model = undefined
    this.defaultModel = undefined
    this.mode = undefined
    this.cwd = undefined
    this.failAll(new Error("Hermes ACP closed"))
    if (!child || child.exitCode !== null) return
    child.stdin.end()
    let timer: NodeJS.Timeout | undefined
    const stopped = await Promise.race([
      closeEvent?.then(() => true) ?? Promise.resolve(false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), 1500) }),
    ])
    if (timer) clearTimeout(timer)
    if (!stopped && child.exitCode === null) child.kill()
  }
}
