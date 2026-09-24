import { EventEmitter } from "node:events"
import { readFileSync } from "node:fs"
import type { WriteStream } from "node:tty"
import { describe, expect, it } from "vitest"
import { WorkspaceScreen } from "./workspace-screen.js"

describe("workspace transcript", () => {
  it("separates highlighted user prompts from labeled agent replies", () => {
    const writes: string[] = []
    const output = Object.assign(new EventEmitter(), {
      columns: 80,
      rows: 30,
      write(value: string) { writes.push(value); return true },
    }) as unknown as WriteStream
    const screen = new WorkspaceScreen(output, "C:\\project", "Claude Code", "default model")

    screen.appendUser("hello")
    screen.appendAgent("Claude Code", "Hi there.", 1200)
    screen.appendUser("next question")
    screen.setWorking("Bombing…")

    const frame = writes.at(-1) ?? ""
    const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version
    expect(frame).toContain(`AllCode v${version}`)
    expect(frame).toContain("\x1b[48;5;238m\x1b[97m  hello")
    expect(frame).toContain("\x1b[90m  Claude Code · 1.2s")
    expect(frame).toContain("\x1b[97m  Hi there.")
    expect(frame).toContain("\x1b[48;5;238m\x1b[97m  next question")
    expect(frame).not.toContain("You ›")
    expect(frame).toMatch(/  hello[^\n]*\x1b\[0m\x1b\[10;1H\x1b\[2K\x1b\[11;1H\x1b\[2K\x1b\[90m  Claude Code/)
    expect(frame).toContain("\x1b[15;1H\x1b[2K\x1b[16;1H\x1b[2K\x1b[90m  ◈ Bombing…")
  })
})
