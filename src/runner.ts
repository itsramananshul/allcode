import { getAdapter } from "./adapters.js"
import { resolveExecutable } from "./executable.js"
import { runProcess } from "./process-runner.js"
import { ApprovalBroker, type ApprovalHandler } from "./approval-broker.js"
import { runOpenCodeWithApprovals } from "./opencode-approval-runner.js"
import { runCodexWithApprovals } from "./codex-approval-runner.js"
import type { AgentResult, RunRequest } from "./types.js"

export async function runAgent(request: RunRequest, signal?: AbortSignal, onApproval?: ApprovalHandler): Promise<AgentResult> {
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
