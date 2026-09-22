#!/usr/bin/env node
import { resolve } from "node:path"
import { executableStatus } from "./executable.js"
import { startMcpServer } from "./mcp-server.js"
import { isAgentName, startNativeWorkspace } from "./native-workspace.js"
import { runAgent } from "./runner.js"
import { agentNames, type AgentName } from "./types.js"

function usage(): never {
  console.error(`agent-workbench

Commands:
  workspace [--agent claude|opencode|codex] [--cwd PATH]
  agents
  run <claude|opencode|codex> [--cwd PATH] [--model ID] [--session ID] <prompt>
  mcp

Environment:
  AGENT_WORKBENCH_ALLOWED_ROOTS   Allowed MCP workspace roots (${process.platform === "win32" ? ";" : ":"}-separated)
  AGENT_WORKBENCH_MAX_DEPTH       Maximum nested delegation depth (default: 3)
  AGENT_WORKBENCH_*_COMMAND       Override an agent executable path
`)
  process.exit(2)
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value) usage()
  args.splice(index, 2)
  return value
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]?.startsWith("-") ? "workspace" : (args.shift() ?? "workspace")
  if (command === "workspace") {
    const cwd = resolve(takeOption(args, "--cwd") ?? process.cwd())
    const selected = takeOption(args, "--agent") ?? "claude"
    if (!isAgentName(selected)) usage()
    await startNativeWorkspace(selected, cwd)
    return
  }
  if (command === "agents") {
    console.log(JSON.stringify(agentNames.map((name) => ({ name, ...executableStatus(name) })), null, 2))
    return
  }
  if (command === "mcp") {
    await startMcpServer()
    return
  }
  if (command === "run") {
    const agent = args.shift() as AgentName | undefined
    if (!agent || !agentNames.includes(agent)) usage()
    const cwd = resolve(takeOption(args, "--cwd") ?? process.cwd())
    const model = takeOption(args, "--model")
    const sessionId = takeOption(args, "--session")
    const prompt = args.join(" ").trim()
    if (!prompt) usage()
    const result = await runAgent({ agent, cwd, model, sessionId, prompt })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  usage()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
