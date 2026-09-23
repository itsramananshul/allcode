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
})
