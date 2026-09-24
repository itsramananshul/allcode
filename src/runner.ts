import { getAdapter } from "./adapters.js"
import { resolveExecutable } from "./executable.js"
import { runProcess } from "./process-runner.js"
import { ApprovalBroker, type ApprovalHandler } from "./approval-broker.js"
import { runOpenCodeWithApprovals } from "./opencode-approval-runner.js"
import { runCodexWithApprovals } from "./codex-approval-runner.js"
import { HermesAcpRunner } from "./hermes-acp-runner.js"
import { findRegisteredAgent } from "./agent-registry.js"
import { runPlugin } from "./plugin-agent.js"
import type { AgentResult, RunRequest } from "./types.js"

export async function runAgent(request: RunRequest, signal?: AbortSignal, onApproval?: ApprovalHandler): Promise<AgentResult> {
  const registered = findRegisteredAgent(request.agent)
  if (registered?.protocol === "plugin") return await runPlugin(request, signal, onApproval)
  if (request.agent === "hermes" || registered?.protocol === "acp") {
    const acp = registered
      ? new HermesAcpRunner((value) => getAdapter(value.agent).buildInvocation(value, registered.command), registered.name)
      : new HermesAcpRunner()
    try {
      const result = await acp.run(request, onApproval, signal)
      if (result.exitCode !== 0) throw new Error(`${request.agent} failed: ${result.stderr.trim() || result.finalText || "turn did not complete"}`)
      return result
    } finally { await acp.close() }
  }
  const broker = onApproval && request.agent === "claude" ? new ApprovalBroker(onApproval) : undefined
  if (broker) await broker.start()
  try {
    const adapter = getAdapter(request.agent)
    const executable = resolveExecutable(request.agent)
    const invocation = adapter.buildInvocation(broker ? { ...request, approval: { port: broker.port, token: broker.token } } : request, executable)
    const result = request.agent === "opencode" && request.permissionMode === "ask" && onApproval
      ? await runOpenCodeWithApprovals(invocation, request, onApproval, signal)
      : request.agent === "codex" && request.permissionMode && onApproval
        ? await runCodexWithApprovals(invocation, request, onApproval, signal)
        : await runProcess(invocation, request.timeoutMs ?? 30 * 60 * 1000, signal)
    const parsed = adapter.parse(result)
    if (parsed.exitCode !== 0) {
      const detail = parsed.stderr.trim() || parsed.finalText || `exit code ${parsed.exitCode}`
      throw new Error(`${request.agent} failed: ${detail}`)
    }
    return parsed
  } finally {
    await broker?.close()
  }
}
