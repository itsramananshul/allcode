import { execFileSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"

const overrides: Record<string, string> = {
  claude: "ALL_CODE_CLAUDE_COMMAND",
  opencode: "ALL_CODE_OPENCODE_COMMAND",
  codex: "ALL_CODE_CODEX_COMMAND",
}

function executableFromNpmShim(shim: string): string | undefined {
  if (!shim.toLowerCase().endsWith(".cmd")) return undefined
  const text = readFileSync(shim, "utf8")
  const match = text.match(/"%dp0%[\\/]([^"\r\n]+\.exe)"/i)
  if (!match?.[1]) return undefined
  const candidate = join(dirname(shim), match[1])
  return existsSync(candidate) ? candidate : undefined
}

export function resolveExecutable(command: string): string {
  const overrideName = overrides[command]
  const override = overrideName ? process.env[overrideName] : undefined
  if (override) {
    const candidate = isAbsolute(override) ? override : resolve(override)
    if (!existsSync(candidate)) throw new Error(`${overrideName} points to a missing file: ${candidate}`)
    return candidate
  }

  if (isAbsolute(command) && existsSync(command)) return command

  if (process.platform === "win32") {
    const output = execFileSync("where.exe", [command], { encoding: "utf8", windowsHide: true })
    const candidates = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const executable = candidates.find((candidate) => candidate.toLowerCase().endsWith(".exe"))
    if (executable) return executable
    for (const candidate of candidates) {
      const resolved = executableFromNpmShim(candidate)
      if (resolved) return resolved
    }
    throw new Error(`Found ${command}, but not an executable Windows launcher. Set ${overrideName}.`)
  }

  return execFileSync("which", [command], { encoding: "utf8" }).trim()
}

export function executableStatus(command: string): { available: boolean; path?: string; error?: string } {
  try {
    return { available: true, path: resolveExecutable(command) }
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error) }
  }
}
