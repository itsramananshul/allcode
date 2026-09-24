import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { execFileSync } from "node:child_process"
import { registerAgent, type RegisteredAgent } from "./agent-registry.js"

export interface PluginDraft extends Omit<RegisteredAgent, "protocol" | "module" | "limitations"> {
  apiVersion: 1
  limitations: string[]
}

function checkTree(root: string): void {
  if (!existsSync(root) || !statSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw new Error(`Adapter folder not found: ${root}`)
  let files = 0
  let bytes = 0
  const visit = (folder: string): void => {
    for (const entry of readdirSync(folder)) {
      const path = join(folder, entry)
      const stat = lstatSync(path)
      if (stat.isSymbolicLink()) throw new Error(`Adapter contains a symlink: ${path}`)
      if (stat.isDirectory()) visit(path)
      else if (stat.isFile()) { files += 1; bytes += stat.size }
      else throw new Error(`Unsupported adapter entry: ${path}`)
      if (files > 128 || bytes > 8 * 1024 * 1024) throw new Error("Adapter exceeds the 128-file or 8-MiB limit")
    }
  }
  visit(root)
}

export function inspectPluginDraft(source: string): { directory: string; manifest: PluginDraft } {
  const directory = resolve(source)
  checkTree(directory)
  const manifestFile = join(directory, "adapter.json")
  const moduleFile = join(directory, "agent.mjs")
  if (!existsSync(manifestFile) || !existsSync(moduleFile) || !statSync(moduleFile).isFile()) {
    throw new Error("Adapter draft needs adapter.json and agent.mjs")
  }
  execFileSync(process.execPath, ["--check", moduleFile], { windowsHide: true, timeout: 10_000, stdio: "pipe" })
  const parsed = JSON.parse(readFileSync(manifestFile, "utf8")) as Partial<PluginDraft>
  if (parsed.apiVersion !== 1 || typeof parsed.name !== "string" || !/^[a-z][a-z0-9-]{1,39}$/.test(parsed.name)) throw new Error("Invalid adapter API version or name")
  if (typeof parsed.label !== "string" || !parsed.label.trim()) throw new Error("Adapter label is required")
  if (typeof parsed.command !== "string" || !isAbsolute(parsed.command) || !existsSync(parsed.command) || !statSync(parsed.command).isFile()) throw new Error("Adapter command must be an installed absolute file")
  if (!Array.isArray(parsed.args) || parsed.args.some((arg) => typeof arg !== "string")) throw new Error("Adapter args must be a string array")
  if (!Array.isArray(parsed.models) || parsed.models.some((id) => typeof id !== "string")) throw new Error("Adapter models must be a string array")
  if (parsed.skillsDirs !== undefined && (!Array.isArray(parsed.skillsDirs) || parsed.skillsDirs.some((path) => typeof path !== "string" || !isAbsolute(path)))) throw new Error("Adapter skill directories must be absolute paths")
  if (!Array.isArray(parsed.limitations) || parsed.limitations.some((item) => typeof item !== "string" || !item.trim() || item.length > 300)) throw new Error("Adapter limitations must be a list of short strings; include unverified capabilities")
  return { directory, manifest: parsed as PluginDraft }
}

export function installPluginDraft(source: string, base = join(homedir(), ".allcode", "adapters")): RegisteredAgent {
  const { directory, manifest } = inspectPluginDraft(source)
  const target = join(base, manifest.name)
  if (existsSync(target)) throw new Error(`Adapter ${manifest.name} is already installed at ${target}`)
  mkdirSync(base, { recursive: true })
  const temporary = join(base, `.allcode-${manifest.name}-${randomUUID()}`)
  try {
    cpSync(directory, temporary, { recursive: true, errorOnExist: true })
    renameSync(temporary, target)
    try {
      return registerAgent({ name: manifest.name, label: manifest.label, protocol: "plugin", command: manifest.command,
        args: manifest.args, models: manifest.models, module: join(target, "agent.mjs"), skillsDirs: manifest.skillsDirs,
        limitations: manifest.limitations })
    } catch (error) {
      // This directory was created by this call, so it is safe to remove on registration failure.
      rmSync(target, { recursive: true, force: true })
      throw error
    }
  } catch (error) {
    if (existsSync(temporary) && dirname(resolve(temporary)) === resolve(base) && basename(temporary).startsWith(`.allcode-${manifest.name}-`)) {
      rmSync(temporary, { recursive: true, force: true })
    }
    throw error
  }
}
