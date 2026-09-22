import { extractFinalText, extractSessionId, parseJsonEvents } from "./parsers.js"
import { fileURLToPath } from "node:url"
import type { AgentAdapter, AgentName, AgentResult, Invocation, ProcessResult, RunRequest } from "./types.js"

const safeToken = /^[A-Za-z0-9._:/@~-]{1,240}$/

function validateOptionalToken(label: string, value: string | undefined): void {
  if (value && !safeToken.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}

function childEnv(agent: AgentName, cwd: string): NodeJS.ProcessEnv {
  const depth = Number.parseInt(process.env.ALL_CODE_DEPTH ?? "0", 10) || 0
  const maxDepth = Number.parseInt(process.env.ALL_CODE_MAX_DEPTH ?? "3", 10) || 3
  if (depth >= maxDepth) throw new Error(`Delegation depth ${depth} reached the configured maximum ${maxDepth}`)
  return {
    ALL_CODE_DEPTH: String(depth + 1),
    ALL_CODE_HOST: agent,
    ALL_CODE_ALLOWED_ROOTS: cwd,
  }
}

function bridgeCommand(): string {
  return fileURLToPath(new URL("./cli.js", import.meta.url))
}

function claudeBridge(agent: AgentName, cwd: string): string {
  return JSON.stringify({
    mcpServers: {
      "all-code": {
        type: "stdio",
        command: process.execPath,
        args: [bridgeCommand(), "mcp"],
        env: childEnv(agent, cwd),
      },
    },
  })
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
      "--mcp-config", claudeBridge(this.name, request.cwd),
    ]
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("--resume", request.sessionId)
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env: childEnv(this.name, request.cwd) }
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
    const nextEnv = childEnv(this.name, request.cwd)
    const existing = process.env.OPENCODE_CONFIG_CONTENT
      ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) as { mcp?: Record<string, unknown>; [key: string]: unknown }
      : {}
    const allCodeMcp = {
      type: "local",
      command: [process.execPath, bridgeCommand(), "mcp"],
      enabled: true,
      environment: nextEnv,
    }
    nextEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...existing,
      mcp: { ...existing.mcp, "all-code": allCodeMcp },
    })
    return { command: executable, args, cwd: request.cwd, env: nextEnv }
  }
}

export class CodexAdapter extends BaseAdapter {
  readonly name = "codex" as const
  readonly description = "Codex through its supported non-interactive CLI"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    validateOptionalToken("model", request.model)
    validateOptionalToken("session ID", request.sessionId)
    const args = ["exec", "--json", "--sandbox", "workspace-write", "-C", request.cwd, "--skip-git-repo-check"]
    const nextEnv = childEnv(this.name, request.cwd)
    args.push(
      "-c", `mcp_servers.all-code.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.all-code.args=${JSON.stringify([bridgeCommand(), "mcp"])}`,
      "-c", `mcp_servers.all-code.env.ALL_CODE_HOST=${JSON.stringify(this.name)}`,
      "-c", `mcp_servers.all-code.env.ALL_CODE_ALLOWED_ROOTS=${JSON.stringify(request.cwd)}`,
      "-c", `mcp_servers.all-code.env.ALL_CODE_DEPTH=${JSON.stringify(nextEnv.ALL_CODE_DEPTH)}`,
    )
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("resume", request.sessionId, "-")
    else args.push("-")
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env: nextEnv }
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
