import { emitKeypressEvents, type Key } from "node:readline"
import { stdin as defaultInput, stdout as defaultOutput } from "node:process"
import type { ReadStream, WriteStream } from "node:tty"

const white = "\x1b[97m"
const gray = "\x1b[90m"
const inverse = "\x1b[7m"
const reset = "\x1b[0m"

export interface CommandItem {
  command: string
  usage: string
  description: string
}

export interface PickerItem<T extends string> {
  value: T
  label: string
  description?: string
}

export const commandItems: CommandItem[] = [
  { command: "/agent", usage: "/agent [name]", description: "Choose Claude Code, OpenCode, or Codex" },
  { command: "/model", usage: "/model [id]", description: "Choose a model for the active agent" },
  { command: "/models", usage: "/models", description: "Show models from every agent" },
  { command: "/status", usage: "/status", description: "Show the active route and session" },
  { command: "/clear", usage: "/clear", description: "Redraw the All Code workspace" },
  { command: "/help", usage: "/help", description: "Show the command reference" },
  { command: "/exit", usage: "/exit", description: "Exit All Code" },
  { command: "/provider", usage: "/provider [name]", description: "Alias for /agent" },
  { command: "/quit", usage: "/quit", description: "Alias for /exit" },
]

export function filterCommandItems(buffer: string, items = commandItems): CommandItem[] {
  if (!buffer.startsWith("/") || /\s/.test(buffer)) return []
  const query = buffer.toLowerCase()
  return items.filter((item) => item.command.startsWith(query))
}

export function filterPickerItems<T extends string>(query: string, items: PickerItem<T>[]): PickerItem<T>[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return items
  return items.filter((item) => `${item.value} ${item.label} ${item.description ?? ""}`.toLowerCase().includes(needle))
}

function clip(value: string, width: number): string {
  if (value.length <= width) return value
  return width <= 1 ? "…" : `${value.slice(0, width - 1)}…`
}

function moveToInput(output: WriteStream, promptWidth: number, cursor: number): void {
  output.write("\x1b[u")
  const columns = promptWidth + cursor
  if (columns > 0) output.write(`\x1b[${columns}C`)
}

function startRawInput(input: ReadStream): { wasRaw: boolean; wasFlowing: boolean } {
  emitKeypressEvents(input)
  const wasRaw = Boolean(input.isRaw)
  const wasFlowing = input.readableFlowing === true
  input.setRawMode(true)
  input.resume()
  return { wasRaw, wasFlowing }
}

function stopRawInput(input: ReadStream, wasRaw: boolean, wasFlowing: boolean): void {
  input.setRawMode(wasRaw)
  if (!wasFlowing) input.pause()
}

function insertAt(value: string, cursor: number, addition: string): { value: string; cursor: number } {
  return {
    value: `${value.slice(0, cursor)}${addition}${value.slice(cursor)}`,
    cursor: cursor + addition.length,
  }
}

export async function readCommandLine(
  history: string[],
  input: ReadStream = defaultInput,
  output: WriteStream = defaultOutput,
): Promise<string> {
  let value = ""
  let cursor = 0
  let selected = 0
  let dismissed = false
  let historyIndex = history.length
  const prompt = "› "
  const { wasRaw, wasFlowing } = startRawInput(input)
  output.write("\x1b[s")

  const visibleItems = (): CommandItem[] => dismissed ? [] : filterCommandItems(value)
  const render = (): void => {
    const matches = visibleItems()
    if (selected >= matches.length) selected = Math.max(0, matches.length - 1)
    const width = Math.max(40, output.columns ?? 100)
    output.write("\x1b[u\x1b[0J")
    output.write(`${white}${prompt}${reset}${value}`)
    if (matches.length > 0) {
      const usageWidth = Math.min(24, Math.max(...matches.map((item) => item.usage.length)))
      output.write("\n")
      matches.forEach((item, index) => {
        const usage = item.usage.padEnd(usageWidth)
        const line = `  ${usage}  ${item.description}`
        const content = clip(line, width - 1)
        output.write(index === selected ? `${inverse}${white}${content}${reset}` : `${gray}${content}${reset}`)
        if (index < matches.length - 1) output.write("\n")
      })
    }
    moveToInput(output, prompt.length, cursor)
  }

  return await new Promise<string>((resolve) => {
    const finish = (result: string): void => {
      input.off("keypress", onKeypress)
      stopRawInput(input, wasRaw, wasFlowing)
      output.write("\x1b[u\x1b[0J")
      output.write(`${white}${prompt}${reset}${result}\n`)
      resolve(result)
    }

    const updateValue = (next: string, nextCursor = next.length): void => {
      value = next
      cursor = nextCursor
      selected = 0
      dismissed = false
      render()
    }

    const onKeypress = (text: string | undefined, key: Key): void => {
      const matches = visibleItems()
      if (key.ctrl && key.name === "c") {
        if (value) updateValue("")
        else finish("/exit")
        return
      }
      if (key.ctrl && key.name === "d" && !value) { finish("/exit"); return }
      if (key.ctrl && key.name === "a") { cursor = 0; render(); return }
      if (key.ctrl && key.name === "e") { cursor = value.length; render(); return }
      if (key.ctrl && key.name === "u") { updateValue(""); return }
      if (key.name === "escape") { dismissed = true; render(); return }
      if (key.name === "up") {
        if (matches.length > 0) selected = (selected - 1 + matches.length) % matches.length
        else if (history.length > 0) {
          historyIndex = Math.max(0, historyIndex - 1)
          value = history[historyIndex] ?? ""
          cursor = value.length
        }
        render()
        return
      }
      if (key.name === "down") {
        if (matches.length > 0) selected = (selected + 1) % matches.length
        else if (historyIndex < history.length) {
          historyIndex += 1
          value = historyIndex === history.length ? "" : (history[historyIndex] ?? "")
          cursor = value.length
        }
        render()
        return
      }
      if (key.name === "left") { cursor = Math.max(0, cursor - 1); render(); return }
      if (key.name === "right") { cursor = Math.min(value.length, cursor + 1); render(); return }
      if (key.name === "home") { cursor = 0; render(); return }
      if (key.name === "end") { cursor = value.length; render(); return }
      if (key.name === "backspace") {
        if (cursor > 0) updateValue(`${value.slice(0, cursor - 1)}${value.slice(cursor)}`, cursor - 1)
        return
      }
      if (key.name === "delete") {
        if (cursor < value.length) updateValue(`${value.slice(0, cursor)}${value.slice(cursor + 1)}`, cursor)
        return
      }
      if (key.name === "tab" && matches[selected]) {
        const command = matches[selected]!.command
        updateValue(command, command.length)
        return
      }
      if (key.name === "return" || key.name === "enter") {
        const result = matches[selected]?.command ?? value
        finish(result.trim())
        return
      }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        const inserted = insertAt(value, cursor, text)
        updateValue(inserted.value, inserted.cursor)
      }
    }

    input.on("keypress", onKeypress)
    render()
  })
}

export async function pickItem<T extends string>(
  title: string,
  items: PickerItem<T>[],
  options: { current?: T; allowCustom?: boolean; limit?: number } = {},
  input: ReadStream = defaultInput,
  output: WriteStream = defaultOutput,
): Promise<T | undefined> {
  let query = ""
  let cursor = 0
  let selected = Math.max(0, items.findIndex((item) => item.value === options.current))
  const limit = options.limit ?? 10
  const prompt = "Filter: "
  const { wasRaw, wasFlowing } = startRawInput(input)
  output.write("\x1b[s")

  const render = (): void => {
    const matches = filterPickerItems(query, items)
    if (selected >= Math.min(matches.length, limit)) selected = Math.max(0, Math.min(matches.length, limit) - 1)
    const shown = matches.slice(0, limit)
    const width = Math.max(40, output.columns ?? 100)
    output.write("\x1b[u\x1b[0J")
    output.write(`${white}${title}${reset}\n${gray}${prompt}${reset}${query}\n`)
    if (shown.length === 0) {
      const message = options.allowCustom && query ? `Use exact ID: ${query}` : "No matches"
      output.write(`${gray}  ${clip(message, width - 3)}${reset}`)
    } else {
      const labelWidth = Math.min(36, Math.max(...shown.map((item) => item.label.length)))
      shown.forEach((item, index) => {
        const description = item.description ? `  ${item.description}` : ""
        const content = clip(`  ${item.label.padEnd(labelWidth)}${description}`, width - 1)
        output.write(index === selected ? `${inverse}${white}${content}${reset}` : `${gray}${content}${reset}`)
        if (index < shown.length - 1) output.write("\n")
      })
      if (matches.length > limit) output.write(`\n${gray}  ${matches.length - limit} more — type to filter${reset}`)
    }
    output.write("\x1b[u\x1b[1B\r")
    if (prompt.length + cursor > 0) output.write(`\x1b[${prompt.length + cursor}C`)
  }

  return await new Promise<T | undefined>((resolve) => {
    const finish = (result: T | undefined): void => {
      input.off("keypress", onKeypress)
      stopRawInput(input, wasRaw, wasFlowing)
      output.write("\x1b[u\x1b[0J")
      resolve(result)
    }

    const onKeypress = (text: string | undefined, key: Key): void => {
      const matches = filterPickerItems(query, items)
      const shown = matches.slice(0, limit)
      if ((key.ctrl && key.name === "c") || key.name === "escape") { finish(undefined); return }
      if (key.name === "up") { selected = shown.length ? (selected - 1 + shown.length) % shown.length : 0; render(); return }
      if (key.name === "down") { selected = shown.length ? (selected + 1) % shown.length : 0; render(); return }
      if (key.name === "left") { cursor = Math.max(0, cursor - 1); render(); return }
      if (key.name === "right") { cursor = Math.min(query.length, cursor + 1); render(); return }
      if (key.name === "backspace") {
        if (cursor > 0) {
          query = `${query.slice(0, cursor - 1)}${query.slice(cursor)}`
          cursor -= 1
          selected = 0
          render()
        }
        return
      }
      if (key.name === "return" || key.name === "enter") {
        const chosen = shown[selected]
        if (chosen) finish(chosen.value)
        else if (options.allowCustom && query.trim()) finish(query.trim() as T)
        return
      }
      if (text && !key.ctrl && !key.meta && !/[\x00-\x1f\x7f]/.test(text)) {
        const inserted = insertAt(query, cursor, text)
        query = inserted.value
        cursor = inserted.cursor
        selected = 0
        render()
      }
    }

    input.on("keypress", onKeypress)
    render()
  })
}
