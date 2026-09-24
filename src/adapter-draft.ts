import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

export function prepareAdapterDraft(cwd: string, name: string): { directory: string; reused: boolean } {
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(name)) throw new Error("Agent ID must be a lowercase slug")
  const directory = resolve(cwd, ".allcode", "adapter-drafts", name)
  const reused = existsSync(directory)
  if (reused) {
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Adapter draft path is not a regular directory: ${directory}`)
  } else {
    mkdirSync(directory, { recursive: true })
  }
  return { directory, reused }
}

function buildSessionPath(draft: string): string {
  return join(dirname(dirname(draft)), "adapter-build-sessions", `${basename(draft)}.json`)
}

export function readAdapterBuildSession(draft: string, agent: string, executable: string): string | undefined {
  const path = buildSessionPath(draft)
  if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return undefined
  try {
    const saved = JSON.parse(readFileSync(path, "utf8")) as { agent?: string; executable?: string; sessionId?: string }
    return saved.agent === agent && saved.executable === executable &&
      typeof saved.sessionId === "string" && /^[a-zA-Z0-9_-]{8,128}$/.test(saved.sessionId)
      ? saved.sessionId : undefined
  } catch { return undefined }
}

export function writeAdapterBuildSession(draft: string, agent: string, executable: string, sessionId: string): void {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(sessionId)) return
  const path = buildSessionPath(draft)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  writeFileSync(temporary, `${JSON.stringify({ agent, executable, sessionId })}\n`, "utf8")
  renameSync(temporary, path)
}
