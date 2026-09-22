import { describe, expect, it } from "vitest"
import { parseCodexModels, parseOpenCodeModels } from "./models.js"

describe("model discovery parsers", () => {
  it("parses OpenCode model IDs and marks free routes", () => {
    const models = parseOpenCodeModels("opencode/big-pickle\nopencode-go/glm-5.3\n")
    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({ id: "opencode/big-pickle", isFree: true })
  })

  it("parses visible Codex models", () => {
    const models = parseCodexModels({ data: [
      { model: "gpt-test", displayName: "GPT Test", description: "Test", hidden: false, isDefault: true },
      { model: "hidden", displayName: "Hidden", hidden: true },
    ] })
    expect(models).toEqual([expect.objectContaining({ id: "gpt-test", label: "GPT Test", isDefault: true })])
  })
})
