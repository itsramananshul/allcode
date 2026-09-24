import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { homedir, tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { executableStatus } from "./executable.js"
import { registeredAgents } from "./agent-registry.js"

export interface SkillDestination { agents: string[]; path: string }
export interface PreparedSkill {
  name: string
  description: string
  sourceDir: string
  destinations: SkillDestination[]
  cleanup(): void
}

export function skillDestinations(home = homedir(), hermesHome = process.env.HERMES_HOME || join(home, ".hermes")): SkillDestination[] {
  const destinations: SkillDestination[] = []
  if (executableStatus("claude").available) destinations.push({ agents: ["Claude Code"], path: join(home, ".claude", "skills") })
  const shared = ["codex", "opencode"].filter((agent) => executableStatus(agent).available)
  if (shared.length) destinations.push({ agents: shared.map((agent) => agent === "codex" ? "Codex" : "OpenCode"), path: join(home, ".agents", "skills") })
  if (executableStatus("hermes").available) destinations.push({ agents: ["Hermes"], path: join(hermesHome, "skills") })
  for (const agent of registeredAgents()) {
    for (const path of agent.skillsDirs ?? []) {
      const existing = destinations.find((destination) => resolve(destination.path) === resolve(path))
      if (existing) existing.agents.push(agent.label)
      else destinations.push({ agents: [agent.label], path })
    }
  }
  return destinations
}

function skillDirectory(source: string): { directory: string; cleanup: () => void } {
  if (!/^https?:\/\//i.test(source)) {
    const path = resolve(source)
    const directory = basename(path).toLowerCase() === "skill.md" ? dirname(path) : path
    return { directory, cleanup: () => {} }
  }
  const url = new URL(source)
  if (url.protocol !== "https:" || url.hostname !== "github.com" || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.pathname)) {
    throw new Error("Git skill sources must be an HTTPS GitHub repository URL with an optional #subdirectory")
  }
  const subdir = decodeURIComponent(url.hash.slice(1))
  if (subdir && (isAbsolute(subdir) || subdir.split(/[\\/]/).some((part) => part === ".." || part === "."))) {
    throw new Error("Invalid skill subdirectory")
  }
  const clone = mkdtempSync(join(tmpdir(), "allcode-skill-"))
  try {
    url.hash = ""
    execFileSync("git", ["clone", "--depth", "1", "--", url.toString(), clone], { windowsHide: true, timeout: 120_000, stdio: "pipe" })
    const directory = resolve(clone, subdir)
    if (directory !== clone && !directory.startsWith(`${clone}${sep}`)) throw new Error("Skill subdirectory escapes the repository")
    return { directory, cleanup: () => safeRemoveTemp(clone) }
  } catch (error) {
    safeRemoveTemp(clone)
    throw error
  }
}

function safeRemoveTemp(path: string): void {
  const temp = resolve(tmpdir())
  const target = resolve(path)
  if (dirname(target) !== temp || !basename(target).startsWith("allcode-skill-")) throw new Error("Refusing to remove an unexpected temporary directory")
  rmSync(target, { recursive: true, force: true })
}

function checkSkillTree(root: string): void {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Skill folder not found: ${root}`)
  if (lstatSync(root).isSymbolicLink()) throw new Error(`Skill folder is a symlink: ${root}`)
  let files = 0
  let bytes = 0
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      if (entry === ".git") continue
      const path = join(directory, entry)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`Skill contains a symlink: ${path}`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) { files += 1; bytes += stat.size }
      else throw new Error(`Unsupported skill entry: ${path}`)
      if (files > 512 || bytes > 32 * 1024 * 1024) throw new Error("Skill exceeds the 512-file or 32-MiB limit")
    }
  }
  visit(root)
}

export function prepareSkill(source: string, destinations = skillDestinations()): PreparedSkill {
  const resolved = skillDirectory(source)
  try {
    checkSkillTree(resolved.directory)
    const skillFile = join(resolved.directory, "SKILL.md")
    if (!existsSync(skillFile)) throw new Error(`SKILL.md not found in ${resolved.directory}`)
    const content = readFileSync(skillFile, "utf8")
    const frontmatter = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
    if (!frontmatter) throw new Error("SKILL.md needs YAML frontmatter with name and description")
    const name = frontmatter[1]!.match(/^name:\s*['"]?([^'"\r\n]+)['"]?\s*$/m)?.[1]?.trim()
    const descriptionMatch = frontmatter[1]!.match(/^description:\s*(.*)$/m)
    const rawDescription = descriptionMatch?.[1]?.trim() ?? ""
    const description = /^[>|][-+]?\s*$/.test(rawDescription)
      ? frontmatter[1]!.slice((descriptionMatch?.index ?? 0) + (descriptionMatch?.[0].length ?? 0)).match(/^(?:\r?\n[ \t]+[^\r\n]+)+/)?.[0]?.trim().replace(/\s+/g, " ")
      : rawDescription.replace(/^['"]|['"]$/g, "").trim()
    if (!name || !/^[a-z][a-z0-9-]{1,63}$/.test(name)) throw new Error("Skill name must be a lowercase slug in SKILL.md frontmatter")
    if (!description) throw new Error("SKILL.md needs a one-line description in frontmatter")
    if (destinations.length === 0) throw new Error("No supported installed agents were found")
    return { name, description, sourceDir: resolved.directory, destinations, cleanup: resolved.cleanup }
  } catch (error) {
    resolved.cleanup()
    throw error
  }
}

export function installPreparedSkill(skill: PreparedSkill): { installed: string[]; skipped: string[] } {
  const installed: string[] = []
  const skipped: string[] = []
  for (const destination of skill.destinations) {
    const target = join(destination.path, skill.name)
    if (existsSync(target)) { skipped.push(`${destination.agents.join(" + ")}: ${target}`); continue }
    mkdirSync(destination.path, { recursive: true })
    const temporary = join(destination.path, `.allcode-${skill.name}-${randomUUID()}`)
    try {
      cpSync(skill.sourceDir, temporary, { recursive: true, filter: (path) => basename(path) !== ".git" })
      renameSync(temporary, target)
      installed.push(`${destination.agents.join(" + ")}: ${target}`)
    } catch (error) {
      const resolved = resolve(temporary)
      if (dirname(resolved) !== resolve(destination.path) || !basename(resolved).startsWith(`.allcode-${skill.name}-`)) throw error
      rmSync(resolved, { recursive: true, force: true })
      throw error
    }
  }
  return { installed, skipped }
}
