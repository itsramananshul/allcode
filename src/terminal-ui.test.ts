import { describe, expect, it } from "vitest"
import { commandItems, filterCommandItems, filterPickerItems } from "./terminal-ui.js"

describe("command palette", () => {
  it("opens with every All Code command", () => {
    expect(filterCommandItems("/")).toEqual(commandItems)
  })

  it("filters commands while the user types", () => {
    expect(filterCommandItems("/mo").map((item) => item.command)).toEqual(["/model", "/models"])
  })

  it("closes after command arguments begin", () => {
    expect(filterCommandItems("/agent codex")).toEqual([])
  })
})

describe("interactive picker", () => {
  const items = [
    { value: "claude", label: "Claude Code", description: "Anthropic" },
    { value: "opencode", label: "OpenCode", description: "Provider catalog" },
    { value: "codex", label: "Codex", description: "OpenAI" },
  ]

  it("searches values, labels, and descriptions", () => {
    expect(filterPickerItems("provider", items).map((item) => item.value)).toEqual(["opencode"])
    expect(filterPickerItems("openai", items).map((item) => item.value)).toEqual(["codex"])
  })
})
