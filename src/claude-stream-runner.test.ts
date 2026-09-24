import { describe, expect, it } from "vitest"
import { ClaudeStreamRunner } from "./claude-stream-runner.js"
import type { RunRequest } from "./types.js"

const fixture = `
const readline = require("node:readline")
let turn = 0
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const input = JSON.parse(line)
  turn += 1
  process.stdout.write(JSON.stringify({
    type: "result",
    result: String(turn) + ":" + input.message.content,
    session_id: "11111111-1111-4111-8111-111111111111",
  }) + "\\n")
})
`

const request: RunRequest = {
  agent: "claude",
  cwd: process.cwd(),
  prompt: "first",
  permissionMode: "acceptEdits",
}

describe("persistent Claude stream", () => {
  it("surfaces streamed text, thinking, and tool activity before the final result", async () => {
    const liveFixture = `
const readline = require("node:readline")
readline.createInterface({ input: process.stdin }).on("line", () => {
  const send = value => process.stdout.write(JSON.stringify(value) + "\\n")
  send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Planning" } } })
  send({ type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "Read" } } })
  send({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Ready" } } })
  send({ type: "result", result: "Ready" })
})
`
    const runner = new ClaudeStreamRunner(() => ({
      command: process.execPath, args: ["-e", liveFixture, "--", "--output-format", "json"], cwd: process.cwd(),
    }))
    const events: Array<{ kind: string; text: string }> = []
    try {
      const result = await runner.run(request, async () => false, undefined, (event) => events.push(event))
      expect(result.finalText).toBe("Ready")
      expect(events).toContainEqual({ kind: "reasoning", text: "Planning" })
      expect(events).toContainEqual({ kind: "tool", text: "Calling Read" })
      expect(events).toContainEqual({ kind: "text", text: "Ready" })
    } finally { await runner.close() }
  })

  it("reuses one process across turns and restarts when settings change", async () => {
    const runner = new ClaudeStreamRunner(() => ({
      command: process.execPath,
      args: ["-e", fixture, "--", "--output-format", "json"],
      cwd: process.cwd(),
    }))
    try {
      const first = await runner.run(request, async () => false)
      const second = await runner.run({ ...request, prompt: "second", sessionId: first.sessionId }, async () => false)
      const changed = await runner.run({ ...request, prompt: "third", sessionId: second.sessionId, permissionMode: "plan" }, async () => false)
      expect(first.finalText).toBe("1:first")
      expect(second.finalText).toBe("2:second")
      expect(changed.finalText).toBe("1:third")
      expect(first.sessionId).toBe("11111111-1111-4111-8111-111111111111")
    } finally {
      await runner.close()
    }
  })

  it("interrupts an active turn and can start another one", async () => {
    const cancellableFixture = `
const readline = require("node:readline")
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const prompt = JSON.parse(line).message.content
  if (prompt === "hang") return
  process.stdout.write(JSON.stringify({ type: "result", result: prompt }) + "\\n")
})
`
    const runner = new ClaudeStreamRunner(() => ({
      command: process.execPath,
      args: ["-e", cancellableFixture, "--", "--output-format", "json"],
      cwd: process.cwd(),
    }))
    try {
      const controller = new AbortController()
      const turn = runner.run({ ...request, prompt: "hang" }, async () => false, controller.signal)
      setTimeout(() => controller.abort(), 100)
      await expect(turn).rejects.toThrow()

      const next = await runner.run({ ...request, prompt: "ready" }, async () => false)
      expect(next.finalText).toBe("ready")
    } finally {
      await runner.close()
    }
  }, 10_000)
})
