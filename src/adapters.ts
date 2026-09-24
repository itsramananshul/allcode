import { extractFinalText, extractSessionId, parseJsonEvents } from "./parsers.js"
import { delimiter } from "node:path"
import { fileURLToPath } from "node:url"
import { findRegisteredAgent, registeredAgents, type RegisteredAgent } from "./agent-registry.js"
import type { AgentAdapter, AgentName, AgentResult, Invocation, ProcessResult, RunRequest } from "./types.js"

const safeToken = /^[A-Za-z0-9._:/@~-]{1,240}$/

function validateOptionalToken(label: string, value: string | undefined): void {
  if (value && !safeToken.test(value)) throw new Error(`Invalid ${label}: ${value}`)
}

export function childEnv(agent: AgentName, cwd: string): NodeJS.ProcessEnv {
  const depth = Number.parseInt(process.env.ALL_CODE_DEPTH ?? "0", 10) || 0
  const maxDepth = Number.parseInt(process.env.ALL_CODE_MAX_DEPTH ?? "3", 10) || 3
  if (depth >= maxDepth) throw new Error(`Delegation depth ${depth} reached the configured maximum ${maxDepth}`)
  const configuredRoots = (process.env.ALL_CODE_ALLOWED_ROOTS ?? "").split(delimiter).filter(Boolean)
  const allowedRoots = [...new Set([...configuredRoots, cwd])].join(delimiter)
  return {
    ALL_CODE_DEPTH: String(depth + 1),
    ALL_CODE_MAX_DEPTH: String(maxDepth),
    ALL_CODE_HOST: agent,
    ALL_CODE_ALLOWED_ROOTS: allowedRoots,
  }
}

function bridgeCommand(): string {
  return fileURLToPath(new URL("./cli.js", import.meta.url))
}

function claudeBridge(agent: AgentName, cwd: string, approval?: RunRequest["approval"]): string {
  const env = childEnv(agent, cwd)
  if (approval) {
    env.ALL_CODE_APPROVAL_PORT = String(approval.port)
    env.ALL_CODE_APPROVAL_TOKEN = approval.token
  }
  return JSON.stringify({
    mcpServers: {
      allcode: {
        type: "stdio",
        command: process.execPath,
        args: [bridgeCommand(), "mcp"],
        env,
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
    const mode = request.permissionMode ?? "acceptEdits"
    if (!["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"].includes(mode)) {
      throw new Error(`Unsupported Claude Code permission mode: ${mode}`)
    }
    const args = [
      "-p", "--output-format", "json",
      "--permission-mode", mode,
      "--permission-prompts", request.approval ? "host" : "none",
      "--mcp-config", claudeBridge(this.name, request.cwd, request.approval),
    ]
    if (request.approval) args.push("--permission-prompt-tool", "mcp__allcode__approval_prompt")
    if (request.effort) args.push("--effort", request.effort)
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("--resume", request.sessionId)
    const env = childEnv(this.name, request.cwd)
    if (request.approval) {
      env.ALL_CODE_APPROVAL_PORT = String(request.approval.port)
      env.ALL_CODE_APPROVAL_TOKEN = request.approval.token
    }
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env }
  }
}

export class OpenCodeAdapter extends BaseAdapter {
  readonly name = "opencode" as const
  readonly description = "OpenCode with its own providers, Go membership, tools, agents, and permissions"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    validateOptionalToken("model", request.model)
    validateOptionalToken("session ID", request.sessionId)
    const args = ["run", "--format", "json", "--thinking", "--dir", request.cwd]
    const mode = request.permissionMode ?? "native"
    if (!["native", "ask", "auto", "deny"].includes(mode)) throw new Error(`Unsupported OpenCode permission mode: ${mode}`)
    if (mode === "auto") args.push("--auto")
    if (request.model) args.push("--model", request.model)
    if (request.effort) args.push("--variant", request.effort)
    if (request.sessionId) args.push("--session", request.sessionId)
    args.push(request.prompt)
    const nextEnv = childEnv(this.name, request.cwd)
    let existing: { mcp?: Record<string, unknown>; [key: string]: unknown } = {}
    if (process.env.OPENCODE_CONFIG_CONTENT) {
      try {
        existing = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) as typeof existing
      } catch {
        throw new Error("OPENCODE_CONFIG_CONTENT must contain valid JSON before AllCode can add its MCP broker")
      }
    }
    const allCodeMcp = {
      type: "local",
      command: [process.execPath, bridgeCommand(), "mcp"],
      enabled: true,
      environment: nextEnv,
    }
    const configuredPermissions = existing.permission && typeof existing.permission === "object"
      ? existing.permission as Record<string, unknown> : {}
    const { "*": wildcard, ...specificPermissions } = configuredPermissions
    nextEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...existing,
      ...(mode === "ask" ? { permission: existing.permission === "deny" ? "deny" : {
        "*": wildcard === "deny" ? "deny" : "ask",
        ...specificPermissions,
      } } : {}),
      ...(mode === "deny" ? { permission: { "*": "deny" } } : {}),
      mcp: { ...existing.mcp, allcode: allCodeMcp },
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
    if (request.permissionMode && !["read-only", "workspace-write", "untrusted", "never", "bypass"].includes(request.permissionMode)) {
      throw new Error(`Unsupported Codex permission mode: ${request.permissionMode}`)
    }
    const args = ["exec", "--json", "--sandbox", "workspace-write", "-C", request.cwd, "--skip-git-repo-check"]
    const nextEnv = childEnv(this.name, request.cwd)
    args.push(
      "-c", `mcp_servers.allcode.command=${JSON.stringify(process.execPath)}`,
      "-c", `mcp_servers.allcode.args=${JSON.stringify([bridgeCommand(), "mcp"])}`,
      "-c", `mcp_servers.allcode.env.ALL_CODE_HOST=${JSON.stringify(this.name)}`,
      "-c", `mcp_servers.allcode.env.ALL_CODE_ALLOWED_ROOTS=${JSON.stringify(request.cwd)}`,
      "-c", `mcp_servers.allcode.env.ALL_CODE_DEPTH=${JSON.stringify(nextEnv.ALL_CODE_DEPTH)}`,
    )
    if (request.effort) args.push("-c", `model_reasoning_effort=${JSON.stringify(request.effort)}`)
    if (request.model) args.push("--model", request.model)
    if (request.sessionId) args.push("resume", request.sessionId, "-")
    else args.push("-")
    return { command: executable, args, stdin: request.prompt, cwd: request.cwd, env: nextEnv }
  }
}

export class HermesAdapter extends BaseAdapter {
  readonly name = "hermes" as const
  readonly description = "Hermes Agent through its ACP server, with host approvals and native sessions"

  buildInvocation(request: RunRequest, executable: string): Invocation {
    return { command: executable, args: ["acp"], cwd: request.cwd, env: childEnv(this.name, request.cwd) }
  }
}

class RegisteredAdapter extends BaseAdapter {
  readonly name: AgentName
  readonly description: string

  constructor(private readonly registration: RegisteredAgent) {
    super()
    this.name = registration.name
    this.description = `${registration.label} through ${registration.protocol === "acp" ? "ACP" : "one-shot CLI"}`
  }

  buildInvocation(request: RunRequest): Invocation {
    validateOptionalToken("model", request.model)
    if (this.registration.protocol === "plugin") throw new Error("Plugin agents run through their registered module")
    if (this.registration.protocol === "acp") {
      return { command: this.registration.command, args: this.registration.args, cwd: request.cwd, env: childEnv(this.name, request.cwd) }
    }
    if (request.sessionId) throw new Error(`${this.name} is one-shot and does not support native session IDs`)
    if (request.effort) throw new Error(`${this.name} does not expose effort controls`)
    if (request.model && !this.registration.args.some((arg) => arg.includes("{model}"))) {
      throw new Error(`${this.name} needs a {model} placeholder in its registered arguments`)
    }
    const hasPromptArgument = this.registration.args.some((arg) => arg.includes("{prompt}"))
    const args = this.registration.args.map((arg) => arg.replaceAll("{prompt}", request.prompt).replaceAll("{model}", request.model ?? ""))
    return { command: this.registration.command, args, stdin: hasPromptArgument ? undefined : request.prompt, cwd: request.cwd,
      env: childEnv(this.name, request.cwd) }
  }

  parse(result: ProcessResult): AgentResult {
    if (this.registration.protocol === "acp") throw new Error("ACP results must use the ACP runner")
    return { ...result, agent: this.name, finalText: result.stdout.trim(), eventCount: 0 }
  }
}

const adapters: Record<AgentName, AgentAdapter> = {
  claude: new ClaudeAdapter(),
  opencode: new OpenCodeAdapter(),
  codex: new CodexAdapter(),
  hermes: new HermesAdapter(),
}

export function getAdapter(name: AgentName): AgentAdapter {
  if (Object.hasOwn(adapters, name)) return adapters[name]!
  const custom = findRegisteredAgent(name)
  if (custom) return new RegisteredAdapter(custom)
  throw new Error(`Unknown agent: ${name}`)
}

export function listAdapters(): AgentAdapter[] {
  return [...Object.values(adapters), ...registeredAgents().map((agent) => new RegisteredAdapter(agent))]
}
