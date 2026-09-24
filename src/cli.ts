#!/usr/bin/env node
import { resolve } from "node:path"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { startAllCode } from "./allcode.js"
import { executableStatus, resolveExecutable } from "./executable.js"
import { isKnownAgent, listAgentNames, registerAgent } from "./agent-registry.js"
import { installPreparedSkill, prepareSkill } from "./skill-installer.js"
import { inspectPluginDraft, installPluginDraft } from "./plugin-installer.js"
import { startMcpServer } from "./mcp-server.js"
import { discoverAllModels, discoverModels } from "./models.js"
import { isAgentName, startNativeWorkspace } from "./native-workspace.js"
import { runAgent } from "./runner.js"
import type { AgentName } from "./types.js"

function usage(): never {
  console.error(`allcode

Commands:
  allcode [--agent claude|opencode|codex|hermes] [--cwd PATH]
  allcode native [--agent claude|opencode|codex|hermes] [--cwd PATH]
  agents
  models [claude|opencode|codex|hermes]
  run <claude|opencode|codex|hermes> [--cwd PATH] [--model ID] [--session ID] <prompt>
  add agent DRAFT-DIRECTORY
  add agent NAME --protocol acp|oneshot --command PATH [--label NAME] [--arg VALUE ...] [--model ID ...] [--skill-dir PATH ...]
  add skill PATH-OR-GITHUB-URL [--yes]
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

function takeOptions(args: string[], name: string): string[] {
  const values: string[] = []
  while (args.includes(name)) values.push(takeOption(args, name)!)
  return values
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
    if (!isAgentName(selected) || !["claude", "opencode", "codex", "hermes"].includes(selected)) usage()
    await startNativeWorkspace(selected, cwd)
    return
  }
  if (command === "agents") {
    console.log(JSON.stringify(listAgentNames().map((name) => ({ name, ...executableStatus(name) })), null, 2))
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
    if (!isKnownAgent(agent)) usage()
    const cwd = resolve(takeOption(args, "--cwd") ?? process.cwd())
    const model = takeOption(args, "--model")
    const sessionId = takeOption(args, "--session")
    const prompt = args.join(" ").trim()
    if (!prompt) usage()
    const result = await runAgent({ agent, cwd, model, sessionId, prompt })
    console.log(JSON.stringify(result, null, 2))
    return
  }
  if (command === "add") {
    const kind = args.shift()
    if (kind === "agent") {
      if (args.length === 1 && !args[0]?.startsWith("-")) {
        const draft = inspectPluginDraft(args[0]!)
        console.log(`${draft.manifest.label} (${draft.manifest.name})\nExecutable: ${draft.manifest.command}\nCode: ${draft.directory}\nLimitations: ${draft.manifest.limitations.join("; ") || "none declared; verify capabilities yourself"}\nThis adapter runs local JavaScript with your user permissions.`)
        if (!stdin.isTTY) throw new Error("Interactive confirmation is required to install an executable adapter")
        const prompt = createInterface({ input: stdin, output: stdout })
        const answer = await prompt.question("Install this adapter? [y/N] ")
        prompt.close()
        if (!/^y(?:es)?$/i.test(answer.trim())) { console.log("Cancelled."); return }
        const saved = installPluginDraft(draft.directory)
        console.log(`Registered ${saved.label}. Use /agent ${saved.name} in All Code.`)
        return
      }
      const name = args.shift()
      const protocol = takeOption(args, "--protocol")
      const commandPath = takeOption(args, "--command")
      const label = takeOption(args, "--label") ?? name
      const launchArgs = takeOptions(args, "--arg")
      const models = takeOptions(args, "--model")
      const skillsDirs = takeOptions(args, "--skill-dir").map((path) => resolve(path))
      if (!name || !commandPath || (protocol !== "acp" && protocol !== "oneshot") || args.length) usage()
      const agent = registerAgent({ name, label: label!, protocol, command: resolveExecutable(commandPath), args: launchArgs, models, skillsDirs })
      console.log(`Registered ${agent.label} (${agent.protocol}). Use /agent ${agent.name} in All Code.`)
      return
    }
    if (kind === "skill") {
      const source = args.shift()
      const yes = args.includes("--yes")
      if (yes) args.splice(args.indexOf("--yes"), 1)
      if (!source || args.length) usage()
      const skill = prepareSkill(source)
      try {
        console.log(`${skill.name}: ${skill.description}`)
        for (const target of skill.destinations) console.log(`${target.agents.join(" + ")} → ${target.path}`)
        if (!yes) {
          if (!stdin.isTTY) throw new Error("Use --yes after reviewing the skill source and destinations")
          const prompt = createInterface({ input: stdin, output: stdout })
          const answer = await prompt.question("Install this skill? [y/N] ")
          prompt.close()
          if (!/^y(?:es)?$/i.test(answer.trim())) { console.log("Cancelled."); return }
        }
        console.log(JSON.stringify(installPreparedSkill(skill), null, 2))
      } finally { skill.cleanup() }
      return
    }
    usage()
  }
  usage()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
