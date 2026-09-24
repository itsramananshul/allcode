export const agentNames = ["claude", "opencode", "codex", "hermes"] as const

export type AgentName = (typeof agentNames)[number] | (string & {})

export interface RunRequest {
  agent: AgentName
  prompt: string
  cwd: string
  model?: string
  sessionId?: string
  timeoutMs?: number
  effort?: string
  permissionMode?: string
  approval?: { port: number; token: string }
}

export interface Invocation {
  command: string
  args: string[]
  stdin?: string
  cwd: string
  env?: NodeJS.ProcessEnv
}

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  timedOut: boolean
}

export interface AgentResult extends ProcessResult {
  agent: AgentName
  sessionId?: string
  finalText: string
  eventCount: number
}

export type AgentActivity = { kind: "text" | "reasoning" | "tool" | "status"; text: string }
export type ActivityHandler = (activity: AgentActivity) => void

export type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface TaskRecord {
  id: string
  request: RunRequest
  state: TaskState
  createdAt: string
  startedAt?: string
  completedAt?: string
  result?: AgentResult
  error?: string
}

export interface AgentAdapter {
  readonly name: AgentName
  readonly description: string
  buildInvocation(request: RunRequest, executable: string): Invocation
  parse(result: ProcessResult): AgentResult
}
