#!/usr/bin/env node
import { resolve } from "node:path"
import { startAllCode } from "./all-code.js"
import { executableStatus } from "./executable.js"
import { startMcpServer } from "./mcp-server.js"
import { discoverAllModels, discoverModels } from "./models.js"
import { isAgentName, startNativeWorkspace } from "./native-workspace.js"
import { runAgent } from "./runner.js"
import { agentNames, type AgentName } from "./types.js"

function usage(): never {
  console.error(`allcode

Commands:
  allcode [--agent claude|opencode|codex] [--cwd PATH]
  allcode native [--agent claude|opencode|codex] [--cwd PATH]
  agents
  models [claude|opencode|codex]
  run <claude|opencode|codex> [--cwd PATH] [--model ID] [--session ID] <prompt>
  mcp

Environment:
  ALL_CODE_ALLOWED_ROOTS   Allowed MCP workspace roots (${process.platform === "win32" ? ";" : ":"}-separated)
  ALL_CODE_MAX_DEPTH       Maximum nested delegation depth (default: 3)
  ALL_CODE_*_COMMAND       Override an agent executable path
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
  const command = args[0]?.startsWith("-") ? "ui" : (args.shift() ?? "ui")
  if (command === "ui") {
    const cwd = resolve(takeOption(args, "--cwd") ?? process.cwd())
    const requested = takeOption(args, "--agent")
    const selected = requested ?? "opencode"
    if (!isAgentName(selected)) usage()
    await startAllCode(cwd, selected, requested !== undefined)
    return
  }
  if (command === "native") {
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
  if (command === "models") {
    const requested = args.shift()
    if (requested && !isAgentName(requested)) usage()
    const catalogs = requested ? [await discoverModels(requested as AgentName)] : await discoverAllModels()
    console.log(JSON.stringify(catalogs, null, 2))
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
