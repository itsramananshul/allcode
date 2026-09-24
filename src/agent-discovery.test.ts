import { afterEach, describe, expect, it } from "vitest"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { discoverCommandByName, discoverInstalledAgents } from "./agent-discovery.js"

const temp: string[] = []
afterEach(() => { for (const directory of temp.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe("installed agent discovery", () => {
  it("finds executables without running them and ignores non-coding agents", async () => {
    const directory = mkdtempSync(join(tmpdir(), "allcode-discovery-"))
    temp.push(directory)
    const extension = process.platform === "win32" ? ".exe" : ""
    writeFileSync(join(directory, `gemini${extension}`), "not a real executable")
    writeFileSync(join(directory, `ssh-agent${extension}`), "not a coding agent")
    if (process.platform !== "win32") chmodSync(join(directory, "gemini"), 0o755)
    const found = await discoverInstalledAgents(directory)
    expect(found.map((candidate) => candidate.name)).toEqual(["gemini"])
    expect(found[0]?.command).toBe(join(directory, `gemini${extension}`))
  })

  it.skipIf(process.platform !== "win32")("resolves npm shims to their underlying executable", async () => {
    const directory = mkdtempSync(join(tmpdir(), "allcode-discovery-"))
    temp.push(directory)
    const target = join(directory, "node_modules", "sample-agent", "bin", "sample-agent.exe")
    const { mkdirSync } = await import("node:fs")
    mkdirSync(join(directory, "node_modules", "sample-agent", "bin"), { recursive: true })
    writeFileSync(target, "not a real executable")
    writeFileSync(join(directory, "sample-agent.cmd"), '"%dp0%\\node_modules\\sample-agent\\bin\\sample-agent.exe" %*')
    const found = await discoverInstalledAgents(`${directory}${delimiter}${directory}`)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ name: "sample-agent", command: target, args: [] })
    expect(await discoverCommandByName("sample-agent", directory)).toMatchObject({ command: target, args: [] })
    expect(await discoverCommandByName("missing-agent", directory)).toBeUndefined()
  })
})
