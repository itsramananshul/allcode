import { describe, expect, it } from "vitest"
import { EventEmitter } from "node:events"
import type { ReadStream, WriteStream } from "node:tty"
import { commandItems, filterCommandItems, filterPickerItems, pickItem, promptApproval, readCommandLine } from "./terminal-ui.js"
import { WorkspaceScreen } from "./workspace-screen.js"

describe("command palette", () => {
  it("opens with every All Code command", () => {
    expect(filterCommandItems("/")).toEqual(commandItems)
  })

  it("filters commands while the user types", () => {
    expect(filterCommandItems("/mo").map((item) => item.command)).toEqual(["/model", "/models", "/mode"])
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
    expect(writes.at(-1)).toContain("\x1b[48;5;238m\x1b[97m  /model")
    screen.stop()
  })

  it("chooses an exact slash command before longer prefix matches", async () => {
    const input = new EventEmitter() as ReadStream
    input.isRaw = false
    input.setRawMode = () => input
    input.resume = () => input
    input.pause = () => input
    const output = new EventEmitter() as WriteStream
    output.rows = 28
    output.columns = 100
    output.write = (() => true) as WriteStream["write"]
    const screen = new WorkspaceScreen(output, "C:\\work", "Codex", "default")
    screen.start()
    const result = readCommandLine([], input, output, screen)
    for (const character of "/mode") input.emit("keypress", character, { name: character })
    input.emit("keypress", undefined, { name: "return" })
    expect(await result).toBe("/mode")
    screen.stop()
  })
})

describe("model selection", () => {
  it("reaches models beyond the first visible page using only arrows and Enter", async () => {
    const input = new EventEmitter() as ReadStream
    input.isRaw = false
    input.setRawMode = () => input
    input.resume = () => input
    input.pause = () => input
    const writes: string[] = []
    const output = new EventEmitter() as WriteStream
    output.rows = 24
    output.columns = 100
    output.write = ((chunk: string) => { writes.push(chunk); return true }) as WriteStream["write"]
    const screen = new WorkspaceScreen(output, "C:\\work", "OpenCode", "default model")
    screen.start()
    const items = Array.from({ length: 15 }, (_, index) => ({ value: `provider/model-${index + 1}`, label: `Model ${index + 1}` }))
    const result = pickItem("Select a model", items, { limit: 4 }, input, output, screen)
    for (let index = 0; index < 6; index += 1) input.emit("keypress", undefined, { name: "down" })
    expect(writes.at(-1)).toContain("7/15")
    expect(writes.at(-1)).toContain("7. Model 7")
    input.emit("keypress", undefined, { name: "return" })
    expect(await result).toBe("provider/model-7")
    screen.stop()
  })
})

describe("approval prompt", () => {
  it("starts on deny and requires an explicit decision", async () => {
    const input = new EventEmitter() as ReadStream
    input.isRaw = false
    input.setRawMode = () => input
    input.resume = () => input
    input.pause = () => input
    const output = new EventEmitter() as WriteStream
    output.rows = 24
    output.columns = 100
    output.write = (() => true) as WriteStream["write"]
    const screen = new WorkspaceScreen(output, "C:\\work", "Claude Code", "default")
    screen.start()
    const denied = promptApproval("Write", "file: note.txt", screen, input)
    expect(screen.approvalSelection()).toBe("deny")
    input.emit("keypress", undefined, { name: "return" })
    expect(await denied).toBe(false)
    const allowed = promptApproval("Write", "file: note.txt", screen, input)
    input.emit("keypress", undefined, { name: "tab" })
    input.emit("keypress", undefined, { name: "return" })
    expect(await allowed).toBe(true)
    screen.stop()
  })
})

describe("mascot header", () => {
  it("uses the full mascot image in Windows Terminal", () => {
    if (process.platform !== "win32") return
    const previous = process.env.WT_SESSION
    process.env.WT_SESSION = "allcode-test"
    try {
      const output = new EventEmitter() as WriteStream
      output.rows = 24
      output.columns = 100
      const writes: string[] = []
      output.write = ((chunk: string) => { writes.push(chunk); return true }) as WriteStream["write"]
      const screen = new WorkspaceScreen(output, "C:\\work", "OpenCode", "default")
      screen.start()
      expect(writes.join("")).toContain("\x1bP0;1q")
      expect(writes.join("")).not.toContain("< ■ >")
      screen.stop()
    } finally {
      if (previous === undefined) delete process.env.WT_SESSION
      else process.env.WT_SESSION = previous
    }
  })
})
