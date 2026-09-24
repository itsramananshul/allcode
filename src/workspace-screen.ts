import type { ReadStream, WriteStream } from "node:tty"
import type { Key } from "node:readline"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { AgentActivity } from "./types.js"

export interface ScreenChoice {
  label: string
  description?: string
}

const gray = "\x1b[90m"
const white = "\x1b[97m"
const surface = "\x1b[48;5;238m"
const inverse = "\x1b[7m"
const reset = "\x1b[0m"
const ansi = /\x1b\[[0-9;]*m/g
const sixelPath = fileURLToPath(new URL("../assets/allcode-mascot.sixel", import.meta.url))
const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version
const mouseKeypresses = new WeakSet<Key>()

export function isMouseKeypress(key: Key): boolean { return mouseKeypresses.has(key) }

function terminalMascot(): string {
  if (process.platform !== "win32" || !process.env.WT_SESSION) return ""
  try { return readFileSync(sixelPath, "ascii") } catch { return "" }
}

function plain(value: string): string {
  return value.replace(ansi, "")
}

function wrap(value: string, width: number): string[] {
  const lines: string[] = []
  for (const source of plain(value).split("\n")) {
    if (!source) { lines.push(""); continue }
    let remaining = source
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width))
      remaining = remaining.slice(width)
    }
    lines.push(remaining)
  }
  return lines
}

function crop(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, Math.max(0, width - 1))}…` : value
}

type TranscriptBlock =
  | { kind: "user" | "system" | "activity"; text: string }
  | { kind: "agent"; text: string; agent: string; elapsedMs: number }

function transcriptLines(blocks: TranscriptBlock[], width: number): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    if (lines.length && lines.at(-1) !== "") lines.push("")
    if (block.kind === "user") {
      const message = wrap(block.text, width - 2)
      for (const line of message) lines.push(`${surface}${white}  ${line.padEnd(width - 2)}${reset}`)
    } else if (block.kind === "agent") {
      lines.push(`${gray}  ${block.agent} · ${(block.elapsedMs / 1000).toFixed(1)}s${reset}`)
      for (const line of wrap(block.text, width - 2)) lines.push(`${white}  ${line}${reset}`)
    } else if (block.kind === "activity") {
      for (const line of wrap(block.text, width - 4)) lines.push(`${gray}  ↳ ${line}${reset}`)
    } else {
      for (const line of wrap(block.text, width - 2)) lines.push(`${gray}  ${line}${reset}`)
    }
  }
  return lines
}

export class WorkspaceScreen {
  private readonly transcript: TranscriptBlock[] = []
  private input = ""
  private cursor = 0
  private choices: ScreenChoice[] = []
  private selected = 0
  private pickerTitle = ""
  private pickerStatus = ""
  private approval?: { title: string; details: string; offset: number; selected: "deny" | "allow" }
  private working = ""
  private liveText = ""
  private liveReasoning = ""
  private activityTimer?: NodeJS.Timeout
  private agent = ""
  private model = ""
  private effort = ""
  private permissionMode = ""
  private readonly mascot = terminalMascot()
  private readonly onResize = (): void => this.render()
  private scrollOffset = 0
  private mouseBuffer = ""
  private mouseInput?: ReadStream
  private mouseSequence = false
  private readonly onMouseKeypress = (_text: string | undefined, key: Key): void => {
    if (key.sequence === "\x1b[<") this.mouseSequence = true
    if (!this.mouseSequence) return
    mouseKeypresses.add(key)
    if (key.sequence === "M" || key.sequence === "m") this.mouseSequence = false
  }
  private readonly onMouseData = (chunk: Buffer | string): void => {
    this.mouseBuffer += chunk.toString()
    const wheel = /\x1b\[<(\d+);\d+;\d+[mM]/g
    let match: RegExpExecArray | null
    let consumed = 0
    while ((match = wheel.exec(this.mouseBuffer))) {
      consumed = wheel.lastIndex
      const button = Number(match[1])
      if ((button & 64) !== 0) this.scrollTranscript((button & 1) === 0 ? 3 : -3)
    }
    const remaining = this.mouseBuffer.slice(consumed)
    const start = remaining.lastIndexOf("\x1b[<")
    this.mouseBuffer = start >= 0 ? remaining.slice(start).slice(-64) : ""
  }

  constructor(
    private readonly output: WriteStream,
    private readonly cwd: string,
    agent: string,
    model: string,
  ) {
    this.agent = agent
    this.model = model
  }

  start(input?: ReadStream): void {
    this.mouseInput = input
    input?.prependListener("keypress", this.onMouseKeypress)
    input?.on("data", this.onMouseData)
    this.output.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?25l")
    this.output.on("resize", this.onResize)
    this.render()
  }

  stop(): void {
    if (this.activityTimer) clearTimeout(this.activityTimer)
    this.mouseInput?.off("data", this.onMouseData)
    this.mouseInput?.off("keypress", this.onMouseKeypress)
    this.output.off("resize", this.onResize)
    this.output.write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l")
  }

  scrollTranscript(delta: number): void {
    if (this.approval) { this.scrollApproval(-delta); return }
    const rows = Math.max(12, this.output.rows ?? 24)
    const width = Math.max(23, (this.output.columns ?? 80) - 1)
    const total = transcriptLines(this.transcript, width).length
    const page = Math.max(1, rows - 13)
    this.scrollOffset = Math.max(0, Math.min(Math.max(0, total - page), this.scrollOffset + delta))
    this.render()
  }

  setRoute(agent: string, model: string): void {
    this.agent = agent
    this.model = model
    this.render()
  }

  setExecutionSettings(effort: string | undefined, permissionMode: string | undefined): void {
    this.effort = effort ?? "default effort"
    this.permissionMode = permissionMode ?? "native permissions"
    this.render()
  }

  append(value: string): void {
    this.transcript.push({ kind: "system", text: value.trimEnd() })
    this.render()
  }

  appendUser(value: string): void {
    this.transcript.push({ kind: "user", text: value })
    this.render()
  }

  appendAgent(agent: string, value: string, elapsedMs: number): void {
    this.transcript.push({ kind: "agent", agent, text: value, elapsedMs })
    this.render()
  }

  appendActivity(activity: AgentActivity): void {
    if (activity.kind === "text" || activity.kind === "reasoning") {
      const key = activity.kind === "text" ? "liveText" : "liveReasoning"
      this[key] = (this[key] + activity.text).slice(-6000)
      if (!this.activityTimer) this.activityTimer = setTimeout(() => {
        this.activityTimer = undefined
        this.render()
      }, 60)
      return
    }
    this.transcript.push({ kind: "activity", text: activity.text })
    this.render()
  }

  clearLiveActivity(): void {
    this.liveText = ""
    this.liveReasoning = ""
    if (this.activityTimer) clearTimeout(this.activityTimer)
    this.activityTimer = undefined
    this.render()
  }

  clear(): void {
    this.transcript.length = 0
    this.scrollOffset = 0
    this.liveText = ""
    this.liveReasoning = ""
    this.render()
  }

  setWorking(value: string): void {
    this.working = value
    this.render()
  }

  setInput(value: string, cursor: number, choices: ScreenChoice[] = [], selected = 0, title = "", status = ""): void {
    this.input = value
    this.cursor = cursor
    this.choices = choices
    this.selected = selected
    this.pickerTitle = title
    this.pickerStatus = status
    this.render()
  }

  showApproval(title: string, details: string): void {
    this.approval = { title, details, offset: 0, selected: "deny" }
    this.render()
  }

  scrollApproval(delta: number): void {
    if (!this.approval) return
    const width = Math.max(23, (this.output.columns ?? 80) - 3)
    const count = 2 + this.approval.details.split("\n").flatMap((line) => wrap(line, width)).length
    const page = Math.max(1, (this.output.rows ?? 24) - 13)
    this.approval.offset = Math.max(0, Math.min(Math.max(0, count - page), this.approval.offset + delta))
    this.render()
  }

  selectApproval(value: "deny" | "allow"): void {
    if (!this.approval) return
    this.approval.selected = value
    this.render()
  }

  approvalSelection(): "deny" | "allow" { return this.approval?.selected ?? "deny" }

  closeApproval(): void { this.approval = undefined; this.render() }

  private render(): void {
    const rows = Math.max(12, this.output.rows ?? 24)
    const columns = Math.max(24, this.output.columns ?? 80)
    const width = columns - 1
    const frame = Array<string>(rows).fill("")
    const heading = this.mascot ? "                    " : "  "
    frame[0] = `${white}${heading}AllCode v${version}${reset}`
    frame[1] = `${white}${heading}${this.agent}${reset} ${gray}· ${this.model}${reset}`
    frame[2] = `${gray}${heading}${crop(this.cwd, Math.max(1, width - heading.length))}${reset}`
    frame[6] = `${gray}  One workspace. Every coding agent. Type / for commands.${reset}`

    const inputWidth = Math.max(1, width - 3)
    const inputValue = this.approval ? "" : this.input
    const inputCursor = Math.min(this.cursor, inputValue.length)
    const inputLines: string[] = []
    for (let index = 0; index <= inputValue.length; index += inputWidth) {
      inputLines.push(inputValue.slice(index, index + inputWidth))
    }
    const cursorInputRow = Math.floor(inputCursor / inputWidth)
    const maxInputRows = Math.max(1, Math.min(6, rows - 10))
    const firstInputRow = Math.max(0, cursorInputRow - maxInputRows + 1)
    const visibleInput = inputLines.slice(firstInputRow, firstInputRow + maxInputRows)
    const inputRows = visibleInput.length
    const inputTop = rows - inputRows - 3

    const menuCapacity = Math.max(0, rows - (this.pickerTitle ? 15 : 13) - inputRows + 1)
    const shownChoices = this.approval ? [] : this.choices.slice(0, menuCapacity)
    const menuStart = inputTop - shownChoices.length
    if (this.pickerTitle) frame[menuStart - 2] = `${white}  ${crop(this.pickerTitle, width - 2)}${reset}`
    for (let index = 0; index < shownChoices.length; index += 1) {
      const choice = shownChoices[index]!
      const label = choice.label.padEnd(Math.min(28, Math.max(...shownChoices.map((item) => item.label.length))))
      const line = crop(`  ${label}  ${choice.description ?? ""}`, width)
      frame[menuStart + index] = index === this.selected ? `${inverse}${white}${line}${reset}` : `${gray}${line}${reset}`
    }

    const bodyEnd = menuStart - (this.pickerTitle ? 3 : 1)
    const bodyStart = 8
    const bodyHeight = Math.max(0, bodyEnd - bodyStart)
    const transcript = transcriptLines(this.transcript, width)
    if (this.liveReasoning) {
      if (transcript.length && transcript.at(-1) !== "") transcript.push("")
      transcript.push(`${gray}  Reasoning${reset}`)
      transcript.push(...wrap(this.liveReasoning, width - 2).map((line) => `${gray}  ${line}${reset}`))
    }
    if (this.liveText) {
      if (transcript.length && transcript.at(-1) !== "") transcript.push("")
      transcript.push(...wrap(this.liveText, width - 2).map((line) => `${white}  ${line}${reset}`))
    }
    if (this.working) {
      if (transcript.length && transcript.at(-1) !== "") transcript.push("")
      transcript.push(...wrap(`◈ ${this.working}`, width - 2).map((line) => `${gray}  ${line}${reset}`))
    }
    const approvalLines = this.approval
      ? [`${white}${this.approval.title}${reset}`, "", ...this.approval.details.split("\n").flatMap((line) => wrap(line, width))]
      : []
    const visible = this.approval
      ? approvalLines.slice(this.approval.offset, this.approval.offset + bodyHeight)
      : transcript.slice(Math.max(0, transcript.length - bodyHeight - this.scrollOffset), transcript.length - this.scrollOffset || undefined)
    for (let index = 0; index < visible.length; index += 1) frame[bodyStart + index] = visible[index]!

    frame[inputTop] = `${gray}${"─".repeat(width)}${reset}`
    for (let index = 0; index < inputRows; index += 1) {
      const absoluteRow = firstInputRow + index
      const prefix = absoluteRow === 0 ? "› " : "  "
      frame[inputTop + index + 1] = this.approval
        ? `  ${this.approval.selected === "deny" ? inverse : ""}D Deny${reset}    ${this.approval.selected === "allow" ? inverse : ""}A Allow once${reset}`
        : `${white}${prefix}${visibleInput[index]}${reset}`
    }
    frame[rows - 2] = `${gray}${"─".repeat(width)}${reset}`
    frame[rows - 1] = this.approval
      ? `${gray}  ↑↓/PgUp/PgDn inspect request · Tab switch · Enter choose · Esc deny${reset}`
      : `${gray}  ${this.pickerStatus || (this.choices.length ? "↑↓ browse · Tab complete · Enter run · Esc close" : this.scrollOffset ? `↑ ${this.scrollOffset} lines above latest · PgDn to return` : crop(`${this.agent} · ${this.model} · ${this.effort} · ${this.permissionMode}`, width - 2))}${reset}`

    let buffer = "\x1b[?25l"
    for (let row = 0; row < rows; row += 1) buffer += `\x1b[${row + 1};1H\x1b[2K${frame[row]}`
    if (this.mascot) buffer += `\x1b[1;2H${this.mascot}`
    const cursorColumn = Math.max(3, Math.min(columns, 3 + inputCursor % inputWidth))
    const cursorRow = inputTop + 2 + cursorInputRow - firstInputRow
    buffer += `\x1b[${cursorRow};${cursorColumn}H${this.approval ? "\x1b[?25l" : "\x1b[?25h"}`
    this.output.write(buffer)
  }
}
