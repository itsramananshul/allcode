import { execFile, spawn } from "node:child_process"
import { createInterface } from "node:readline"
import { resolveExecutable } from "./executable.js"
import type { AgentName } from "./types.js"

export interface ModelEntry {
  agent: AgentName
  id: string
  label: string
  description?: string
  isDefault?: boolean
  isFree?: boolean
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
      isFree: id.includes("-free") || id === "opencode/big-pickle" || id.startsWith("opencode/"),
    }))
}

interface CodexModel {
  id?: unknown
  model?: unknown
  displayName?: unknown
  description?: unknown
  isDefault?: unknown
  hidden?: unknown
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
    }]
  })
}

async function discoverCodexModels(): Promise<ModelEntry[]> {
  const child = spawn(resolveExecutable("codex"), ["app-server", "--stdio"], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const responses = new Map<number, (value: unknown) => void>()
  const errors = new Map<number, (error: Error) => void>()
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    try {
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } }
      if (typeof message.id !== "number") return
      if (message.error) errors.get(message.id)?.(new Error(message.error.message ?? "Codex app-server request failed"))
      else responses.get(message.id)?.(message.result)
      responses.delete(message.id)
      errors.delete(message.id)
    } catch { /* app-server diagnostics are not protocol messages */ }
  })

  const request = (id: number, method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
    responses.set(id, resolve)
    errors.set(id, reject)
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
  })
  const timeout = setTimeout(() => child.kill(), 12_000)
  try {
    await request(1, "initialize", {
      clientInfo: { name: "all-code", title: "All Code", version: "0.1.0" },
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
  return await Promise.all((["claude", "opencode", "codex"] as const).map(discoverModels))
}
