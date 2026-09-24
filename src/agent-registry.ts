import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { randomUUID } from "node:crypto"
import { agentNames, type AgentName } from "./types.js"

export interface RegisteredAgent {
  name: string
  label: string
  protocol: "acp" | "oneshot" | "plugin"
  command: string
  args: string[]
  models: string[]
  module?: string
  skillsDirs?: string[]
  limitations?: string[]
}

function registryPath(): string {
  return process.env.ALL_CODE_AGENT_REGISTRY || join(homedir(), ".allcode", "agents.json")
}

export function registeredAgents(): RegisteredAgent[] {
  const path = registryPath()
  if (!existsSync(path)) return []
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
  if (!Array.isArray(parsed)) throw new Error(`Invalid All Code agent registry: ${path}`)
  return parsed.map((agent) => validateAgent(agent, false))
}

function validateAgent(value: unknown, requireFiles: boolean): RegisteredAgent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid registered agent")
  const agent = value as Partial<RegisteredAgent>
  if (typeof agent.name !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(agent.name) || agentNames.includes(agent.name as typeof agentNames[number])) {
    throw new Error(`Invalid or reserved agent name: ${String(agent.name)}`)
  }
  if (typeof agent.label !== "string" || agent.label.trim().length < 1 || agent.label.length > 80) throw new Error("Agent label must be 1–80 characters")
  if (agent.protocol !== "acp" && agent.protocol !== "oneshot" && agent.protocol !== "plugin") throw new Error("Agent protocol must be acp, oneshot, or plugin")
  if (typeof agent.command !== "string" || !isAbsolute(agent.command) || (requireFiles && (!existsSync(agent.command) || !statSync(agent.command).isFile()))) {
    throw new Error(`Agent executable must be an existing absolute file: ${String(agent.command)}`)
  }
  if (!Array.isArray(agent.args) || agent.args.some((arg) => typeof arg !== "string")) throw new Error("Agent args must be a string array")
  if (!Array.isArray(agent.models) || agent.models.some((id) => typeof id !== "string")) throw new Error("Agent models must be a string array")
  if (agent.protocol === "plugin" && (typeof agent.module !== "string" || !isAbsolute(agent.module) || (requireFiles && (!existsSync(agent.module) || !statSync(agent.module).isFile())))) {
    throw new Error(`Plugin module must be an existing absolute file: ${String(agent.module)}`)
  }
  if (agent.skillsDirs !== undefined && (!Array.isArray(agent.skillsDirs) || agent.skillsDirs.some((path) => typeof path !== "string" || !isAbsolute(path)))) {
    throw new Error("Skill directories must be absolute paths")
  }
  if (agent.limitations !== undefined && (!Array.isArray(agent.limitations) || agent.limitations.some((item) => typeof item !== "string" || !item.trim() || item.length > 300))) {
    throw new Error("Agent limitations must be short non-empty strings")
  }
  if (agent.args.length > 32 || agent.models.length > 100) throw new Error("Agent manifest has too many args or models")
  return { name: agent.name, label: agent.label.trim(), protocol: agent.protocol, command: agent.command, args: agent.args, models: agent.models,
    ...(agent.module ? { module: agent.module } : {}), ...(agent.skillsDirs ? { skillsDirs: agent.skillsDirs } : {}),
    ...(agent.limitations ? { limitations: agent.limitations } : {}) }
}

export function registerAgent(value: RegisteredAgent): RegisteredAgent {
  const agent = validateAgent(value, true)
  const path = registryPath()
  const existing = registeredAgents()
  if (existing.some((item) => item.name === agent.name)) throw new Error(`Agent ${agent.name} is already registered`)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify([...existing, agent], null, 2)}\n`, "utf8")
  renameSync(temporary, path)
  return agent
}

export function findRegisteredAgent(name: string): RegisteredAgent | undefined {
  return registeredAgents().find((agent) => agent.name === name)
}

export function listAgentNames(): AgentName[] {
  return [...agentNames, ...registeredAgents().map((agent) => agent.name)]
}

export function isKnownAgent(name: string | undefined): name is AgentName {
  return Boolean(name && listAgentNames().includes(name))
}
