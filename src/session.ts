import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { AgentName } from "./types.js"

export interface SharedMessage {
  role: "user" | "assistant"
  content: string
  agent?: AgentName
  createdAt: string
}

interface SessionState {
  version: 1
  activeAgent: AgentName
  models: Partial<Record<AgentName, string>>
  efforts?: Partial<Record<AgentName, string>>
  permissionModes?: Partial<Record<AgentName, string>>
  nativeSessions: Partial<Record<AgentName, string>>
  delivered: Partial<Record<AgentName, number>>
  messages: SharedMessage[]
}

const defaultState = (agent: AgentName): SessionState => ({
  version: 1,
  activeAgent: agent,
  models: {},
  efforts: {},
  permissionModes: {},
  nativeSessions: {},
  delivered: {},
  messages: [],
})

export class SharedSession {
  readonly path: string
  #state: SessionState

  constructor(cwd: string, initialAgent: AgentName) {
    const directory = join(cwd, ".allcode")
    mkdirSync(directory, { recursive: true })
    this.path = join(directory, "session.json")
    this.#state = this.#load(initialAgent)
  }

  #load(initialAgent: AgentName): SessionState {
    if (!existsSync(this.path)) return defaultState(initialAgent)
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8")) as SessionState
      return value.version === 1 ? value : defaultState(initialAgent)
    } catch {
      return defaultState(initialAgent)
    }
  }

  save(): void {
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, "utf8")
    renameSync(temporary, this.path)
  }

  get activeAgent(): AgentName { return this.#state.activeAgent }
  set activeAgent(value: AgentName) { this.#state.activeAgent = value; this.save() }
  model(agent: AgentName): string | undefined { return this.#state.models[agent] }
  setModel(agent: AgentName, value: string | undefined): void {
    if (value) this.#state.models[agent] = value
    else delete this.#state.models[agent]
    this.save()
  }
  effort(agent: AgentName): string | undefined { return this.#state.efforts?.[agent] }
  setEffort(agent: AgentName, value: string | undefined): void {
    this.#state.efforts ??= {}
    if (value && value !== "default") this.#state.efforts[agent] = value
    else delete this.#state.efforts[agent]
    this.save()
  }
  permissionMode(agent: AgentName): string | undefined { return this.#state.permissionModes?.[agent] }
  setPermissionMode(agent: AgentName, value: string | undefined): void {
    this.#state.permissionModes ??= {}
    if (value) this.#state.permissionModes[agent] = value
    else delete this.#state.permissionModes[agent]
    this.save()
  }
  nativeSession(agent: AgentName): string | undefined { return this.#state.nativeSessions[agent] }
  setNativeSession(agent: AgentName, value: string): void {
    this.#state.nativeSessions[agent] = value
    this.save()
  }

  promptFor(agent: AgentName, prompt: string): string {
    const start = this.#state.delivered[agent] ?? 0
    const unseen = this.#state.messages.slice(start)
    if (unseen.length === 0) return prompt
    const transcript = unseen.map((message) => {
      const speaker = message.role === "user" ? "User" : `Assistant (${message.agent ?? "unknown"})`
      return `${speaker}: ${message.content}`
    }).join("\n\n")
    const bounded = transcript.slice(-48_000)
    return `[AllCode shared context]\nThe following conversation happened in this workspace while another coding agent may have been active. Continue from it without repeating completed work.\n\n${bounded}\n\n[Current request]\n${prompt}`
  }

  recordTurn(agent: AgentName, prompt: string, response: string): void {
    const createdAt = new Date().toISOString()
    this.#state.messages.push({ role: "user", content: prompt, createdAt })
    this.#state.messages.push({ role: "assistant", content: response, agent, createdAt })
    this.#state.delivered[agent] = this.#state.messages.length
    this.save()
  }

  recordFailure(agent: AgentName, prompt: string, error: string): void {
    this.recordTurn(agent, prompt, `[AllCode error from ${agent}] ${error}`)
  }

  summary(): { messages: number; sessions: Partial<Record<AgentName, string>>; path: string } {
    return { messages: this.#state.messages.length, sessions: { ...this.#state.nativeSessions }, path: this.path }
  }
}
