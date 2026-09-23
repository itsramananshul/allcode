import { stdin as input, stdout as output } from "node:process"
import { discoverAllModels, discoverModels, type ModelEntry } from "./models.js"
import { runAgent } from "./runner.js"
import { SharedSession } from "./session.js"
import { pickItem, readCommandLine, type PickerItem } from "./terminal-ui.js"
import { agentNames, type AgentName } from "./types.js"
import { WorkspaceScreen } from "./workspace-screen.js"

const gray = "\x1b[90m"
const reset = "\x1b[0m"

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

function showHelp(screen: WorkspaceScreen): void {
  screen.append("Commands\n/agent [name]   Choose Claude Code, OpenCode, or Codex\n/model [id]     Browse or select a model for the active agent\n/models         Show models discovered from every agent\n/status         Show the active route and session\n/clear          Clear the workspace\n/exit           Exit All Code\n")
}

async function chooseAgent(current: AgentName, screen: WorkspaceScreen): Promise<AgentName> {
  const items: PickerItem<AgentName>[] = [
    { value: "claude", label: "Claude Code", description: "Anthropic CLI" },
    { value: "opencode", label: "OpenCode", description: "Open provider catalog" },
    { value: "codex", label: "Codex", description: "OpenAI CLI" },
  ]
  return await pickItem("Choose an agent", items, { current }, input, output, screen) ?? current
}

function printModels(models: ModelEntry[], screen: WorkspaceScreen, limit = 40): void {
  models.slice(0, limit).forEach((model, index) => {
    const flags = [model.isDefault ? "default" : "", model.isFree ? "free" : ""].filter(Boolean).join(", ")
    screen.append(`  ${String(index + 1).padStart(2)}  ${model.id}${flags ? ` · ${flags}` : ""}`)
  })
  if (models.length > limit) screen.append(`  … ${models.length - limit} more; enter an exact model ID to select it.`)
}

async function chooseModel(agent: AgentName, current: string | undefined, screen: WorkspaceScreen): Promise<string | undefined> {
  screen.setWorking(`Discovering ${agentLabel(agent)} models…`)
  const catalog = await discoverModels(agent)
  screen.setWorking("")
  if (catalog.error) screen.append(`Catalog unavailable: ${catalog.error}`)
  const items: PickerItem<string>[] = catalog.models.map((entry) => {
    const flags = [entry.isDefault ? "default" : "", entry.isFree ? "free" : ""].filter(Boolean)
    const details = [entry.label !== entry.id ? entry.label : "", ...flags].filter(Boolean).join(" · ")
    return { value: entry.id, label: entry.id, description: details }
  })
  return await pickItem(`Choose a ${agentLabel(agent)} model`, items, {
    current,
    allowCustom: true,
    limit: 12,
  }, input, output, screen) ?? current
}

function startWorkingAnimation(agent: AgentName, screen: WorkspaceScreen): { stop: () => number } {
  const started = Date.now()
  let tick = 0
  const draw = (): void => {
    const face = faceFrames[Math.floor(tick / 2) % faceFrames.length]!
    const word = workingWords[Math.floor(tick / 6) % workingWords.length] ?? "Fucking"
    screen.setWorking(`${face[1]}  ${word}… ${Math.round((Date.now() - started) / 1000)}s · ${agentLabel(agent)}`)
    tick += 1
  }
  draw()
  const timer = setInterval(draw, 450)
  return {
    stop: () => {
      clearInterval(timer)
      screen.setWorking("")
      return Date.now() - started
    },
  }
}

async function printAllModels(screen: WorkspaceScreen): Promise<void> {
  screen.setWorking("Discovering models…")
  const catalogs = await discoverAllModels()
  screen.setWorking("")
  for (const catalog of catalogs) {
    screen.append(`\n${agentLabel(catalog.agent)}`)
    if (catalog.error) screen.append(catalog.error)
    else printModels(catalog.models, screen, 25)
  }
}

export async function startAllCode(cwd: string, initialAgent: AgentName = "opencode", forceInitialAgent = false): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error("All Code requires an interactive terminal.")
  const shared = new SharedSession(cwd, initialAgent)
  if (forceInitialAgent) shared.activeAgent = initialAgent
  let agent = shared.activeAgent
  let model = shared.model(agent)
  const history: string[] = []
  const screen = new WorkspaceScreen(output, cwd, agentLabel(agent), model ?? "default model")
  screen.start()

  try {
    while (true) {
      const line = (await readCommandLine(history, input, output, screen)).trim()
      if (!line) continue
      history.push(line)
      const [command, ...parts] = line.split(/\s+/)

      if (command === "/exit" || command === "/quit") break
      if (command === "/help") { showHelp(screen); continue }
      if (command === "/clear") { screen.clear(); continue }
      if (command === "/status") {
        const state = shared.summary()
        screen.append(`Agent: ${agentLabel(agent)}  Model: ${model ?? "default"}  Native session: ${state.sessions[agent] ?? "new"}\nShared context: ${state.messages} messages · ${state.path}`)
        continue
      }
      if (command === "/models") { await printAllModels(screen); continue }
      if (command === "/agent" || command === "/provider") {
        const requested = parts[0]?.toLowerCase()
        agent = requested && agentNames.includes(requested as AgentName)
          ? requested as AgentName
          : await chooseAgent(agent, screen)
        shared.activeAgent = agent
        model = shared.model(agent)
        screen.setRoute(agentLabel(agent), model ?? "default model")
        screen.append(`Active agent: ${agentLabel(agent)}`)
        continue
      }
      if (command === "/model") {
        model = parts.length > 0 ? parts.join(" ") : await chooseModel(agent, model, screen)
        shared.setModel(agent, model)
        screen.setRoute(agentLabel(agent), model ?? "default model")
        screen.append(`Active model: ${model ?? "default"}`)
        continue
      }
      const animation = startWorkingAnimation(agent, screen)
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
        screen.append(`${agentLabel(agent)} · ${(elapsed / 1000).toFixed(1)}s\n${result.finalText.trim()}\n`)
      } catch (error) {
        animation.stop()
        const message = error instanceof Error ? error.message : String(error)
        shared.recordFailure(agent, line, message)
        screen.append(`Error: ${message}\n`)
      }
    }
  } finally {
    screen.stop()
    output.write(`${gray}All Code closed.${reset}\n`)
  }
}
