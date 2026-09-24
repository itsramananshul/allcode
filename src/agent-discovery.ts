import { readdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { basename, delimiter, dirname, isAbsolute, join } from "node:path"

export interface InstalledAgentCandidate {
  name: string
  label: string
  command: string
  args: string[]
  launcher: string
}

const labels: Record<string, string> = {
  claude: "Claude Code", opencode: "OpenCode", codex: "Codex", hermes: "Hermes",
  aider: "Aider", gemini: "Gemini CLI", goose: "Goose", amp: "Amp", crush: "Crush",
  qwen: "Qwen Code", kimi: "Kimi CLI", "cursor-agent": "Cursor Agent", droid: "Factory Droid",
  pi: "Pi", openhands: "OpenHands", cline: "Cline", continue: "Continue", kilocode: "Kilo Code",
}
const nonCodingAgents = new Set(["ssh-agent", "gpg-agent", "pageant", "winssh-agent"])

function candidateName(file: string): string | undefined {
  const match = file.toLowerCase().match(/^([a-z][a-z0-9_-]{1,39})\.(exe|cmd)$/)
  if (!match) return undefined
  const name = match[1]!.replaceAll("_", "-")
  if (name === "allcode" || name === "code" || name === "code-insiders" || nonCodingAgents.has(name)) return undefined
  return Object.hasOwn(labels, name) || /(?:^|-)agent$/.test(name) || /^agent-/.test(name) ? name : undefined
}

function npmShimTarget(shim: string): { command: string; args: string[] } | undefined {
  try {
    const content = readFileSync(shim, "utf8")
    const match = content.match(/"%dp0%[\\/](node_modules[\\/][^"\r\n]+\.(?:exe|js|mjs|cjs))"/i)
    if (!match?.[1]) return undefined
    const target = join(dirname(shim), match[1])
    if (!existsSync(target)) return undefined
    return target.toLowerCase().endsWith(".exe")
      ? { command: target, args: [] }
      : { command: process.execPath, args: [target] }
  } catch { return undefined }
}

async function directoryEntries(directory: string): Promise<string[]> {
  let timer: NodeJS.Timeout | undefined
  try {
    const entries = await Promise.race([
      readdir(directory, { withFileTypes: true }),
      new Promise<[]>((resolve) => { timer = setTimeout(() => resolve([]), 750) }),
    ])
    return entries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  } catch { return [] }
  finally { if (timer) clearTimeout(timer) }
}

export async function discoverInstalledAgents(pathValue = process.env.PATH ?? process.env.Path ?? ""): Promise<InstalledAgentCandidate[]> {
  const directories = [...new Set(pathValue.split(delimiter).map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => isAbsolute(entry) && !entry.startsWith("\\\\")))].slice(0, 64)
  const listings = await Promise.all(directories.map(directoryEntries))
  const found = new Map<string, InstalledAgentCandidate>()
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index]!
    const files = listings[index]!
    const ordered = [...files].sort((a, b) => Number(b.toLowerCase().endsWith(".exe")) - Number(a.toLowerCase().endsWith(".exe")))
    for (const file of ordered) {
      const name = candidateName(file)
      if (!name || found.has(name)) continue
      const launcher = join(directory, file)
      const isExe = file.toLowerCase().endsWith(".exe")
      const target = isExe ? { command: launcher, args: [] } : npmShimTarget(launcher)
      if (!target) continue
      found.set(name, { name, label: labels[name] ?? name.replaceAll("-", " "),
        command: target.command, args: target.args, launcher })
    }
  }
  return [...found.values()].sort((a, b) => a.label.localeCompare(b.label))
}

export async function discoverCommandByName(name: string, pathValue = process.env.PATH ?? process.env.Path ?? ""): Promise<InstalledAgentCandidate | undefined> {
  if (!/^[a-z][a-z0-9_-]{1,39}$/i.test(name)) return undefined
  const normalized = name.toLowerCase().replaceAll("_", "-")
  const directories = [...new Set(pathValue.split(delimiter).map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => isAbsolute(entry) && !entry.startsWith("\\\\")))].slice(0, 64)
  const listings = await Promise.all(directories.map(directoryEntries))
  for (let index = 0; index < directories.length; index += 1) {
    const directory = directories[index]!
    const files = listings[index]!
    for (const extension of [".exe", ".cmd"]) {
      const file = files.find((entry) => entry.toLowerCase() === `${name.toLowerCase()}${extension}`)
      if (!file) continue
      const launcher = join(directory, file)
      const target = extension === ".exe" ? { command: launcher, args: [] } : npmShimTarget(launcher)
      if (target) return { name: normalized, label: labels[normalized] ?? normalized.replaceAll("-", " "),
        command: target.command, args: target.args, launcher }
    }
  }
  return undefined
}
