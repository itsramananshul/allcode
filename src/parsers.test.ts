import { describe, expect, it } from "vitest"
import { extractFinalText, extractSessionId, parseJsonEvents } from "./parsers.js"

describe("event parsing", () => {
  it("parses Claude's single JSON result", () => {
    const events = parseJsonEvents('{"result":"done","session_id":"abc"}')
    expect(extractSessionId(events)).toBe("abc")
    expect(extractFinalText(events, "")).toBe("done")
  })

  it("parses Codex JSONL", () => {
    const events = parseJsonEvents([
      '{"type":"thread.started","thread_id":"t-1"}',
      '{"type":"item.completed","item":{"type":"agent_message","text":"fixed"}}',
    ].join("\n"))
    expect(extractSessionId(events)).toBe("t-1")
    expect(extractFinalText(events, "")).toBe("fixed")
  })

  it("parses OpenCode text parts", () => {
    const events = parseJsonEvents('{"type":"text","sessionID":"ses_1","part":{"text":"complete"}}')
    expect(extractSessionId(events)).toBe("ses_1")
    expect(extractFinalText(events, "")).toBe("complete")
  })
})
