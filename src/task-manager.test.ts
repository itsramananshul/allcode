import { beforeEach, describe, expect, it, vi } from "vitest"

const runAgent = vi.fn()
vi.mock("./runner.js", () => ({ runAgent }))

describe("delegated task lifecycle", () => {
  beforeEach(() => runAgent.mockReset())

  it("records a completed target-agent result", async () => {
    runAgent.mockResolvedValue({ agent: "codex", exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false, finalText: "done", eventCount: 1 })
    const { TaskManager } = await import("./task-manager.js")
    const manager = new TaskManager()
    const task = manager.start({ agent: "codex", cwd: process.cwd(), prompt: "review" })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(manager.get(task.id)?.state).toBe("completed")
    expect(manager.get(task.id)?.result?.finalText).toBe("done")
  })
})
