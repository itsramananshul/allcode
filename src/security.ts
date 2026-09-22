import { existsSync, realpathSync, statSync } from "node:fs"
import { delimiter, resolve, sep } from "node:path"

function normalize(value: string): string {
  const resolved = realpathSync(resolve(value))
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

export function allowedRoots(): string[] {
  const configured = process.env.ALL_CODE_ALLOWED_ROOTS
  return (configured ? configured.split(delimiter) : [process.cwd()])
    .filter(Boolean)
    .map(normalize)
}

export function validateWorkspace(cwd: string, roots = allowedRoots()): string {
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) throw new Error(`Workspace does not exist: ${cwd}`)
  const candidate = normalize(cwd)
  const allowed = roots.map(normalize)
    .some((root) => candidate === root || candidate.startsWith(root.endsWith(sep) ? root : `${root}${sep}`))
  if (!allowed) throw new Error(`Workspace is outside ALL_CODE_ALLOWED_ROOTS: ${cwd}`)
  return realpathSync(resolve(cwd))
}
