import { execFile, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { resolveExecutable } from "./executable.js"
import { HermesAcpRunner } from "./hermes-acp-runner.js"
import { findRegisteredAgent, listAgentNames } from "./agent-registry.js"
import { getAdapter } from "./adapters.js"
import { pluginEfforts, pluginModels } from "./plugin-agent.js"
import type { AgentName } from "./types.js"

export interface ModelEntry {
  agent: AgentName
  id: string
  label: string
  description?: string
  isDefault?: boolean
  isFree?: boolean
  efforts?: string[]
}

export interface ModelCatalog {
  agent: AgentName
  models: ModelEntry[]
  error?: string
}

function execText(command: string, args: string[], timeout = 12_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: "utf8",
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(stdout)
    })
  })
}

export function parseOpenCodeModels(output: string): ModelEntry[] {
  return output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z0-9._-]+\/[a-z0-9._:/-]+$/i.test(line))
    .map((id) => ({
      agent: "opencode" as const,
      id,
      label: id,
      isFree: id === "opencode/big-pickle" || /(?:^|[-/:])free(?:$|[-/:])/i.test(id),
    }))
}

interface CodexModel {
  id?: unknown
  model?: unknown
  displayName?: unknown
  description?: unknown
  isDefault?: unknown
  hidden?: unknown
  supportedReasoningEfforts?: unknown
}

export function parseCodexModels(value: unknown): ModelEntry[] {
  if (!value || typeof value !== "object") return []
  const data = (value as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const model = item as CodexModel
    const id = typeof model.model === "string" ? model.model : typeof model.id === "string" ? model.id : undefined
    if (!id || model.hidden === true) return []
    return [{
      agent: "codex" as const,
      id,
      label: typeof model.displayName === "string" ? model.displayName : id,
      description: typeof model.description === "string" ? model.description : undefined,
      isDefault: model.isDefault === true,
      efforts: Array.isArray(model.supportedReasoningEfforts)
        ? model.supportedReasoningEfforts.flatMap((option) => {
          const effort = (option as { reasoningEffort?: unknown }).reasoningEffort
          return typeof effort === "string" ? [effort] : []
        }) : undefined,
    }]
  })
}

async function discoverCodexModels(): Promise<ModelEntry[]> {
  const child = spawn(resolveExecutable("codex"), ["app-server", "--stdio"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  let terminalError: Error | undefined
  const failPending = (error: Error): void => {
    terminalError = error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  child.once("error", (error) => failPending(error))
  child.once("exit", (code, signal) => {
    if (pending.size > 0) failPending(new Error(`Codex app-server exited before replying (${signal ?? code ?? "unknown"})`))
  })
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof message.id !== "number") return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.error) request.reject(new Error(message.error.message ?? "Codex app-server request failed"))
      else request.resolve(message.result)
    } catch { /* app-server diagnostics are not protocol messages */ }
  })

  const request = (id: number, method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    if (terminalError) { reject(terminalError); return }
    pending.set(id, { resolve, reject })
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`, (error) => {
      if (error && pending.delete(id)) reject(error)
    })
  })
  const timeout = setTimeout(() => {
    failPending(new Error("Codex model discovery timed out after 12 seconds"))
    child.kill()
  }, 12_000)
  try {
    await request(1, "initialize", {
      clientInfo: { name: "allcode", title: "All Code", version: "0.2.0" },
      capabilities: { experimentalApi: true },
    })
    child.stdin.write(`${JSON.stringify({ method: "initialized" })}\n`)
    const result = await request(2, "model/list", { limit: 100, includeHidden: false })
    return parseCodexModels(result)
  } finally {
    clearTimeout(timeout)
    lines.close()
    child.kill()
  }
}

function claudeModels(): ModelEntry[] {
  return [
    { agent: "claude", id: "default", label: "Account default", isDefault: true },
    { agent: "claude", id: "opus", label: "Opus" },
    { agent: "claude", id: "sonnet", label: "Sonnet" },
    { agent: "claude", id: "haiku", label: "Haiku" },
    { agent: "claude", id: "fable", label: "Fable" },
  ]
}

export async function discoverModels(agent: AgentName): Promise<ModelCatalog> {
  try {
    const registered = findRegisteredAgent(agent)
    if (registered?.protocol === "plugin") {
      const models = await pluginModels(agent, process.cwd())
      return { agent, models: [{ agent, id: "default", label: `${registered.label} default`, isDefault: true },
        ...models.filter((model) => typeof model.id === "string").map((model) => ({ agent, id: model.id,
          label: model.label ?? model.id, description: model.description, efforts: model.efforts }))] }
    }
    if (registered?.protocol === "oneshot") {
      return { agent, models: [{ agent, id: "default", label: "CLI default", isDefault: true },
        ...registered.models.map((id) => ({ agent, id, label: id }))] }
    }
    if (agent === "hermes" || registered?.protocol === "acp") {
      const runner = registered
        ? new HermesAcpRunner((request) => getAdapter(agent).buildInvocation(request, registered.command), agent)
        : new HermesAcpRunner()
      try {
        const state = await runner.listModels({ agent, cwd: process.cwd(), prompt: "" })
        return { agent, models: [{ agent, id: "default", label: `${registered?.label ?? "Hermes"} configured default`, isDefault: true },
          ...state.availableModels.flatMap((entry) => {
          if (typeof entry.modelId !== "string") return []
          return [{ agent, id: entry.modelId, label: typeof entry.name === "string" ? entry.name : entry.modelId,
            description: typeof entry.description === "string" ? entry.description : undefined,
          }]
        })] }
      } finally { await runner.close() }
    }
    if (agent === "opencode") {
      const output = await execText(resolveExecutable("opencode"), ["models"])
      return { agent, models: parseOpenCodeModels(output) }
    }
    if (agent === "codex") return { agent, models: await discoverCodexModels() }
    return { agent, models: claudeModels() }
  } catch (error) {
    return { agent, models: [], error: error instanceof Error ? error.message : String(error) }
  }
}

export async function discoverAllModels(): Promise<ModelCatalog[]> {
  return await Promise.all(listAgentNames().map(discoverModels))
}

export async function discoverEfforts(agent: AgentName, model: string | undefined): Promise<string[]> {
  if (findRegisteredAgent(agent)?.protocol === "plugin") return await pluginEfforts(agent, process.cwd(), model)
  if (agent === "hermes" || findRegisteredAgent(agent)) return ["default"]
  if (agent === "claude") return ["default", "low", "medium", "high", "xhigh", "max"]
  if (agent === "codex") {
    const catalog = await discoverModels("codex")
    if (catalog.error) throw new Error(catalog.error)
    const selected = catalog.models.find((entry) => entry.id === model)
      ?? catalog.models.find((entry) => entry.isDefault)
    return ["default", ...(selected?.efforts ?? [])]
  }
  if (!model || model === "default") return ["default"]
  const provider = model.split("/")[0]
  const output = await execText(resolveExecutable("opencode"), ["models", provider!, "--verbose"])
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === model)
  if (start < 0) return ["default"]
  const json: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    json.push(lines[index]!)
    if (lines[index] === "}") break
  }
  try {
    const metadata = JSON.parse(json.join("\n")) as { variants?: Record<string, unknown> }
    return ["default", ...Object.keys(metadata.variants ?? {})]
  } catch {
    return ["default"]
  }
}
