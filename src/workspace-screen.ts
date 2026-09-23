import type { WriteStream } from "node:tty"

export interface ScreenChoice {
  label: string
  description?: string
}

const gray = "\x1b[90m"
const white = "\x1b[97m"
const inverse = "\x1b[7m"
const reset = "\x1b[0m"
const ansi = /\x1b\[[0-9;]*m/g

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

export class WorkspaceScreen {
  private readonly transcript: string[] = []
  private input = ""
  private cursor = 0
  private choices: ScreenChoice[] = []
  private selected = 0
  private working = ""
  private agent = ""
  private model = ""
  private readonly onResize = (): void => this.render()

  constructor(
    private readonly output: WriteStream,
    private readonly cwd: string,
    agent: string,
    model: string,
  ) {
    this.agent = agent
    this.model = model
  }

  start(): void {
    this.output.write("\x1b[?1049h\x1b[?25l")
    this.output.on("resize", this.onResize)
    this.render()
  }

  stop(): void {
    this.output.off("resize", this.onResize)
    this.output.write("\x1b[?25h\x1b[?1049l")
  }

  setRoute(agent: string, model: string): void {
    this.agent = agent
    this.model = model
    this.render()
  }

  append(value: string): void {
    this.transcript.push(...value.replace(/\n$/, "").split("\n"))
    this.render()
  }

  clear(): void {
    this.transcript.length = 0
    this.render()
  }

  setWorking(value: string): void {
    this.working = value
    this.render()
  }

  setInput(value: string, cursor: number, choices: ScreenChoice[] = [], selected = 0): void {
    this.input = value
    this.cursor = cursor
    this.choices = choices
    this.selected = selected
    this.render()
  }

  private render(): void {
    const rows = Math.max(12, this.output.rows ?? 24)
    const columns = Math.max(24, this.output.columns ?? 80)
    const width = columns - 1
    const frame = Array<string>(rows).fill("")
    frame[0] = `${white}  ╭───────╮  All Code v0.1.0${reset}`
    frame[1] = `${white}  │ < ■ > │  ${this.agent}${reset} ${gray}· ${this.model}${reset}`
    frame[2] = `${white}  ╰───────╯${reset}  ${gray}${crop(this.cwd, Math.max(1, width - 15))}${reset}`
    frame[4] = `${gray}  One workspace. Every coding agent. Type / for commands.${reset}`

    const menuCapacity = Math.max(0, rows - 11)
    const shownChoices = this.choices.slice(0, menuCapacity)
    const menuStart = rows - 4 - shownChoices.length
    for (let index = 0; index < shownChoices.length; index += 1) {
      const choice = shownChoices[index]!
      const label = choice.label.padEnd(Math.min(28, Math.max(...shownChoices.map((item) => item.label.length))))
      const line = crop(`  ${label}  ${choice.description ?? ""}`, width)
      frame[menuStart + index] = index === this.selected ? `${inverse}${white}${line}${reset}` : `${gray}${line}${reset}`
    }

    const bodyEnd = menuStart - 1
    const bodyStart = 6
    const bodyHeight = Math.max(0, bodyEnd - bodyStart)
    const transcript = this.transcript.flatMap((line) => wrap(line, width))
    if (this.working) transcript.push(...wrap(`◈ ${this.working}`, width))
    const visible = transcript.slice(-bodyHeight)
    for (let index = 0; index < visible.length; index += 1) frame[bodyStart + index] = visible[index]!

    frame[rows - 4] = `${gray}${"─".repeat(width)}${reset}`
    const inputWidth = Math.max(1, width - 3)
    const inputStart = Math.max(0, this.cursor - inputWidth + 1)
    frame[rows - 3] = `${white}› ${this.input.slice(inputStart, inputStart + inputWidth)}${reset}`
    frame[rows - 2] = `${gray}${"─".repeat(width)}${reset}`
    frame[rows - 1] = `${gray}  ${this.choices.length ? "↑↓ browse · Tab complete · Enter run · Esc close" : `${this.agent} · ${this.model}`}${reset}`

    let buffer = "\x1b[?25l"
    for (let row = 0; row < rows; row += 1) buffer += `\x1b[${row + 1};1H\x1b[2K${frame[row]}`
    const cursorColumn = Math.max(3, Math.min(columns, 3 + this.cursor - inputStart))
    buffer += `\x1b[${rows - 2};${cursorColumn}H\x1b[?25h`
    this.output.write(buffer)
  }
}
