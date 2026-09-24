import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { installPreparedSkill, prepareSkill, skillDestinations } from "./skill-installer.js"
import { registerAgent } from "./agent-registry.js"

const directories: string[] = []
const previousRegistry = process.env.ALL_CODE_AGENT_REGISTRY
function directory(): string {
  const path = mkdtempSync(join(tmpdir(), "allcode-skill-test-"))
  directories.push(path)
  return path
}

afterEach(() => {
  if (previousRegistry === undefined) delete process.env.ALL_CODE_AGENT_REGISTRY
  else process.env.ALL_CODE_AGENT_REGISTRY = previousRegistry
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("allcode-skill-test-")) throw new Error("Unsafe test cleanup")
    rmSync(target, { recursive: true, force: true })
  }
})

describe("skill installation", () => {
  it("copies a local SKILL.md folder to each distinct agent location without overwriting", () => {
    const root = directory()
    const source = join(root, "source")
    mkdirSync(source)
    writeFileSync(join(source, "SKILL.md"), "---\nname: demo-skill\ndescription: A test skill\n---\nInstructions.\n")
    writeFileSync(join(source, "helper.txt"), "asset")
    const prepared = prepareSkill(source, [
      { agents: ["Claude Code"], path: join(root, "claude") },
      { agents: ["Codex", "OpenCode"], path: join(root, "shared") },
    ])
    const first = installPreparedSkill(prepared)
    expect(first.installed).toHaveLength(2)
    expect(readFileSync(join(root, "shared", "demo-skill", "helper.txt"), "utf8")).toBe("asset")
    expect(existsSync(join(root, "claude", "demo-skill", "SKILL.md"))).toBe(true)
    expect(installPreparedSkill(prepared).skipped).toHaveLength(2)
  })

  it("rejects a folder without skill metadata", () => {
    const source = directory()
    writeFileSync(join(source, "SKILL.md"), "No frontmatter")
    expect(() => prepareSkill(source, [{ agents: ["Codex"], path: join(source, "target") }])).toThrow(/frontmatter/)
  })

  it("accepts folded YAML descriptions used by existing skills", () => {
    const source = directory()
    writeFileSync(join(source, "SKILL.md"), "---\nname: folded-skill\ndescription: >\n  First line\n  second line\n---\nInstructions.\n")
    const skill = prepareSkill(source, [{ agents: ["Codex"], path: join(source, "target") }])
    expect(skill.description).toBe("First line second line")
  })

  it("includes declared custom-agent skill directories without replacing built-in targets", () => {
    const root = directory()
    process.env.ALL_CODE_AGENT_REGISTRY = join(root, "agents.json")
    const customSkills = join(root, "custom-skills")
    registerAgent({ name: "demo-agent", label: "Demo Agent", protocol: "oneshot", command: process.execPath,
      args: [], models: [], skillsDirs: [customSkills] })
    const targets = skillDestinations(root, join(root, "hermes"))
    expect(targets.some((target) => target.path === customSkills && target.agents.includes("Demo Agent"))).toBe(true)
  })
})
