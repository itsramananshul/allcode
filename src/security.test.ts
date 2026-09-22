import { mkdtempSync, mkdirSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { validateWorkspace } from "./security.js"

describe("workspace boundaries", () => {
  it("accepts a root and descendants but rejects sibling directories", () => {
    const parent = mkdtempSync(join(tmpdir(), "all-code-security-"))
    const root = join(parent, "root")
    const nested = join(root, "nested")
    const sibling = join(parent, "sibling")
    mkdirSync(nested, { recursive: true })
    mkdirSync(sibling)

    expect(validateWorkspace(root, [root])).toBe(realpathSync(root))
    expect(validateWorkspace(nested, [root])).toBe(realpathSync(nested))
    expect(() => validateWorkspace(sibling, [root])).toThrow("outside ALL_CODE_ALLOWED_ROOTS")
  })

  it("rejects missing workspaces", () => {
    const root = mkdtempSync(join(tmpdir(), "all-code-security-"))
    expect(() => validateWorkspace(join(root, "missing"), [root])).toThrow("does not exist")
  })
})
