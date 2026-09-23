import { stdin as input, stdout as output } from "node:process"
import { discoverAllModels, discoverModels, type ModelEntry } from "./models.js"
import { runAgent } from "./runner.js"
import { SharedSession } from "./session.js"
import { pickItem, readCommandLine, type PickerItem } from "./terminal-ui.js"
import { agentNames, type AgentName } from "./types.js"

const white = "\x1b[97m"
const gray = "\x1b[90m"
const bold = "\x1b[1m"
const reset = "\x1b[0m"

const mascot = [
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢠⣤",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⠋",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⣤⣿⣿⣦⣤⣀",
  "⠀⠀⠀⠀⠀⠀⠀⠀⢠⣾⣿⠿⠿⠿⠿⠿⠿⢿⣿⣦",
  "⠀⠀⠀⠀⠀⠀⣀⣦⣿⠁⠀⣠⡀⠀⠀⠀⣤⡀⠀⢻⣶⣄",
  "⠀⠀⠀⠀⠀⠀⣿⣿⣿⠐⢿⣏⠀⣿⣿⠀⣨⣿⠆⢸⣏⣿⠆",
  "⠀⠀⢀⣤⣄⡀⠈⠛⢿⣄⡀⠙⠁⠀⠀⠀⠙⠁⣀⣾⠛⠋⠀⣀⣤⡄",
  "⠀⠀⠈⠻⣿⣿⣆⡀⠀⠙⡛⢛⣛⠻⠟⣛⣛⠛⠋⠁⠀⣀⣾⣿⡿⠁",
  "⠀⠀⠀⠀⠈⠛⢿⣿⣿⢸⣯⣿⡿⠿⠿⠿⣿⣾⢿⣻⣿⡿⠟⠋",
  "⠀⠀⠀⠀⢀⣠⣤⣤⣾⣿⢿⣿⣯⣭⣭⣵⣿⣿⢾⡿⣢⣤⣤⣀",
  "⠀⠀⠀⠀⠙⠻⠿⠿⠋⠁⠀⢻⣿⣿⣿⣿⣿⠁⠀⠉⠻⠿⠿⠛",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢿⣿⣿⣿⠃",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣴⣬⣯⣶",
  "⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⢹⡿⠉",
]

const workingWords = [
  "Fucking", "Bombing", "Killing", "Destroying", "Crushing", "Smashing", "Blasting", "Slaying", "Wrecking", "Demolishing",
]

const faceFrames = [
  ["╭───────╮", "│ < ■ > │", "╰───────╯"],
  ["╭───────╮", "│ ─ ■ ─ │", "╰───────╯"],
]

function agentLabel(agent: AgentName): string {
  return agent === "claude" ? "Claude Code" : agent === "opencode" ? "OpenCode" : "Codex"
}

function header(agent: AgentName, model: string | undefined, cwd: string): void {
  output.write("\x1bc")
  for (const line of mascot) output.write(`${gray}${line}${reset}\n`)
  output.write(`\n${bold}${white}All Code${reset} ${gray}v0.1.0${reset}\n`)
  output.write(`${white}${agentLabel(agent)}${reset}${gray} · ${model ?? "default model"} · ${cwd}${reset}\n\n`)
  output.write(`${gray}One workspace. Every coding agent. Type /help for commands.${reset}\n\n`)
}

function showHelp(): void {
  output.write(`\n${bold}${white}Commands${reset}\n`)
  output.write(`${gray}/agent [name]${reset}   Choose Claude Code, OpenCode, or Codex\n`)
  output.write(`${gray}/model [id]${reset}     Browse or select a model for the active agent\n`)
  output.write(`${gray}/models${reset}         Show models discovered from every agent\n`)
  output.write(`${gray}/status${reset}         Show the active route and session\n`)
  output.write(`${gray}/clear${reset}          Redraw the All Code workspace\n`)
  output.write(`${gray}/exit${reset}           Exit All Code\n\n`)
}

async function chooseAgent(current: AgentName): Promise<AgentName> {
  const items: PickerItem<AgentName>[] = [
    { value: "claude", label: "Claude Code", description: "Anthropic CLI" },
    { value: "opencode", label: "OpenCode", description: "Open provider catalog" },
    { value: "codex", label: "Codex", description: "OpenAI CLI" },
  ]
  return await pickItem("Choose an agent", items, { current }) ?? current
}

function printModels(models: ModelEntry[], limit = 40): void {
  models.slice(0, limit).forEach((model, index) => {
    const flags = [model.isDefault ? "default" : "", model.isFree ? "free" : ""].filter(Boolean).join(", ")
    output.write(`  ${String(index + 1).padStart(2)}  ${white}${model.id}${reset}${flags ? `${gray} · ${flags}${reset}` : ""}\n`)
  })
  if (models.length > limit) output.write(`${gray}  … ${models.length - limit} more; enter an exact model ID to select it.${reset}\n`)
}

async function chooseModel(agent: AgentName, current: string | undefined): Promise<string | undefined> {
  output.write(`\n${gray}Discovering ${agentLabel(agent)} models…${reset}\n`)
  const catalog = await discoverModels(agent)
  if (catalog.error) output.write(`${gray}Catalog unavailable: ${catalog.error}${reset}\n`)
  const items: PickerItem<string>[] = catalog.models.map((entry) => {
    const flags = [entry.isDefault ? "default" : "", entry.isFree ? "free" : ""].filter(Boolean)
    const details = [entry.label !== entry.id ? entry.label : "", ...flags].filter(Boolean).join(" · ")
    return { value: entry.id, label: entry.id, description: details }
  })
  return await pickItem(`Choose a ${agentLabel(agent)} model`, items, {
    current,
    allowCustom: true,
    limit: 12,
  }) ?? current
}

function startWorkingAnimation(agent: AgentName): { stop: () => number } {
  const started = Date.now()
  let tick = 0
  const draw = (): void => {
    if (tick > 0) output.write("\x1b[2A\r\x1b[0J")
    const face = faceFrames[Math.floor(tick / 2) % faceFrames.length]!
    const word = workingWords[Math.floor(tick / 6) % workingWords.length] ?? "Fucking"
    output.write(`${gray}${face[0]}${reset}\n${gray}${face[1]}${reset}  ${white}${word}…${reset} ${gray}${Math.round((Date.now() - started) / 1000)}s · ${agentLabel(agent)}${reset}\n${gray}${face[2]}${reset}`)
    tick += 1
  }
  draw()
  const timer = setInterval(draw, 450)
  return {
    stop: () => {
      clearInterval(timer)
      output.write("\x1b[2A\r\x1b[0J")
      return Date.now() - started
    },
  }
}

async function printAllModels(): Promise<void> {
  const catalogs = await discoverAllModels()
  for (const catalog of catalogs) {
    output.write(`\n${bold}${white}${agentLabel(catalog.agent)}${reset}\n`)
    if (catalog.error) output.write(`${gray}${catalog.error}${reset}\n`)
    else printModels(catalog.models, 25)
  }
  output.write("\n")
}

export async function startAllCode(cwd: string, initialAgent: AgentName = "opencode", forceInitialAgent = false): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error("All Code requires an interactive terminal.")
  const shared = new SharedSession(cwd, initialAgent)
  if (forceInitialAgent) shared.activeAgent = initialAgent
  let agent = shared.activeAgent
  let model = shared.model(agent)
  const history: string[] = []
  header(agent, model, cwd)

  try {
    while (true) {
      const line = (await readCommandLine(history)).trim()
      if (!line) continue
      history.push(line)
      const [command, ...parts] = line.split(/\s+/)

      if (command === "/exit" || command === "/quit") break
      if (command === "/help") { showHelp(); continue }
      if (command === "/clear") { header(agent, model, cwd); continue }
      if (command === "/status") {
        const state = shared.summary()
        output.write(`${gray}Agent:${reset} ${agentLabel(agent)}  ${gray}Model:${reset} ${model ?? "default"}  ${gray}Native session:${reset} ${state.sessions[agent] ?? "new"}\n`)
        output.write(`${gray}Shared context:${reset} ${state.messages} messages · ${state.path}\n`)
        continue
      }
      if (command === "/models") { await printAllModels(); continue }
      if (command === "/agent" || command === "/provider") {
        const requested = parts[0]?.toLowerCase()
        agent = requested && agentNames.includes(requested as AgentName)
          ? requested as AgentName
          : await chooseAgent(agent)
        shared.activeAgent = agent
        model = shared.model(agent)
        output.write(`${gray}Active agent:${reset} ${white}${agentLabel(agent)}${reset}\n`)
        continue
      }
      if (command === "/model") {
        model = parts.length > 0 ? parts.join(" ") : await chooseModel(agent, model)
        shared.setModel(agent, model)
        output.write(`${gray}Active model:${reset} ${white}${model ?? "default"}${reset}\n`)
        continue
      }
      const animation = startWorkingAnimation(agent)
      try {
        const result = await runAgent({
          agent,
          cwd,
          model: model === "default" ? undefined : model,
          sessionId: shared.nativeSession(agent),
          prompt: shared.promptFor(agent, line),
        })
        if (result.sessionId) shared.setNativeSession(agent, result.sessionId)
        shared.recordTurn(agent, line, result.finalText.trim())
        const elapsed = animation.stop()
        output.write(`${gray}${agentLabel(agent)} · ${(elapsed / 1000).toFixed(1)}s${reset}\n\n`)
        output.write(`${result.finalText.trim()}\n\n`)
      } catch (error) {
        animation.stop()
        const message = error instanceof Error ? error.message : String(error)
        shared.recordFailure(agent, line, message)
        output.write(`${white}Error:${reset} ${message}\n\n`)
      }
    }
  } finally {
    output.write(`${gray}All Code closed.${reset}\n`)
  }
}
