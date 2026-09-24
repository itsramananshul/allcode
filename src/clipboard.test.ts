import { describe, expect, it } from "vitest"
import { clipboardInvocations, copyToClipboard } from "./clipboard.js"
import type { ProcessResult } from "./types.js"

describe("conversation clipboard", () => {
  it("sends the complete Unicode transcript over stdin, never a shell argument", async () => {
    const transcript = "hello\n\nClaude Code\nRéponse 🧪"
    const invocations = clipboardInvocations(transcript, "win32")
    expect(invocations).toHaveLength(1)
    expect(invocations[0]?.stdin).toBe(transcript)
    expect(invocations[0]?.args.join(" ")).not.toContain(transcript)
    const seen: string[] = []
    await copyToClipboard(transcript, async (invocation) => {
      seen.push(invocation.stdin ?? "")
      return { exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false } satisfies ProcessResult
    })
    expect(seen).toEqual([transcript])
  })

  it("uses a native clipboard utility on each supported desktop platform", () => {
    expect(clipboardInvocations("x", "darwin")[0]?.command).toBe("pbcopy")
    expect(clipboardInvocations("x", "linux", true)[0]?.command).toBe("wl-copy")
    expect(clipboardInvocations("x", "linux", false)[0]?.command).toBe("xclip")
  })
})
