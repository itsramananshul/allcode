import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { prepareAdapterDraft } from "./adapter-draft.js"

describe("adapter draft reuse", () => {
  it("reuses an empty draft instead of blocking the agent", () => {
    const cwd = mkdtempSync(join(tmpdir(), "allcode-draft-"))
    try {
      const first = prepareAdapterDraft(cwd, "gemini")
      const second = prepareAdapterDraft(cwd, "gemini")
      expect(first.reused).toBe(false)
      expect(second).toEqual({ directory: first.directory, reused: true })
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })

  it("keeps existing draft files intact for the agent to review", () => {
    const cwd = mkdtempSync(join(tmpdir(), "allcode-draft-"))
    try {
      const directory = join(cwd, ".allcode", "adapter-drafts", "gemini")
      mkdirSync(directory, { recursive: true })
      const file = join(directory, "notes.txt")
      writeFileSync(file, "unfinished adapter")
      expect(prepareAdapterDraft(cwd, "gemini")).toEqual({ directory, reused: true })
      expect(readFileSync(file, "utf8")).toBe("unfinished adapter")
      expect(() => prepareAdapterDraft(cwd, "../other")).toThrow("lowercase slug")
    } finally { rmSync(cwd, { recursive: true, force: true }) }
  })
})
