import { describe, expect, it } from "vitest"
import { ClaudeAdapter, CodexAdapter, OpenCodeAdapter } from "./adapters.js"
import { delimiter } from "node:path"

const base = { prompt: "Fix the tests", cwd: "C:\\work", agent: "claude" as const }

describe("agent adapters", () => {
  it("runs Claude non-interactively without bypassing permissions", () => {
    const invocation = new ClaudeAdapter().buildInvocation(base, "claude.exe")
    expect(invocation.stdin).toBe("Fix the tests")
    expect(invocation.args).toContain("acceptEdits")
    expect(invocation.args.join(" ")).not.toContain("bypassPermissions")
  })

  it("routes Claude manual approvals to All Code and passes effort", () => {
    const invocation = new ClaudeAdapter().buildInvocation({
      ...base, permissionMode: "manual", effort: "high", approval: { port: 41000, token: "test-token" },
    }, "claude.exe")
    expect(invocation.args).toEqual(expect.arrayContaining([
      "--permission-mode", "manual", "--permission-prompts", "host",
      "--permission-prompt-tool", "mcp__allcode__approval_prompt", "--effort", "high",
    ]))
    expect(invocation.env?.ALL_CODE_APPROVAL_PORT).toBe("41000")
  })

  it("passes OpenCode a native provider/model ID", () => {
    const invocation = new OpenCodeAdapter().buildInvocation(
      { ...base, agent: "opencode", model: "opencode/big-pickle" }, "opencode.exe",
    )
    expect(invocation.args).toEqual(expect.arrayContaining(["--model", "opencode/big-pickle", "Fix the tests"]))
  })

  it("asks OpenCode for permissions without replacing configured denials", () => {
    const previous = process.env.OPENCODE_CONFIG_CONTENT
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({ permission: { "*": "allow", edit: "deny" } })
    try {
      const invocation = new OpenCodeAdapter().buildInvocation({
        ...base, agent: "opencode", permissionMode: "ask", effort: "high",
      }, "opencode.exe")
      expect(invocation.args).toContain("--variant")
      const config = JSON.parse(invocation.env!.OPENCODE_CONFIG_CONTENT!) as { permission: Record<string, string> }
      expect(config.permission).toMatchObject({ "*": "ask", edit: "deny" })
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
      else process.env.OPENCODE_CONFIG_CONTENT = previous
    }
  })

  it("preserves configured workspace roots and delegation depth", () => {
    const previousRoots = process.env.ALL_CODE_ALLOWED_ROOTS
    const previousMaxDepth = process.env.ALL_CODE_MAX_DEPTH
    process.env.ALL_CODE_ALLOWED_ROOTS = ["C:\\first", "C:\\second"].join(delimiter)
    process.env.ALL_CODE_MAX_DEPTH = "7"
    try {
      const invocation = new OpenCodeAdapter().buildInvocation(
        { ...base, agent: "opencode" }, "opencode.exe",
      )
      expect(invocation.env?.ALL_CODE_ALLOWED_ROOTS).toContain("C:\\first")
      expect(invocation.env?.ALL_CODE_ALLOWED_ROOTS).toContain("C:\\work")
      expect(invocation.env?.ALL_CODE_MAX_DEPTH).toBe("7")
    } finally {
      if (previousRoots === undefined) delete process.env.ALL_CODE_ALLOWED_ROOTS
      else process.env.ALL_CODE_ALLOWED_ROOTS = previousRoots
      if (previousMaxDepth === undefined) delete process.env.ALL_CODE_MAX_DEPTH
      else process.env.ALL_CODE_MAX_DEPTH = previousMaxDepth
    }
  })

  it("reports invalid inherited OpenCode configuration clearly", () => {
    const previous = process.env.OPENCODE_CONFIG_CONTENT
    process.env.OPENCODE_CONFIG_CONTENT = "not-json"
    try {
      expect(() => new OpenCodeAdapter().buildInvocation(
        { ...base, agent: "opencode" }, "opencode.exe",
      )).toThrow("must contain valid JSON")
    } finally {
      if (previous === undefined) delete process.env.OPENCODE_CONFIG_CONTENT
      else process.env.OPENCODE_CONFIG_CONTENT = previous
    }
  })

  it("keeps Codex inside workspace-write sandbox", () => {
    const invocation = new CodexAdapter().buildInvocation(
      { ...base, agent: "codex", sessionId: "019c-session" }, "codex.exe",
    )
    expect(invocation.args).toEqual(expect.arrayContaining(["--sandbox", "workspace-write", "resume", "019c-session", "-"]))
    expect(invocation.args.join(" ")).not.toContain("dangerously")
  })

  it("passes Codex effort through its configuration", () => {
    const invocation = new CodexAdapter().buildInvocation({ ...base, agent: "codex", effort: "high", permissionMode: "workspace-write" }, "codex.exe")
    expect(invocation.args).toContain('model_reasoning_effort="high"')
  })
})
