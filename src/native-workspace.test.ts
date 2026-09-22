import { describe, expect, it } from "vitest"
import { AgentCommandInterceptor, decodedInputCharacters, nativeLaunch } from "./native-workspace.js"

describe("/agent interception", () => {
  it("passes native slash commands through", () => {
    const input = new AgentCommandInterceptor()
    expect(input.feed("/model").forward).toBe("/model")
    expect(input.feed("\r")).toEqual({ forward: "\r" })
  })

  it("switches with an explicit agent", () => {
    const input = new AgentCommandInterceptor()
    expect(input.feed("/agent opencode\r")).toEqual({ forward: "/agent opencode", agent: "opencode", showPicker: false })
  })

  it("opens the picker for bare /agent", () => {
    const input = new AgentCommandInterceptor()
    expect(input.feed("/agent\r")).toEqual({ forward: "/agent", agent: undefined, showPicker: true })
  })

  it("recognizes a pasted command wrapped in terminal control sequences", () => {
    const input = new AgentCommandInterceptor()
    expect(input.feed("\x1b[200~/agent claude\x1b[201~\r")).toMatchObject({ agent: "claude", showPicker: false })
  })

  it("recognizes Windows ConPTY input-mode key events", () => {
    const input = new AgentCommandInterceptor()
    const key = (character: string) => `\x1b[0;0;${character.codePointAt(0)};1;0;1_\x1b[0;0;${character.codePointAt(0)};0;0;1_`
    const encoded = [..."/agent opencode\r"].map(key).join("")
    const result = input.feed(encoded)
    expect(result).toMatchObject({ agent: "opencode", showPicker: false })
    expect(decodedInputCharacters(result.forward).join("")).toBe("/agent opencode")
  })
})

describe("native launch environment", () => {
  it("provides a capable terminal type to native TUIs", () => {
    const previous = process.env.TERM
    process.env.TERM = "dumb"
    try {
      expect(nativeLaunch("codex", process.cwd()).env.TERM).toBe("xterm-256color")
    } finally {
      if (previous === undefined) delete process.env.TERM
      else process.env.TERM = previous
    }
  })
})

describe("Windows terminal input", () => {
  it("decodes key-down events and ignores key-up events", () => {
    expect(decodedInputCharacters("\x1b[49;2;49;1;0;1_\x1b[49;2;49;0;0;1_")).toEqual(["1"])
  })
})
