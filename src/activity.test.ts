import { describe, expect, it } from "vitest"
import { JsonlActivity } from "./activity.js"
import type { AgentActivity } from "./types.js"

describe("live CLI activity", () => {
  it("streams OpenCode text incrementally and reports tool transitions", () => {
    const events: AgentActivity[] = []
    const parser = new JsonlActivity("opencode", (event) => events.push(event))
    const lines = [
      { type: "reasoning", part: { id: "r1", text: "Checking" } },
      { type: "text", part: { id: "t1", text: "Hello" } },
      { type: "text", part: { id: "t1", text: "Hello world" } },
      { type: "tool_use", part: { id: "x1", tool: "read", state: { status: "running", input: { path: "a.ts" } } } },
      { type: "tool_use", part: { id: "x1", tool: "read", state: { status: "completed", output: "done" } } },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n"
    parser.write(lines.slice(0, 19))
    parser.write(lines.slice(19))
    parser.end()
    expect(events.filter((event) => event.kind === "text").map((event) => event.text)).toEqual(["Hello", " world"])
    expect(events).toContainEqual({ kind: "reasoning", text: "Checking" })
    expect(events.filter((event) => event.kind === "tool")).toHaveLength(2)
  })

  it("shows Codex item starts, reasoning, and the incremental reply", () => {
    const events: AgentActivity[] = []
    const parser = new JsonlActivity("codex", (event) => events.push(event))
    for (const event of [
      { type: "item.started", item: { id: "1", type: "command_execution", command: "npm test" } },
      { type: "item.updated", item: { id: "2", type: "reasoning", text: "Thinking" } },
      { type: "item.updated", item: { id: "3", type: "agent_message", text: "Done" } },
      { type: "item.completed", item: { id: "3", type: "agent_message", text: "Done now" } },
    ]) parser.write(`${JSON.stringify(event)}\n`)
    expect(events.some((event) => event.kind === "tool" && event.text.includes("npm test"))).toBe(true)
    expect(events).toContainEqual({ kind: "reasoning", text: "Thinking" })
    expect(events.filter((event) => event.kind === "text").map((event) => event.text)).toEqual(["Done", " now"])
  })
})
