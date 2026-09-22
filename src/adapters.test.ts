import { describe, expect, it } from "vitest"
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter } from "./adapters.js"

const base = { prompt: "Fix the tests", cwd: "C:\\work", agent: "claude" as const }

describe("agent adapters", () => {
  it("runs Claude non-interactively without bypassing permissions", () => {
    const invocation = new ClaudeAdapter().buildInvocation(base, "claude.exe")
    expect(invocation.stdin).toBe("Fix the tests")
    expect(invocation.args).toContain("acceptEdits")
    expect(invocation.args.join(" ")).not.toContain("bypassPermissions")
  })

  it("passes OpenCode a native provider/model ID", () => {
    const invocation = new OpenCodeAdapter().buildInvocation(
      { ...base, agent: "opencode", model: "opencode/big-pickle" }, "opencode.exe",
    )
    expect(invocation.args).toEqual(expect.arrayContaining(["--model", "opencode/big-pickle", "Fix the tests"]))
  })

  it("keeps Codex inside workspace-write sandbox", () => {
    const invocation = new CodexAdapter().buildInvocation(
      { ...base, agent: "codex", sessionId: "019c-session" }, "codex.exe",
    )
    expect(invocation.args).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", "resume", "019c-session", "-"]))
    expect(invocation.args.join(" ")).not.toContain("dangerously")
  })
})
