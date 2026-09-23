import { stdin as input, stdout as output } from "node:process"
import { emitKeypressEvents } from "node:readline"
import { discoverAllModels, discoverEfforts, discoverModels, type ModelEntry } from "./models.js"
import { runAgent } from "./runner.js"
import { SharedSession } from "./session.js"
import { pickItem, promptApproval, readCommandLine, type PickerItem } from "./terminal-ui.js"
import { agentNames, type AgentName } from "./types.js"
import { WorkspaceScreen } from "./workspace-screen.js"

const gray = "\x1b[90m"
const reset = "\x1b[0m"

const workingWords = [
  "Fucking", "Bombing", "Killing", "Destroying", "Crushing", "Smashing", "Blasting", "Slaying", "Wrecking", "Demolishing",
]

function agentLabel(agent: AgentName): string {
  return agent === "claude" ? "Claude Code" : agent === "opencode" ? "OpenCode" : "Codex"
}

function defaultPermissionMode(agent: AgentName): string {
  return agent === "claude" ? "acceptEdits" : agent === "opencode" ? "native" : "workspace-write"
}

function showHelp(screen: WorkspaceScreen): void {
  screen.append("Commands\n/agent [name]   Choose Claude Code, OpenCode, or Codex\n/model [id]     Select a model for the active agent\n/models         Select a model from any installed agent\n/effort         Set the active model's reasoning effort\n/mode           Set the active agent's permission mode\n/status         Show the active route and session\n/clear          Clear the workspace\n/exit           Exit All Code\n")
}

async function chooseAgent(current: AgentName, screen: WorkspaceScreen): Promise<AgentName> {
  const items: PickerItem<AgentName>[] = [
    { value: "claude", label: "Claude Code", description: "Anthropic CLI" },
    { value: "opencode", label: "OpenCode", description: "Open provider catalog" },
    { value: "codex", label: "Codex", description: "OpenAI CLI" },
  ]
  return await pickItem("Choose an agent", items, { current }, input, output, screen) ?? current
}

function modelChoice(model: ModelEntry): PickerItem<string> {
  const label = model.label === model.id ? (model.id.split("/").slice(1).join("/") || model.id) : model.label
  const flags = [model.isDefault ? "default" : "", model.isFree ? "free" : ""].filter(Boolean)
  return { value: model.id, label, description: [model.id, ...flags].join(" · ") }
}

async function chooseModel(agent: AgentName, current: string | undefined, screen: WorkspaceScreen): Promise<string | undefined> {
  screen.setWorking(`Discovering ${agentLabel(agent)} models…`)
  const catalog = await discoverModels(agent)
  screen.setWorking("")
  if (catalog.error) screen.append(`Catalog unavailable: ${catalog.error}`)
  const items = catalog.models.map(modelChoice)
  return await pickItem(`Choose ${agent === "opencode" ? "an" : "a"} ${agentLabel(agent)} model`, items, {
    current,
    allowCustom: true,
    limit: 12,
  }, input, output, screen) ?? current
}

function startWorkingAnimation(agent: AgentName, screen: WorkspaceScreen): { stop: () => number; pause: () => void; resume: () => void } {
  const started = Date.now()
  let tick = 0
  let paused = false
  const draw = (): void => {
    if (paused) return
    const word = workingWords[Math.floor(tick / 6) % workingWords.length] ?? "Fucking"
    screen.setWorking(`${word}… ${Math.round((Date.now() - started) / 1000)}s · ${agentLabel(agent)}`)
    tick += 1
  }
  draw()
  const timer = setInterval(draw, 450)
  return {
    pause: () => { paused = true; screen.setWorking("") },
    resume: () => { paused = false; draw() },
    stop: () => {
      clearInterval(timer)
      screen.setWorking("")
      return Date.now() - started
    },
  }
}

async function chooseEffort(agent: AgentName, model: string | undefined, current: string | undefined, screen: WorkspaceScreen): Promise<string | undefined> {
  screen.setWorking("Discovering effort levels…")
  let efforts: string[]
  try { efforts = await discoverEfforts(agent, model) }
  finally { screen.setWorking("") }
  if (efforts.length <= 1) {
    screen.append(`No configurable effort levels were advertised for ${model ?? "the default model"}.`)
    return current
  }
  const selected = await pickItem("Select reasoning effort", efforts.map((value) => ({
    value,
    label: value === "default" ? "Provider default" : value,
    description: value === "default" ? "Use the model's own setting" : undefined,
  })), { current: current ?? "default" }, input, output, screen)
  return selected === "default" ? undefined : selected ?? current
}

const claudeModes: PickerItem<string>[] = [
  { value: "manual", label: "Manual", description: "Show approve/deny when Claude asks (existing allow rules still apply)" },
  { value: "acceptEdits", label: "Accept edits", description: "Auto-allow edits; ask for other guarded actions" },
  { value: "auto", label: "Auto", description: "Use Claude Code's automatic permission review" },
  { value: "dontAsk", label: "Don't ask", description: "Deny actions that would require approval" },
  { value: "plan", label: "Plan", description: "Read-only planning" },
  { value: "bypassPermissions", label: "Bypass permissions", description: "DANGEROUS: skip Claude's permission checks" },
]

const opencodeModes: PickerItem<string>[] = [
  { value: "native", label: "Native rules", description: "Use your OpenCode permission configuration" },
  { value: "ask", label: "Ask", description: "Prompt in All Code for actions not explicitly allowed or denied" },
  { value: "auto", label: "Auto-approve", description: "DANGEROUS: approve ask actions; configured denials still apply" },
  { value: "deny", label: "Deny tools", description: "Block tool permissions" },
]

const codexModes: PickerItem<string>[] = [
  { value: "read-only", label: "Read-only", description: "Ask before writes or sandbox escalation" },
  { value: "workspace-write", label: "Workspace write", description: "Work inside this workspace; ask for escalation" },
  { value: "untrusted", label: "Untrusted commands", description: "Ask before untrusted commands" },
  { value: "never", label: "No prompts", description: "Stay sandboxed; deny approval requests" },
  { value: "bypass", label: "Full access", description: "DANGEROUS: no sandbox or approvals" },
]

async function chooseMode(agent: AgentName, current: string | undefined, screen: WorkspaceScreen): Promise<string | undefined> {
  const choices = agent === "claude" ? claudeModes : agent === "opencode" ? opencodeModes : codexModes
  const defaultMode = agent === "claude" ? "acceptEdits" : agent === "opencode" ? "native" : "workspace-write"
  const selected = await pickItem(`${agentLabel(agent)} permission mode`, choices, { current: current ?? defaultMode }, input, output, screen)
  if (selected === "bypassPermissions" || selected === "bypass" || selected === "auto") {
    const confirm = await pickItem("This mode reduces approval checks. Continue?", [
      { value: "no", label: "No — keep current mode" },
      { value: "yes", label: "Yes — use selected mode" },
    ], { current: "no" }, input, output, screen)
    return confirm === "yes" ? selected : current
  }
  return selected ?? current
}

async function askApproval(toolName: string, toolInput: Record<string, unknown>, screen: WorkspaceScreen): Promise<boolean> {
  const approved = await promptApproval(`Permission request · ${toolName}`, JSON.stringify(toolInput, null, 2), screen, input)
  screen.append(`Permission ${approved ? "approved once" : "denied"} · ${toolName}`)
  return approved
}

async function chooseAnyModel(
  screen: WorkspaceScreen,
  currentAgent: AgentName,
  currentModel: string | undefined,
): Promise<{ agent: AgentName; model: string } | undefined> {
  screen.setWorking("Discovering models…")
  const catalogs = await discoverAllModels()
  screen.setWorking("")
  for (const catalog of catalogs) if (catalog.error) screen.append(`${agentLabel(catalog.agent)}: ${catalog.error}`)
  const items: PickerItem<string>[] = catalogs.flatMap((catalog) => catalog.models.map((entry) => {
    const choice = modelChoice(entry)
    return {
      value: `${entry.agent}\0${entry.id}`,
      label: `${agentLabel(entry.agent)} · ${choice.label}`,
      description: choice.description,
    }
  }))
  if (items.length === 0) { screen.append("No models available."); return undefined }
  const selected = await pickItem("Select a model", items, {
    current: `${currentAgent}\0${currentModel ?? "default"}`,
    limit: 12,
  }, input, output, screen)
  if (!selected) return undefined
  const separator = selected.indexOf("\0")
  return { agent: selected.slice(0, separator) as AgentName, model: selected.slice(separator + 1) }
}

export async function startAllCode(cwd: string, initialAgent: AgentName = "opencode", forceInitialAgent = false): Promise<void> {
  if (!input.isTTY || !output.isTTY) throw new Error("All Code requires an interactive terminal.")
  const shared = new SharedSession(cwd, initialAgent)
  if (forceInitialAgent) shared.activeAgent = initialAgent
  let agent = shared.activeAgent
  let model = shared.model(agent)
  let effort = shared.effort(agent)
  let permissionMode = shared.permissionMode(agent) ?? defaultPermissionMode(agent)
  const history: string[] = []
  const screen = new WorkspaceScreen(output, cwd, agentLabel(agent), model ?? "default model")
  const inputWasRaw = Boolean(input.isRaw)
  const inputWasFlowing = input.readableFlowing === true
  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()

  try {
    screen.start()
    screen.setExecutionSettings(effort, permissionMode)
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
        screen.append(`Agent: ${agentLabel(agent)}  Model: ${model ?? "default"}  Effort: ${effort ?? "provider default"}  Permissions: ${permissionMode ?? "native default"}\nNative session: ${state.sessions[agent] ?? "new"}\nShared context: ${state.messages} messages · ${state.path}`)
        continue
      }
      if (command === "/effort") {
        try {
          effort = await chooseEffort(agent, model, effort, screen)
          shared.setEffort(agent, effort)
          screen.setExecutionSettings(effort, permissionMode)
          screen.append(`Reasoning effort: ${effort ?? "provider default"}`)
        } catch (error) { screen.append(`Effort discovery failed: ${error instanceof Error ? error.message : String(error)}`) }
        continue
      }
      if (command === "/mode" || command === "/permissions") {
        permissionMode = await chooseMode(agent, permissionMode, screen) ?? permissionMode
        shared.setPermissionMode(agent, permissionMode)
        screen.setExecutionSettings(effort, permissionMode)
        screen.append(`Permission mode: ${permissionMode ?? "native default"}`)
        continue
      }
      if (command === "/models") {
        const selected = await chooseAnyModel(screen, agent, model)
        if (selected) {
          agent = selected.agent
          if (shared.model(agent) !== selected.model) shared.setEffort(agent, undefined)
          model = selected.model
          shared.activeAgent = agent
          shared.setModel(agent, model)
          effort = shared.effort(agent)
          permissionMode = shared.permissionMode(agent) ?? defaultPermissionMode(agent)
          screen.setExecutionSettings(effort, permissionMode)
          screen.setRoute(agentLabel(agent), model)
          screen.append(`Active model: ${agentLabel(agent)} · ${model}`)
        }
        continue
      }
      if (command === "/agent" || command === "/provider") {
        const requested = parts[0]?.toLowerCase()
        agent = requested && agentNames.includes(requested as AgentName)
          ? requested as AgentName
          : await chooseAgent(agent, screen)
        shared.activeAgent = agent
        model = shared.model(agent)
        effort = shared.effort(agent)
        permissionMode = shared.permissionMode(agent) ?? defaultPermissionMode(agent)
        screen.setExecutionSettings(effort, permissionMode)
        screen.setRoute(agentLabel(agent), model ?? "default model")
        screen.append(`Active agent: ${agentLabel(agent)}`)
        continue
      }
      if (command === "/model") {
        const selected = parts.length > 0 ? parts.join(" ") : await chooseModel(agent, model, screen)
        if (selected !== model) { effort = undefined; shared.setEffort(agent, undefined) }
        model = selected
        shared.setModel(agent, model)
        screen.setRoute(agentLabel(agent), model ?? "default model")
        screen.setExecutionSettings(effort, permissionMode)
        screen.append(`Active model: ${model ?? "default"}`)
        continue
      }
      const animation = startWorkingAnimation(agent, screen)
      let approvalQueue: Promise<void> = Promise.resolve()
      try {
        const result = await runAgent({
          agent,
          cwd,
          model: model === "default" ? undefined : model,
          effort,
          permissionMode,
          sessionId: shared.nativeSession(agent),
          prompt: shared.promptFor(agent, line),
        }, undefined, ({ toolName, input: toolInput }) => {
          const decision = approvalQueue.then(async () => {
            animation.pause()
            try { return await askApproval(toolName, toolInput, screen) }
            finally { animation.resume() }
          })
          approvalQueue = decision.then(() => {}, () => {})
          return decision
        })
        if (result.sessionId) shared.setNativeSession(agent, result.sessionId)
        shared.recordTurn(agent, line, result.finalText.trim())
        const elapsed = animation.stop()
        screen.append(`${agentLabel(agent)} replied · ${(elapsed / 1000).toFixed(1)}s\n${result.finalText.trim()}\n`)
      } catch (error) {
        animation.stop()
        const message = error instanceof Error ? error.message : String(error)
        shared.recordFailure(agent, line, message)
        screen.append(`Error: ${message}\n`)
      }
    }
  } finally {
    screen.stop()
    input.setRawMode(inputWasRaw)
    if (!inputWasFlowing) input.pause()
    output.write(`${gray}All Code closed.${reset}\n`)
  }
}
