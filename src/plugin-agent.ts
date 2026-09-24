import { pathToFileURL, fileURLToPath } from "node:url"
import { childEnv } from "./adapters.js"
import { findRegisteredAgent, type RegisteredAgent } from "./agent-registry.js"
import type { ApprovalHandler } from "./approval-broker.js"
import type { AgentResult, RunRequest } from "./types.js"

export interface PluginModel { id: string; label?: string; description?: string; efforts?: string[] }
export interface PluginMode { id: string; label: string; description?: string }
export interface PluginContext {
  executable: string
  args: string[]
  signal?: AbortSignal
  approve: ApprovalHandler
  mcp: { command: string; args: string[]; env: NodeJS.ProcessEnv }
}
export interface PluginAgent {
  apiVersion: 1
  name: string
  run(request: RunRequest, context: PluginContext): Promise<{ finalText: string; sessionId?: string; eventCount?: number; stdout?: string; stderr?: string; exitCode?: number }>
  listModels?(context: PluginContext): Promise<PluginModel[]>
  listEfforts?(model: string | undefined, context: PluginContext): Promise<string[]>
  listModes?(context: PluginContext): Promise<PluginMode[]>
}

function contextFor(agent: RegisteredAgent, cwd: string, signal?: AbortSignal, onApproval?: ApprovalHandler): PluginContext {
  const cli = fileURLToPath(new URL("./cli.js", import.meta.url))
  return {
    executable: agent.command,
    args: agent.args,
    signal,
    approve: onApproval ?? (async () => false),
    mcp: { command: process.execPath, args: [cli, "mcp"], env: childEnv(agent.name, cwd) },
  }
}

export async function loadPlugin(name: string): Promise<{ registration: RegisteredAgent; plugin: PluginAgent }> {
  const registration = findRegisteredAgent(name)
  if (!registration || registration.protocol !== "plugin" || !registration.module) throw new Error(`Plugin agent not registered: ${name}`)
  const imported = await import(pathToFileURL(registration.module).href) as { default?: unknown }
  const plugin = imported.default as Partial<PluginAgent> | undefined
  if (!plugin || plugin.apiVersion !== 1 || plugin.name !== name || typeof plugin.run !== "function") {
    throw new Error(`Plugin ${name} must export apiVersion 1, its registered name, and run()`)
  }
  return { registration, plugin: plugin as PluginAgent }
}

export async function runPlugin(request: RunRequest, signal?: AbortSignal, onApproval?: ApprovalHandler): Promise<AgentResult> {
  const started = Date.now()
  const { registration, plugin } = await loadPlugin(request.agent)
  const result = await plugin.run(request, contextFor(registration, request.cwd, signal, onApproval))
  if (!result || typeof result.finalText !== "string") throw new Error(`Plugin ${request.agent} returned no finalText`)
  if (result.exitCode !== undefined && result.exitCode !== 0) throw new Error(`${request.agent} failed: ${result.stderr || result.finalText || `exit code ${result.exitCode}`}`)
  return { agent: request.agent, finalText: result.finalText, sessionId: result.sessionId, eventCount: result.eventCount ?? 0,
    stdout: result.stdout ?? result.finalText, stderr: result.stderr ?? "", exitCode: 0, durationMs: Date.now() - started, timedOut: false }
}

export async function pluginModels(name: string, cwd: string): Promise<PluginModel[]> {
  const { registration, plugin } = await loadPlugin(name)
  if (!plugin.listModels) return registration.models.map((id) => ({ id }))
  return await plugin.listModels(contextFor(registration, cwd))
}

export async function pluginEfforts(name: string, cwd: string, model?: string): Promise<string[]> {
  const { registration, plugin } = await loadPlugin(name)
  return plugin.listEfforts ? await plugin.listEfforts(model, contextFor(registration, cwd)) : ["default"]
}

export async function pluginModes(name: string, cwd: string): Promise<PluginMode[]> {
  const { registration, plugin } = await loadPlugin(name)
  return plugin.listModes ? await plugin.listModes(contextFor(registration, cwd)) : [{ id: "default", label: "Agent default" }]
}
