import type { ActivityHandler, AgentName } from "./types.js"

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function activityDetail(value: unknown, limit = 600): string {
  const item = record(value)
  const selected = ["command", "file_path", "path", "query", "pattern", "description", "title"]
    .map((key) => item[key]).find((entry) => typeof entry === "string" && entry.length > 0)
  const text = typeof selected === "string" ? selected : typeof value === "string" ? value : JSON.stringify(value ?? "")
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

export class JsonlActivity {
  private buffer = ""
  private readonly seen = new Map<string, string>()

  constructor(private readonly agent: AgentName, private readonly emit: ActivityHandler) {}

  write(chunk: string): void {
    this.buffer += chunk
    let newline: number
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.line(line)
    }
    if (this.buffer.length > 1024 * 1024) this.buffer = this.buffer.slice(-8192)
  }

  end(): void {
    if (this.buffer.trim()) this.line(this.buffer.trim())
    this.buffer = ""
  }

  private delta(key: string, value: string, kind: "text" | "reasoning"): void {
    const before = this.seen.get(key) ?? ""
    if (before === value) return
    this.seen.set(key, value)
    this.emit({ kind, text: value.startsWith(before) ? value.slice(before.length) : value })
  }

  private line(line: string): void {
    let event: Record<string, unknown>
    try { event = record(JSON.parse(line)) } catch { return }
    const type = String(event.type ?? "")
    if (this.agent === "opencode") {
      const part = record(event.part)
      const id = String(part.id ?? event.id ?? type)
      if ((type === "text" || type === "reasoning") && typeof part.text === "string") {
        this.delta(`${type}:${id}`, part.text, type === "text" ? "text" : "reasoning")
      } else if (type === "tool_use") {
        const state = record(part.state)
        const status = String(state.status ?? "running")
        const key = `tool:${id}:${status}`
        if (!this.seen.has(key)) {
          this.seen.set(key, "1")
          const detail = activityDetail(status === "completed" ? state.output : state.input)
          this.emit({ kind: "tool", text: `${String(part.tool ?? "Tool")} · ${status}${detail && detail !== '""' ? ` · ${detail}` : ""}` })
        }
      }
      return
    }
    if (this.agent !== "codex") return
    const item = record(event.item)
    const itemType = String(item.type ?? "")
    const id = String(item.id ?? itemType)
    if (type === "item.started" && itemType && itemType !== "agent_message" && itemType !== "agentMessage" && itemType !== "reasoning") {
      this.emit({ kind: "tool", text: `${itemType.replaceAll("_", " ")} · ${activityDetail(item.command ?? item.path ?? item.server ?? item.name ?? item)}` })
    }
    if (type === "item.updated" || type === "item.completed") {
      if ((itemType === "agent_message" || itemType === "agentMessage") && typeof item.text === "string") {
        this.delta(`text:${id}`, item.text, "text")
      } else if (itemType === "reasoning") {
        const summary = Array.isArray(item.summary) ? item.summary.map((part) => record(part).text ?? "").join("\n") : item.text
        if (typeof summary === "string") this.delta(`reasoning:${id}`, summary, "reasoning")
      } else if (type === "item.completed" && itemType) {
        const detail = activityDetail(item.aggregated_output ?? item.output ?? item.exit_code ?? item.status ?? "")
        this.emit({ kind: "tool", text: `${itemType.replaceAll("_", " ")} complete${detail && detail !== '""' ? ` · ${detail}` : ""}` })
      }
    }
  }
}
