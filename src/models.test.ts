import { describe, expect, it } from "vitest"
import { parseCodexModels, parseOpenCodeModels } from "./models.js"

describe("model discovery parsers", () => {
  it("parses OpenCode model IDs and marks free routes", () => {
    const models = parseOpenCodeModels("opencode/big-pickle\nopencode/mimo-v2-flash-free\nopencode/anthropic/claude-sonnet\nopencode-go/glm-5.3\n")
    expect(models).toHaveLength(4)
    expect(models[0]).toMatchObject({ id: "opencode/big-pickle", isFree: true })
    expect(models[1]).toMatchObject({ isFree: true })
    expect(models[2]).toMatchObject({ isFree: false })
    expect(models[3]).toMatchObject({ isFree: false })
  })

  it("parses visible Codex models", () => {
    const models = parseCodexModels({ data: [
      { model: "gpt-test", displayName: "GPT Test", description: "Test", hidden: false, isDefault: true },
      { model: "hidden", displayName: "Hidden", hidden: true },
    ] })
    expect(models).toEqual([expect.objectContaining({ id: "gpt-test", label: "GPT Test", isDefault: true })])
  })
})
