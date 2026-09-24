import { existsSync, lstatSync, mkdirSync } from "node:fs"
import { resolve } from "node:path"

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
