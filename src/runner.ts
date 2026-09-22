import { getAdapter } from "./adapters.js"
import { resolveExecutable } from "./executable.js"
import { runProcess } from "./process-runner.js"
import type { AgentResult, RunRequest } from "./types.js"

export async function runAgent(request: RunRequest, signal?: AbortSignal): Promise<AgentResult> {
  const adapter = getAdapter(request.agent)
  const executable = resolveExecutable(request.agent)
  const invocation = adapter.buildInvocation(request, executable)
  const result = await runProcess(invocation, request.timeoutMs ?? 30 * 60 * 1000, signal)
  const parsed = adapter.parse(result)
  if (parsed.exitCode !== 0) {
    const detail = parsed.stderr.trim() || parsed.finalText || `exit code ${parsed.exitCode}`
    throw new Error(`${request.agent} failed: ${detail}`)
  }
  return parsed
}
