import { afterEach, describe, expect, it } from "vitest"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { findRegisteredAgent } from "./agent-registry.js"
import { discoverModels } from "./models.js"
import { inspectPluginDraft, installPluginDraft } from "./plugin-installer.js"
import { runAgent } from "./runner.js"

const directories: string[] = []
const oldRegistry = process.env.ALL_CODE_AGENT_REGISTRY
function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "allcode-plugin-test-"))
  directories.push(path)
  process.env.ALL_CODE_AGENT_REGISTRY = join(path, "agents.json")
  return path
}

afterEach(() => {
  if (oldRegistry === undefined) delete process.env.ALL_CODE_AGENT_REGISTRY
  else process.env.ALL_CODE_AGENT_REGISTRY = oldRegistry
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("allcode-plugin-test-")) throw new Error("Unsafe test cleanup")
    rmSync(target, { recursive: true, force: true })
  }
})

describe("update-safe adapter plugins", () => {
  it("installs outside the package and exposes run, models, sessions, and approvals", async () => {
    const root = workspace()
    const draft = join(root, "draft")
    mkdirSync(draft)
    writeFileSync(join(draft, "adapter.json"), JSON.stringify({ apiVersion: 1, name: "demo-plugin", label: "Demo Plugin",
      command: process.execPath, args: [], models: [], skillsDirs: [join(root, "skills")], limitations: ["No streaming"] }))
    writeFileSync(join(draft, "agent.mjs"), `export default {
      apiVersion: 1, name: "demo-plugin",
      async run(request, context) {
        const allowed = await context.approve({toolName:"demo-tool",input:{value:request.prompt}})
        return {finalText:allowed ? "approved:"+request.prompt : "denied:"+request.prompt, sessionId:"demo-session"}
      },
      async listModels() { return [{id:"demo-model",label:"Demo Model"}] },
      async listEfforts() { return ["default","high"] },
      async listModes() { return [{id:"ask",label:"Ask"}] }
    }`)
    const installed = installPluginDraft(draft, join(root, "installed"))
    expect(installed.module).toBe(join(root, "installed", "demo-plugin", "agent.mjs"))
    expect(findRegisteredAgent("demo-plugin")?.skillsDirs).toEqual([join(root, "skills")])
    expect(existsSync(installed.module!)).toBe(true)
    const result = await runAgent({ agent: "demo-plugin", cwd: root, prompt: "hello" }, undefined, async () => false)
    expect(result.finalText).toBe("denied:hello")
    expect(result.sessionId).toBe("demo-session")
    expect((await discoverModels("demo-plugin")).models.some((model) => model.id === "demo-model")).toBe(true)
    expect(() => installPluginDraft(draft, join(root, "installed"))).toThrow(/already installed/)
    expect(readFileSync(process.env.ALL_CODE_AGENT_REGISTRY!, "utf8")).toContain("demo-plugin")
  })

  it("rejects drafts that cannot identify an installed executable", () => {
    const root = workspace()
    writeFileSync(join(root, "adapter.json"), JSON.stringify({ apiVersion: 1, name: "demo-plugin", label: "Demo", command: "missing", args: [], models: [], limitations: [] }))
    writeFileSync(join(root, "agent.mjs"), "export default {}")
    expect(() => inspectPluginDraft(root)).toThrow(/installed absolute file/)
  })
})
