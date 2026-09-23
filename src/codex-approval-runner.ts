import { spawn } from "node:child_process"
import { createInterface } from "node:readline"
import type { ApprovalHandler } from "./approval-broker.js"
import type { Invocation, ProcessResult, RunRequest } from "./types.js"

interface RpcMessage {
  id?: number | string
  method?: string
  params?: Record<string, unknown>
  result?: Record<string, unknown>
  error?: { message?: string }
}

export async function runCodexWithApprovals(
  invocation: Invocation,
  request: RunRequest,
  handler: ApprovalHandler,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const started = Date.now()
  const configuration: string[] = []
  for (let index = 0; index < invocation.args.length - 1; index += 1) {
    if (invocation.args[index] === "-c") configuration.push("-c", invocation.args[index + 1]!)
  }
  const child = spawn(invocation.command, ["app-server", "--stdio", ...configuration], {
    cwd: request.cwd,
    env: { ...process.env, ...invocation.env },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const lines = createInterface({ input: child.stdout })
  let nextId = 1
  let threadId = ""
  let turnId = ""
  let finalText = ""
  let stderr = ""
  const items = new Map<string, Record<string, unknown>>()
  let settled = false
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>()
  let resolveTurn!: () => void
  let rejectTurn!: (error: Error) => void
  const completed = new Promise<void>((resolve, reject) => { resolveTurn = resolve; rejectTurn = reject })
  void completed.catch(() => {})
  const send = (value: unknown): void => { child.stdin.write(`${JSON.stringify(value)}\n`) }
  const fail = (error: Error): void => {
    if (settled) return
    settled = true
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    rejectTurn(error)
  }
  const rpc = (method: string, params: unknown): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    send({ id, method, params })
  })
  const approval = async (message: RpcMessage): Promise<void> => {
    const params = message.params ?? {}
    const method = message.method ?? ""
    const isPermission = method === "item/permissions/requestApproval"
    const isCommand = method === "item/commandExecution/requestApproval" || method === "execCommandApproval"
    const isFile = method === "item/fileChange/requestApproval" || method === "applyPatchApproval"
    if (!isPermission && !isCommand && !isFile) {
      send({ id: message.id, error: { code: -32601, message: "All Code cannot answer this request" } })
      return
    }
    const fileItem = isFile && typeof params.itemId === "string" ? items.get(params.itemId) : undefined
    let approved = false
    try {
      approved = (!isFile || Array.isArray(fileItem?.changes)) && await handler({
        toolName: isPermission ? "Codex permission request" : isFile ? "Codex file change" : "Codex command",
        input: isCommand
          ? { command: params.command, cwd: params.cwd, reason: params.reason, network: params.networkApprovalContext }
          : isPermission ? { permissions: params.permissions, reason: params.reason, cwd: params.cwd }
            : { reason: params.reason, root: params.grantRoot, changes: fileItem?.changes },
      })
    } catch { /* deny on UI failure */ }
    if (isPermission) {
      send({ id: message.id, result: { permissions: approved ? params.permissions : {}, scope: "turn" } })
    } else if (method === "execCommandApproval") {
      send({ id: message.id, result: { decision: approved ? "approved" : { denied: { rejection: "Denied in All Code" } } } })
    } else if (method === "applyPatchApproval") {
      send({ id: message.id, result: { decision: approved ? "approved" : { denied: { rejection: "Denied in All Code" } } } })
    } else {
      send({ id: message.id, result: { decision: approved ? "accept" : "decline" } })
    }
  }
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as RpcMessage
      if (message.method && message.id !== undefined) { void approval(message); return }
      if (typeof message.id === "number") {
        const entry = pending.get(message.id)
        if (!entry) return
        pending.delete(message.id)
        if (message.error) entry.reject(new Error(message.error.message ?? "Codex RPC error"))
        else entry.resolve(message.result ?? {})
        return
      }
      if (message.method === "item/started") {
        const item = message.params?.item as Record<string, unknown> | undefined
        if (item && typeof item.id === "string") items.set(item.id, item)
      }
      if (message.method === "item/completed") {
        const item = message.params?.item as { type?: string; text?: string } | undefined
        if (item?.type === "agentMessage" && item.text) finalText = item.text
      }
      if (message.method === "turn/completed") {
        const params = message.params ?? {}
        const turn = params.turn as { id?: string; status?: string; error?: { message?: string } } | undefined
        if (params.threadId === threadId && (!turnId || turn?.id === turnId)) {
          if (turn?.status === "failed") fail(new Error(turn.error?.message ?? "Codex turn failed"))
          else { settled = true; resolveTurn() }
        }
      }
    } catch { /* diagnostics on stdout are not protocol messages */ }
  })
  child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000) })
  child.once("error", (error) => fail(error))
  child.once("exit", (code) => { if (!settled) fail(new Error(`Codex app-server exited before completion (${code ?? "unknown"}): ${stderr}`)) })
  const timeout = setTimeout(() => fail(new Error("Codex approval run timed out")), request.timeoutMs ?? 30 * 60 * 1000)
  const onAbort = () => fail(new Error("Codex approval run cancelled"))
  signal?.addEventListener("abort", onAbort, { once: true })

  try {
    await rpc("initialize", {
      clientInfo: { name: "allcode", title: "All Code", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    })
    send({ method: "initialized" })
    const mode = request.permissionMode ?? "workspace-write"
    const sandbox = mode === "read-only" ? "read-only" : mode === "bypass" ? "danger-full-access" : "workspace-write"
    const approvalPolicy = mode === "never" || mode === "bypass" ? "never" : mode === "untrusted" ? "untrusted" : "on-request"
    const params = { cwd: request.cwd, sandbox, approvalPolicy, ...(request.model ? { model: request.model } : {}) }
    const thread = request.sessionId
      ? await rpc("thread/resume", { threadId: request.sessionId, ...params })
      : await rpc("thread/start", params)
    threadId = (thread.thread as { id?: string } | undefined)?.id ?? ""
    if (!threadId) throw new Error("Codex did not return a thread ID")
    const startedTurn = await rpc("turn/start", {
      threadId,
      input: [{ type: "text", text: request.prompt }],
      cwd: request.cwd,
      approvalPolicy,
      ...(request.effort ? { effort: request.effort } : {}),
      ...(request.model ? { model: request.model } : {}),
    })
    turnId = (startedTurn.turn as { id?: string } | undefined)?.id ?? ""
    await completed
    if (!finalText) throw new Error("Codex completed without a final message")
    return {
      exitCode: 0,
      stdout: JSON.stringify({ type: "agent_message", sessionId: threadId, text: finalText }),
      stderr,
      durationMs: Date.now() - started,
      timedOut: false,
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener("abort", onAbort)
    lines.close()
    child.kill()
  }
}
