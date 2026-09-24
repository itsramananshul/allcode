import { stdin as input, stdout as output } from "node:process"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { emitKeypressEvents } from "node:readline"
import { discoverAllModels, discoverEfforts, discoverModels, type ModelEntry } from "./models.js"
import { runAgent } from "./runner.js"
import { ClaudeStreamRunner } from "./claude-stream-runner.js"
import { HermesAcpRunner } from "./hermes-acp-runner.js"
import { SharedSession } from "./session.js"
import { pickItem, promptApproval, readCommandLine, type PickerItem } from "./terminal-ui.js"
import type { AgentName } from "./types.js"
import { WorkspaceScreen } from "./workspace-screen.js"
import { findRegisteredAgent, isKnownAgent, registerAgent, registeredAgents } from "./agent-registry.js"
import { resolveExecutable } from "./executable.js"
import { installPreparedSkill, prepareSkill } from "./skill-installer.js"
import { pluginModes } from "./plugin-agent.js"
import { inspectPluginDraft, installPluginDraft } from "./plugin-installer.js"
import { discoverCommandByName, discoverInstalledAgents, type InstalledAgentCandidate } from "./agent-discovery.js"

const gray = "\x1b[90m"
const reset = "\x1b[0m"

const workingWords = [
  "Fucking", "Bombing", "Killing", "Destroying", "Crushing", "Smashing", "Blasting", "Slaying", "Wrecking", "Demolishing",
]

function agentLabel(agent: AgentName): string {
  return agent === "claude" ? "Claude Code" : agent === "opencode" ? "OpenCode" : agent === "codex" ? "Codex" : agent === "hermes" ? "Hermes" : findRegisteredAgent(agent)?.label ?? agent
}

function defaultPermissionMode(agent: AgentName): string {
  return agent === "claude" ? "acceptEdits" : agent === "opencode" ? "native" : agent === "codex" ? "workspace-write" : agent === "hermes" || ["acp", "plugin"].includes(findRegisteredAgent(agent)?.protocol ?? "") ? "default" : "native"
}

function showHelp(screen: WorkspaceScreen): void {
  screen.append("Commands\n/agent [name]   Choose a coding agent\n/add            Register an agent or install a skill\n/model [id]     Select a model for the active agent\n/models         Select a model from any installed agent\n/effort         Set the active model's reasoning effort\n/mode           Set the active agent's permission mode\n/status         Show the active route and session\n/clear          Clear the workspace\n/exit           Exit All Code\n")
}

async function chooseAgent(current: AgentName, screen: WorkspaceScreen): Promise<AgentName> {
  const items: PickerItem<AgentName>[] = [
    { value: "claude", label: "Claude Code", description: "Anthropic CLI" },
    { value: "opencode", label: "OpenCode", description: "Open provider catalog" },
    { value: "codex", label: "Codex", description: "OpenAI CLI" },
    { value: "hermes", label: "Hermes", description: "Hermes Agent via ACP" },
    ...registeredAgents().map((agent) => ({ value: agent.name, label: agent.label, description: agent.protocol === "acp" ? "ACP agent" : agent.protocol === "plugin" ? `Custom adapter${agent.limitations?.length ? " · limited" : ""}` : "One-shot CLI · no native sessions or All Code approvals" })),
  ]
  return await pickItem("Choose an agent", items, { current }, input, output, screen) ?? current
}

function modelChoice(model: ModelEntry): PickerItem<string> {
  const label = model.label === model.id ? (model.id.split("/").slice(1).join("/") || model.id) : model.label
  const flags = [model.isDefault ? "default" : "", model.isFree ? "free" : ""].filter(Boolean)
  return { value: model.id, label, description: [model.id, ...flags].join(" · ") }
}

async function chooseModel(agent: AgentName, current: string | undefined, screen: WorkspaceScreen, hermes?: HermesAcpRunner, cwd?: string, sessionId?: string): Promise<string | undefined> {
  screen.setWorking(`Discovering ${agentLabel(agent)} models…`)
  const catalog = agent === "hermes" && hermes && cwd
    ? await hermes.listModels({ agent, cwd, prompt: "", sessionId }).then((state) => ({
      agent,
      models: [
        { agent, id: "default", label: "Hermes configured default", isDefault: true },
        ...state.availableModels.flatMap((entry) => typeof entry.modelId === "string" ? [{
          agent, id: entry.modelId, label: typeof entry.name === "string" ? entry.name : entry.modelId,
        }] : []),
      ],
    } as Awaited<ReturnType<typeof discoverModels>>))
    : await discoverModels(agent)
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

const hermesModes: PickerItem<string>[] = [
  { value: "default", label: "Ask before edits", description: "Hermes ACP default; show approve/deny requests" },
  { value: "accept_edits", label: "Accept workspace edits", description: "Auto-allow workspace edits; ask for sensitive paths" },
  { value: "dont_ask", label: "Don't ask for edits", description: "Auto-allow edits except sensitive paths" },
]

async function chooseMode(agent: AgentName, current: string | undefined, screen: WorkspaceScreen, cwd: string): Promise<string | undefined> {
  const registered = findRegisteredAgent(agent)
  const choices = agent === "claude" ? claudeModes : agent === "opencode" ? opencodeModes : agent === "codex" ? codexModes
    : agent === "hermes" ? hermesModes : registered?.protocol === "plugin"
      ? (await pluginModes(agent, cwd)).map((mode) => ({ value: mode.id, label: mode.label, description: mode.description }))
      : registered?.protocol === "acp"
      ? [{ value: "default", label: "Agent default", description: "ACP requests appear in All Code when the agent sends them" }]
      : [{ value: "native", label: "CLI default", description: "One-shot CLIs handle permissions outside All Code" }]
  const defaultMode = defaultPermissionMode(agent)
  const selected = await pickItem(`${agentLabel(agent)} permission mode`, choices, { current: current ?? defaultMode }, input, output, screen)
  if (["bypassPermissions", "bypass", "auto", "accept_edits", "dont_ask"].includes(selected ?? "")) {
    const confirm = await pickItem("This mode reduces approval checks. Continue?", [
      { value: "no", label: "No — keep current mode" },
      { value: "yes", label: "Yes — use selected mode" },
    ], { current: "no" }, input, output, screen)
    return confirm === "yes" ? selected : current
  }
  return selected ?? current
}

async function askField(label: string, screen: WorkspaceScreen): Promise<string> {
  screen.append(label)
  return (await readCommandLine([], input, output, screen)).trim()
}

async function addInteractively(kind: string | undefined, screen: WorkspaceScreen, currentAgent: AgentName, cwd: string,
  model: string | undefined, effort: string | undefined, permissionMode: string | undefined): Promise<void> {
  const selected = kind === "agent" || kind === "skill" ? kind : await pickItem("Add to All Code", [
    { value: "agent", label: "Agent", description: "Build an adapter or register an installed CLI" },
    { value: "skill", label: "Skill", description: "Install a SKILL.md folder for supported agents" },
  ], {}, input, output, screen)
  if (!selected) return
  if (selected === "agent") {
    screen.setWorking("Looking for installed agent commands…")
    let candidates: InstalledAgentCandidate[]
    try { candidates = await discoverInstalledAgents() }
    finally { screen.setWorking("") }
    const choice = await pickItem("Add an installed agent", [
      ...candidates.map((candidate) => ({ value: candidate.name, label: candidate.label,
        description: isKnownAgent(candidate.name) ? "Already available in All Code" : "Detected on PATH · adapter needed" })),
      { value: "search", label: "Find by command name", description: "Type the command you use to launch another agent" },
      { value: "manual", label: "Advanced manual setup", description: "Enter ACP or one-shot details yourself" },
    ], { limit: 12 }, input, output, screen)
    if (!choice) return
    let detected = candidates.find((candidate) => candidate.name === choice)
    if (choice === "search") {
      const commandName = await askField("Agent command name (for example gemini):", screen)
      screen.setWorking("Looking for that command…")
      try { detected = await discoverCommandByName(commandName) }
      finally { screen.setWorking("") }
      if (!detected) { screen.append(`Couldn't find ${commandName} on PATH. Check that its CLI is installed and available in this terminal.`); return }
    }
    if (detected && isKnownAgent(detected.name)) {
      screen.append(`${agentLabel(detected.name)} is already available. Use /agent to select it.`)
      return
    }
    const protocol = detected ? "plugin" : await pickItem("Agent interface", [
      { value: "plugin", label: "Build adapter with current agent", description: "Inspect an installed CLI and write an update-safe plugin" },
      { value: "acp", label: "ACP", description: "Models, sessions, and approval requests" },
      { value: "oneshot", label: "One-shot CLI", description: "Basic prompts only; unavailable features are not shown as supported" },
    ], {}, input, output, screen)
    if (!protocol) return
    const name = detected?.name ?? (await askField("Agent ID (lowercase slug):", screen)).toLowerCase()
    const label = detected?.label ?? await askField("Display name:", screen)
    const command = detected?.command ?? await askField("Installed executable path or command:", screen)
    if (protocol === "plugin") {
      const executable = resolveExecutable(command)
      if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error("Agent ID must be a lowercase slug")
      const draft = resolve(cwd, ".allcode", "adapter-drafts", name)
      if (existsSync(draft)) throw new Error(`Draft already exists; review or move it first: ${draft}`)
      mkdirSync(draft, { recursive: true })
      const skillFile = fileURLToPath(new URL("../skills/allcode-agent-adapter/SKILL.md", import.meta.url))
      const instructions = readFileSync(skillFile, "utf8")
      screen.append(`Asking ${agentLabel(currentAgent)} to build an adapter at ${draft}. This may take a while.`)
      const animation = startWorkingAnimation(currentAgent, screen)
      try {
        const result = await runAgent({ agent: currentAgent, cwd,
          model: model === "default" && currentAgent !== "hermes" && findRegisteredAgent(currentAgent)?.protocol !== "acp" ? undefined : model,
          effort, permissionMode,
          prompt: `${instructions}\n\nTask: Integrate the already-installed CLI ${executable} as agent ${name} (${label}) in All Code. Launch arguments detected: ${JSON.stringify(detected?.args ?? [])}. Write only inside ${draft}. Do not register or install the result. Inspect the CLI's real capabilities and test what you can. Report gaps honestly.` },
        undefined, async ({ toolName, input: toolInput }) => {
          animation.pause()
          try { return await askApproval(toolName, toolInput, screen) }
          finally { animation.resume() }
        })
        screen.appendAgent(agentLabel(currentAgent), result.finalText.trim(), animation.stop())
      } catch (error) { animation.stop(); throw error }
      const prepared = inspectPluginDraft(draft)
      if (prepared.manifest.name !== name || prepared.manifest.command !== executable) throw new Error("Generated adapter identity or executable differs from the requested one")
      if (detected && JSON.stringify(prepared.manifest.args.slice(0, detected.args.length)) !== JSON.stringify(detected.args)) throw new Error("Generated adapter dropped the detected launch arguments")
      screen.append(`Review ${draft} before installing.\nLimitations: ${prepared.manifest.limitations.join("; ") || "none declared; verify capabilities yourself"}\nIts JavaScript will run with your user permissions. No existing agent configuration will be changed.`)
      const confirm = await pickItem("Install this adapter?", [
        { value: "no", label: "No — keep the draft for review" }, { value: "yes", label: "Yes — install and register" },
      ], { current: "no" }, input, output, screen)
      if (confirm === "yes") {
        const saved = installPluginDraft(draft)
        screen.append(`Registered ${saved.label}. Open /agent to select it.`)
      }
      return
    }
    const argsText = await askField("Launch arguments as JSON array (for example [\"acp\"]):", screen)
    const args = JSON.parse(argsText || "[]") as unknown
    if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) throw new Error("Launch arguments must be a JSON string array")
    const modelsText = protocol === "oneshot" ? await askField("Model IDs, comma-separated (optional):", screen) : ""
    const models = modelsText.split(",").map((value) => value.trim()).filter(Boolean)
    const skillDirsText = await askField("Global SKILL.md directories as JSON array (optional, for example [\"/path/to/skills\"]):", screen)
    const skillsDirs = JSON.parse(skillDirsText || "[]") as unknown
    if (!Array.isArray(skillsDirs) || skillsDirs.some((value) => typeof value !== "string")) throw new Error("Skill directories must be a JSON string array")
    screen.append(`${label} · ${protocol}\n${command} ${args.join(" ")}\n${protocol === "oneshot" ? "This CLI handles its own permissions; All Code cannot resume its native session." : "ACP approval requests can appear in All Code."}`)
    const confirm = await pickItem("Register this agent?", [
      { value: "no", label: "Cancel" }, { value: "yes", label: "Register" },
    ], { current: "no" }, input, output, screen)
    if (confirm !== "yes") return
    const saved = registerAgent({ name, label, protocol, command: resolveExecutable(command), args, models, skillsDirs: skillsDirs.map((path) => resolve(path)) })
    screen.append(`Registered ${saved.label}. Open /agent to select it.`)
    return
  }
  const source = await askField("Skill folder, SKILL.md path, or GitHub repository URL (#subdirectory optional):", screen)
  if (!source) return
  screen.setWorking("Inspecting skill…")
  const skill = prepareSkill(source)
  screen.setWorking("")
  try {
    screen.append(`${skill.name} · ${skill.description}\n${skill.destinations.map((target) => `${target.agents.join(" + ")} → ${target.path}`).join("\n")}\nExisting skills with this name will be skipped.`)
    const confirm = await pickItem("Install this skill? Review its source before trusting it.", [
      { value: "no", label: "Cancel" }, { value: "yes", label: "Install" },
    ], { current: "no" }, input, output, screen)
    if (confirm !== "yes") return
    const result = installPreparedSkill(skill)
    screen.append(`Installed:\n${result.installed.join("\n") || "None"}\nSkipped:\n${result.skipped.join("\n") || "None"}`)
  } finally { skill.cleanup() }
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
  const claude = new ClaudeStreamRunner()
  const hermes = new HermesAcpRunner()
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
      if (command === "/add") {
        try { await addInteractively(parts[0]?.toLowerCase(), screen, agent, cwd, model, effort, permissionMode) }
        catch (error) { screen.setWorking(""); screen.append(`Add failed: ${error instanceof Error ? error.message : String(error)}`) }
        continue
      }
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
        permissionMode = await chooseMode(agent, permissionMode, screen, cwd) ?? permissionMode
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
        agent = requested && isKnownAgent(requested)
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
        const selected = parts.length > 0 ? parts.join(" ") : await chooseModel(agent, model, screen, hermes, cwd, shared.nativeSession("hermes"))
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
        const request = {
          agent,
          cwd,
          model: model === "default" && agent !== "hermes" && findRegisteredAgent(agent)?.protocol !== "acp" ? undefined : model,
          effort,
          permissionMode,
          sessionId: shared.nativeSession(agent),
          prompt: shared.promptFor(agent, line),
        }
        const onApproval = ({ toolName, input: toolInput }: { toolName: string; input: Record<string, unknown> }) => {
          const decision = approvalQueue.then(async () => {
            animation.pause()
            try { return await askApproval(toolName, toolInput, screen) }
            finally { animation.resume() }
          })
          approvalQueue = decision.then(() => {}, () => {})
          return decision
        }
        const result = agent === "claude"
          ? await claude.run({ ...request, agent: "claude" }, onApproval)
          : agent === "hermes"
            ? await hermes.run({ ...request, agent: "hermes" }, onApproval)
          : await runAgent(request, undefined, onApproval)
        if (result.sessionId) shared.setNativeSession(agent, result.sessionId)
        shared.recordTurn(agent, line, result.finalText.trim())
        const elapsed = animation.stop()
        screen.appendAgent(agentLabel(agent), result.finalText.trim(), elapsed)
      } catch (error) {
        animation.stop()
        const message = error instanceof Error ? error.message : String(error)
        shared.recordFailure(agent, line, message)
        screen.append(`Error: ${message}\n`)
      }
    }
  } finally {
    await claude.close()
    await hermes.close()
    screen.stop()
    input.setRawMode(inputWasRaw)
    if (!inputWasFlowing) input.pause()
    output.write(`${gray}All Code closed.${reset}\n`)
  }
}
