import { describe, expect, it } from "vitest"
import { EventEmitter } from "node:events"
import type { ReadStream, WriteStream } from "node:tty"
import { commandItems, filterCommandItems, filterPickerItems, readCommandLine } from "./terminal-ui.js"
import { WorkspaceScreen } from "./workspace-screen.js"

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

describe("fullscreen command palette", () => {
  it("moves the highlight, completes with Tab, and runs with Enter", async () => {
    const input = new EventEmitter() as ReadStream
    input.isRaw = false
    input.setRawMode = () => input
    input.resume = () => input
    input.pause = () => input
    const writes: string[] = []
    const output = new EventEmitter() as WriteStream
    output.rows = 28
    output.columns = 100
    output.write = ((chunk: string) => { writes.push(chunk); return true }) as WriteStream["write"]
    const screen = new WorkspaceScreen(output, "C:\\work", "OpenCode", "default model")
    screen.start()
    const result = readCommandLine([], input, output, screen)
    input.emit("keypress", "/", { name: "slash" })
    expect(writes.at(-1)?.match(/\/agent \[name\]/g)).toHaveLength(1)
    input.emit("keypress", undefined, { name: "down" })
    input.emit("keypress", undefined, { name: "tab" })
    input.emit("keypress", undefined, { name: "return" })
    expect(await result).toBe("/model")
    expect(writes.join("")).toContain("› /model")
    expect(writes.at(-1)).toContain("› /model")
    screen.stop()
  })
})
