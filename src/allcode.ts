import { createInterface, type Interface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { discoverAllModels, discoverModels, type ModelEntry } from "./models.js"
import { runAgent } from "./runner.js"
import { SharedSession } from "./session.js"
import { agentNames, type AgentName } from "./types.js"

const white = "\x1b[97m"
const gray = "\x1b[90m"
const bold = "\x1b[1m"
const reset = "\x1b[0m"

const mascot = [
  "        ╭───────╮",
  "    ╭───┤ < ■ > ├───╮",
  "    ╰─○─┴───┬───┴─○─╯",
  "        ╭───┴───╮",
  "        ╰──┬─┬──╯",
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

async function chooseAgent(rl: Interface, current: AgentName): Promise<AgentName> {
  output.write(`\n${bold}${white}Choose an agent${reset}\n  1  Claude Code\n  2  OpenCode\n  3  Codex\n`)
  const answer = (await rl.question(`${gray}Agent [${current}]: ${reset}`)).trim().toLowerCase()
  if (answer === "1" || answer === "claude") return "claude"
  if (answer === "2" || answer === "opencode") return "opencode"
  if (answer === "3" || answer === "codex") return "codex"
  output.write(`${gray}Kept ${current}.${reset}\n`)
  return current
}

function printModels(models: ModelEntry[], limit = 40): void {
  models.slice(0, limit).forEach((model, index) => {
    const flags = [model.isDefault ? "default" : "", model.isFree ? "free" : ""].filter(Boolean).join(", ")
    output.write(`  ${String(index + 1).padStart(2)}  ${white}${model.id}${reset}${flags ? `${gray} · ${flags}${reset}` : ""}\n`)
  })
  if (models.length > limit) output.write(`${gray}  … ${models.length - limit} more; enter an exact model ID to select it.${reset}\n`)
}

async function chooseModel(rl: Interface, agent: AgentName, current: string | undefined): Promise<string | undefined> {
  output.write(`\n${gray}Discovering ${agentLabel(agent)} models…${reset}\n`)
  const catalog = await discoverModels(agent)
  if (catalog.error) output.write(`${gray}Catalog unavailable: ${catalog.error}${reset}\n`)
  if (catalog.models.length > 0) printModels(catalog.models)
  const answer = (await rl.question(`${gray}Model number or exact ID (blank keeps current): ${reset}`)).trim()
  if (!answer) return current
  if (/^\d+$/.test(answer)) {
    const selected = catalog.models[Number(answer) - 1]
    if (selected) return selected.id
    output.write(`${gray}No model exists at position ${answer}; kept ${current ?? "default"}.${reset}\n`)
    return current
  }
  return answer
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
  const rl = createInterface({ input, output, terminal: true })
  header(agent, model, cwd)

  try {
    while (true) {
      const line = (await rl.question(`${white}› ${reset}`)).trim()
      if (!line) continue
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
          : await chooseAgent(rl, agent)
        shared.activeAgent = agent
        model = shared.model(agent)
        output.write(`${gray}Active agent:${reset} ${white}${agentLabel(agent)}${reset}\n`)
        continue
      }
      if (command === "/model") {
        model = parts.length > 0 ? parts.join(" ") : await chooseModel(rl, agent, model)
        shared.setModel(agent, model)
        output.write(`${gray}Active model:${reset} ${white}${model ?? "default"}${reset}\n`)
        continue
      }
      const started = Date.now()
      const frames = ["·", "··", "···"]
      let frame = 0
      output.write(`${gray}${agentLabel(agent)} is working${frames[0]}${reset}`)
      const timer = setInterval(() => {
        output.write(`\r\x1b[2K${gray}${agentLabel(agent)} is working${frames[frame++ % frames.length]} ${Math.round((Date.now() - started) / 1000)}s${reset}`)
      }, 500)
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
        output.write(`\r\x1b[2K${gray}${agentLabel(agent)} · ${((Date.now() - started) / 1000).toFixed(1)}s${reset}\n\n`)
        output.write(`${result.finalText.trim()}\n\n`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        shared.recordFailure(agent, line, message)
        output.write(`\r\x1b[2K${white}Error:${reset} ${message}\n\n`)
      } finally {
        clearInterval(timer)
      }
    }
  } finally {
    rl.close()
    output.write(`${gray}All Code closed.${reset}\n`)
  }
}
