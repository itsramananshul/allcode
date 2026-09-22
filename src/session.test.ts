import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SharedSession } from "./session.js"

describe("shared agent context", () => {
  it("hands unseen turns to a newly selected agent and persists them", () => {
    const cwd = mkdtempSync(join(tmpdir(), "all-code-"))
    const session = new SharedSession(cwd, "claude")
    session.recordTurn("claude", "Find the bug", "The bug is in parser.ts")
    expect(session.promptFor("codex", "Fix it")).toContain("The bug is in parser.ts")
    expect(session.promptFor("claude", "Continue")).toBe("Continue")
    expect(JSON.parse(readFileSync(session.path, "utf8")).messages).toHaveLength(2)
  })

  it("shares a failed turn with the next agent without redelivering it to the failing agent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "all-code-"))
    const session = new SharedSession(cwd, "opencode")
    session.recordFailure("opencode", "Inspect the project", "rate limited")
    expect(session.promptFor("opencode", "Retry")).toBe("Retry")
    expect(session.promptFor("codex", "Continue")).toContain("rate limited")
  })
})
