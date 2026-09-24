import * as pty from "node-pty"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { resolveExecutable } from "./executable.js"
import type { AgentName } from "./types.js"
import { isKnownAgent } from "./agent-registry.js"

export interface InterceptResult {
  forward: string
  agent?: AgentName
  showPicker?: boolean
}

export function decodedInputCharacters(data: string): string[] {
  const events = [...data.matchAll(/\x1b\[(\d+);(\d+);(\d+);(\d+);(\d+);(\d+)_/g)]
  if (events.length === 0) return [...data]
  return events
    .filter((event) => event[4] === "1")
    .flatMap((event) => Array.from({ length: Math.max(1, Number(event[6])) }, () => String.fromCodePoint(Number(event[3]))))
}

export class AgentCommandInterceptor {
  #line = ""
  #escapeSequence = ""

  #track(character: string): Omit<InterceptResult, "forward"> | undefined {
    if (character === "\r" || character === "\n") {
      const match = this.#line.trim().match(/^\/agent(?:\s+(claude|opencode|codex|hermes))?\s*$/i)
      this.#line = ""
      if (match) {
        const selected = match[1]?.toLowerCase() as AgentName | undefined
        return { agent: selected, showPicker: !selected }
      }
      return
    }
    if (character === "\x7f" || character === "\b") {
      this.#line = this.#line.slice(0, -1)
      return
    }
    if (character >= " " && character !== "\x7f") {
      this.#line += character
      return
    }
    if (character !== "\t") this.#line = ""
  }

  feed(data: string): InterceptResult {
    let forward = ""
    for (const character of data) {
      if (this.#escapeSequence) {
        this.#escapeSequence += character
        forward += character
        if (/^[\x1b]\[[0-9;?]*[A-Za-z~_]$/.test(this.#escapeSequence)) {
          const completedEscape = this.#escapeSequence
          const win32Input = completedEscape.match(/^\x1b\[(\d+);(\d+);(\d+);(\d+);(\d+);(\d+)_$/)
          this.#escapeSequence = ""
          if (win32Input?.[4] === "1") {
            const inputCharacter = String.fromCodePoint(Number(win32Input[3]))
            const repetitions = Math.max(1, Number(win32Input[6]))
            for (let index = 0; index < repetitions; index += 1) {
              const result = this.#track(inputCharacter)
              if (result) return { forward: forward.slice(0, -completedEscape.length), ...result }
            }
          }
        } else if (this.#escapeSequence.length > 64) {
          this.#escapeSequence = ""
        }
        continue
      }
      if (character === "\x1b") {
        this.#escapeSequence = character
        forward += character
        continue
      }
      const result = this.#track(character)
      if (result) return { forward, ...result }
      forward += character
    }
    return { forward }
  }

  reset(): void {
    this.#line = ""
    this.#escapeSequence = ""
  }
}

function bridgeCommand(): string {
  return fileURLToPath(new URL("./cli.js", import.meta.url))
}

function mcpEnvironment(agent: AgentName, cwd: string): Record<string, string> {
  return {
    ALL_CODE_HOST: agent,
    ALL_CODE_ALLOWED_ROOTS: cwd,
    ALL_CODE_DEPTH: process.env.ALL_CODE_DEPTH ?? "0",
  }
}

export function nativeLaunch(agent: AgentName, cwd: string): { command: string; args: string[]; env: Record<string, string> } {
  const command = resolveExecutable(agent)
  const cli = bridgeCommand()
  const bridgeEnv = mcpEnvironment(agent, cwd)
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (!env.TERM || env.TERM.toLowerCase() === "dumb") env.TERM = "xterm-256color"

  if (agent === "claude") {
    const config = JSON.stringify({
      mcpServers: {
        allcode: {
          type: "stdio",
          command: process.execPath,
          args: [cli, "mcp"],
          env: bridgeEnv,
        },
      },
    })
    return { command, args: ["--mcp-config", config], env }
  }

  if (agent === "opencode") {
    const injected = {
      mcp: {
        allcode: {
          type: "local",
          command: [process.execPath, cli, "mcp"],
          enabled: true,
          environment: bridgeEnv,
        },
      },
    }
    const existing = process.env.OPENCODE_CONFIG_CONTENT
      ? JSON.parse(process.env.OPENCODE_CONFIG_CONTENT) as { mcp?: Record<string, unknown>; [key: string]: unknown }
      : {}
    env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
      ...existing,
      ...injected,
      mcp: { ...existing.mcp, ...injected.mcp },
    })
    return { command, args: [], env }
  }

  if (agent === "hermes") return { command, args: [], env }

  const args = [
    "-c", `mcp_servers.allcode.command=${JSON.stringify(process.execPath)}`,
    "-c", `mcp_servers.allcode.args=${JSON.stringify([cli, "mcp"])}`,
    "-c", `mcp_servers.allcode.env.ALL_CODE_HOST=${JSON.stringify(agent)}`,
    "-c", `mcp_servers.allcode.env.ALL_CODE_ALLOWED_ROOTS=${JSON.stringify(cwd)}`,
    "-c", `mcp_servers.allcode.env.ALL_CODE_DEPTH=${JSON.stringify(bridgeEnv.ALL_CODE_DEPTH)}`,
  ]
  return { command, args, env }
}

function clearNativeInput(child: pty.IPty): void {
  // Ctrl+U clears the line in Claude Code, OpenCode, Codex, and common readline shells.
  child.write("\x15")
}

export async function startNativeWorkspace(initialAgent: AgentName, cwdInput: string): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("The native workspace requires an interactive terminal (TTY).")
  }
  const cwd = resolve(cwdInput)
  let currentAgent = initialAgent
  let child: pty.IPty | undefined
  let picking = false
  let generation = 0
  let finished = false
  let resolveDone!: (exitCode: number) => void
  const done = new Promise<number>((resolveDonePromise) => { resolveDone = resolveDonePromise })
  const launched = new Set<AgentName>()
  const interceptor = new AgentCommandInterceptor()

  const launch = (agent: AgentName) => {
    currentAgent = agent
    picking = false
    interceptor.reset()
    const spec = nativeLaunch(agent, cwd)
    if (launched.has(agent)) {
      if (agent === "claude") spec.args.push("--continue")
      else if (agent === "opencode") spec.args.push("--continue")
      else if (agent === "hermes") spec.args.push("--resume", "latest", "--in", cwd)
      else spec.args.push("resume", "--last")
    }
    launched.add(agent)
    const childGeneration = ++generation
    process.stdout.write(`\x1b]0;AllCode — ${agent}\x07`)
    child = pty.spawn(spec.command, spec.args, {
      name: spec.env.TERM,
      cols: process.stdout.columns ?? 120,
      rows: process.stdout.rows ?? 36,
      cwd,
      env: spec.env,
      useConpty: process.platform === "win32",
    })
    child.onData((data) => process.stdout.write(data))
    child.onExit(({ exitCode }) => {
      if (childGeneration !== generation || finished) return
      finished = true
      resolveDone(exitCode)
    })
  }

  const switchAgent = (agent: AgentName, displayCommand?: string) => {
    if (agent === currentAgent) {
      process.stdout.write(`\r\nAlready using ${agent}.\r\n`)
      return
    }
    generation += 1
    child?.kill()
    const commandLine = displayCommand ? `${displayCommand}\r\n\r\n` : ""
    process.stdout.write(`\x1bc${commandLine}Switching main agent to ${agent}...\r\n`)
    setTimeout(() => launch(agent), 80)
  }

  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  const handleInput = (data: string) => {
    if (picking) {
      const key = decodedInputCharacters(data).find((character) => "1234\x03\x1b".includes(character))
      const selected = key === "1" ? "claude" : key === "2" ? "opencode" : key === "3" ? "codex" : key === "4" ? "hermes" : undefined
      if (selected) switchAgent(selected)
      else if (key === "\x03" || key === "\x1b") {
        picking = false
        launch(currentAgent)
      }
      return
    }

    const result = interceptor.feed(data)
    if (result.agent || result.showPicker) {
      const executeCommand = () => {
        if (child) clearNativeInput(child)
        if (result.agent) {
          switchAgent(result.agent, `/agent ${result.agent}`)
        } else {
          generation += 1
          child?.kill()
          picking = true
          process.stdout.write("\x1bc/agent\r\n\r\nSelect the main agent (appearance + engine):\r\n\r\n  1  Claude Code\r\n  2  OpenCode\r\n  3  Codex\r\n  4  Hermes\r\n\r\nPress 1, 2, 3, or 4. Esc cancels.\r\n")
        }
      }
      if (result.forward && child) {
        child.write(result.forward)
        setTimeout(executeCommand, 60)
      } else executeCommand()
      return
    }
    child?.write(result.forward)
  }
  const handleResize = () => child?.resize(process.stdout.columns ?? 120, process.stdout.rows ?? 36)
  const handleSignal = () => child?.kill()

  process.stdin.on("data", handleInput)
  process.stdout.on("resize", handleResize)
  process.on("SIGINT", handleSignal)
  process.on("SIGTERM", handleSignal)

  launch(initialAgent)
  const exitCode = await done

  process.stdin.off("data", handleInput)
  process.stdout.off("resize", handleResize)
  process.off("SIGINT", handleSignal)
  process.off("SIGTERM", handleSignal)
  process.stdin.setRawMode(false)
  process.stdin.pause()
  process.exitCode = exitCode
}

export function isAgentName(value: string | undefined): value is AgentName {
  return isKnownAgent(value)
}
