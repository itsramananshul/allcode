import { extractFinalText, extractSessionId, parseJsonEvents } from "./parsers.js"
import type { AgentAdapter, AgentName, AgentResult, Invocation, ProcessResult, RunRequest } from "./types.js"

const safeToken = /^[A-Za-z0-9._:/@~-]{1,240}$/

function validateOptionalToken(label: string, value: string | undefined): void {
  if (value && !safeToken.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}

function childEnv(): NodeJS.ProcessEnv {
  const depth = Number.parseInt(process.env.AGENT_WORKBENCH_DEPTH ?? "0", 10) || 0
  const maxDepth = Number.parseInt(process.env.AGENT_WORKBENCH_MAX_DEPTH ?? "3", 10) || 3
  if (depth >= maxDepth) throw new Error(`Delegation depth ${depth} reached the configured maximum ${maxDepth}`)
  return { AGENT_WORKBENCH_DEPTH: String(depth + 1) }
}

abstract class BaseAdapter implements AgentAdapter {
  abstract readonly name: AgentName
  abstract readonly description: string
  abstract buildInvocation(request: RunRequest, executable: string): Invocation

  parse(result: ProcessResult): AgentResult {
    const events = parseJsonEvents(result.stdout)
    return {
      ...result,
      agent: this.name,
      sessionId: extractSessionId(events),
      finalText: extractFinalText(events, result.stdout),
      eventCount: events.length,
    }
  }
}

export class ClaudeAdapter extends BaseAdapter {
  readonly name = "claude" as const
  readonly description = "Claude Code through its supported non-interactive CLI"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    validateOptionalToken("model", request.model)
    validateOptionalToken("session ID", request.sessionId)
    const args = [
      "-p", "--output-format", "json",
      "--permission-mode", "acceptEdits",
      "--permission-prompts", "none",
    ]
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("--resume", request.sessionId)
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env: childEnv() }
  }
}

export class OpenCodeAdapter extends BaseAdapter {
  readonly name = "opencode" as const
  readonly description = "OpenCode with its own providers, Go membership, tools, agents, and permissions"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    validateOptionalToken("model", request.model)
    validateOptionalToken("session ID", request.sessionId)
    const args = ["run", "--format", "json", "--dir", request.cwd]
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("--session", request.sessionId)
    args.push(request.prompt)
    return { command: executable, args, cwd: request.cwd, env: childEnv() }
  }
}

export class CodexAdapter extends BaseAdapter {
  readonly name = "codex" as const
  readonly description = "Codex through its supported non-interactive CLI"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    validateOptionalToken("model", request.model)
    validateOptionalToken("session ID", request.sessionId)
    const args = ["exec", "--json", "--sandbox", "workspace-write", "-C", request.cwd, "--skip-git-repo-check"]
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("resume", request.sessionId, "-")
    else args.push("-")
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env: childEnv() }
  }
}

const adapters: Record<AgentName, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  opencode: new OpenCodeAdapter(),
  codex: new CodexAdapter(),
}

export function getAdapter(name: AgentName): AgentAdapter {
  return adapters[name]
}

export function listAdapters(): AgentAdapter[] {
  return Object.values(adapters)
}
