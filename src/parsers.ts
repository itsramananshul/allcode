type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseJsonEvents(output: string): unknown[] {
  const trimmed = output.trim()
  if (!trimmed) return []
  try { return [JSON.parse(trimmed)] } catch { /* JSONL or mixed output */ }
  const events: unknown[] = []
  for (const line of trimmed.split(/\r?\n/)) {
    try { events.push(JSON.parse(line)) } catch { /* ignore human/log lines */ }
  }
  return events
}

function findFirstString(value: unknown, keys: Set<string>): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstString(item, keys)
      if (found) return found
    }
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string" && item.length > 0) return item
      const found = findFirstString(item, keys)
      if (found) return found
    }
  }
  return undefined
}

export function extractSessionId(events: unknown[]): string | undefined {
  const keys = new Set(["session_id", "sessionId", "sessionID", "thread_id", "threadId"])
  for (const event of events) {
    const value = findFirstString(event, keys)
    if (value) return value
  }
  return undefined
}

export function extractErrorText(events: unknown[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (!isRecord(event) || event.type !== "error" || !isRecord(event.error)) continue
    const error = event.error
    if (isRecord(error.data) && typeof error.data.message === "string") return error.data.message
    if (typeof error.message === "string") return error.message
  }
  return undefined
}

function textCandidates(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => textCandidates(item, output))
    return
  }
  if (!isRecord(value)) return

  if (typeof value.result === "string") output.push(value.result)
  if (value.type === "agent_message" && typeof value.text === "string") output.push(value.text)
  if (value.type === "text" && typeof value.text === "string") output.push(value.text)
  if (value.type === "text" && isRecord(value.part) && typeof value.part.text === "string") {
    output.push(value.part.text)
  }
  if (value.type === "item.completed" && isRecord(value.item)) textCandidates(value.item, output)
  if (value.type === "message" && isRecord(value.message)) textCandidates(value.message, output)
}

export function extractFinalText(events: unknown[], fallback: string): string {
  const candidates: string[] = []
  events.forEach((event) => textCandidates(event, candidates))
  const unique = candidates.filter((text, index) => index === 0 || text !== candidates[index - 1])
  return unique.at(-1)?.trim() || fallback.trim()
}
