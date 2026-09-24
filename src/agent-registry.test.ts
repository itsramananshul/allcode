import { afterEach, describe, expect, it } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { listAgentNames, registerAgent } from "./agent-registry.js"
import { runAgent } from "./runner.js"

const directories: string[] = []
const previousRegistry = process.env.ALL_CODE_AGENT_REGISTRY

function isolatedRegistry(): string {
  const directory = mkdtempSync(join(tmpdir(), "allcode-registry-test-"))
  directories.push(directory)
  const path = join(directory, "agents.json")
  process.env.ALL_CODE_AGENT_REGISTRY = path
  return path
}

afterEach(() => {
  if (previousRegistry === undefined) delete process.env.ALL_CODE_AGENT_REGISTRY
  else process.env.ALL_CODE_AGENT_REGISTRY = previousRegistry
  for (const directory of directories.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("allcode-registry-test-")) throw new Error("Unsafe test cleanup")
    rmSync(target, { recursive: true, force: true })
  }
})

describe("registered agents", () => {
  it("registers a one-shot CLI and passes its prompt on stdin", async () => {
    const path = isolatedRegistry()
    registerAgent({ name: "demo-cli", label: "Demo CLI", protocol: "oneshot", command: process.execPath,
      args: ["-e", "process.stdin.on('data',d=>process.stdout.write('reply:'+d.toString()))"], models: [] })
    expect(listAgentNames()).toContain("demo-cli")
    expect(readFileSync(path, "utf8")).toContain("demo-cli")
    const result = await runAgent({ agent: "demo-cli", cwd: process.cwd(), prompt: "hello" })
    expect(result.finalText).toBe("reply:hello")
    expect(result.sessionId).toBeUndefined()
  })

  it("registers an ACP CLI with session and host permission handling", async () => {
    isolatedRegistry()
    const fixture = `const r=require('node:readline').createInterface({input:process.stdin}); const send=x=>process.stdout.write(JSON.stringify(x)+'\\n'); r.on('line',l=>{const m=JSON.parse(l); if(m.method==='initialize')send({id:m.id,result:{protocolVersion:1}}); else if(m.method==='session/new')send({id:m.id,result:{sessionId:'11111111-1111-4111-8111-111111111111',models:{availableModels:[],currentModelId:'default'},modes:{currentModeId:'default'}}}); else if(m.method==='session/prompt'){send({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'ACP reply'}}}});send({id:m.id,result:{stopReason:'end_turn'}})}})`
    registerAgent({ name: "demo-acp", label: "Demo ACP", protocol: "acp", command: process.execPath,
      args: ["-e", fixture], models: [] })
    const result = await runAgent({ agent: "demo-acp", cwd: process.cwd(), prompt: "hello" })
    expect(result.finalText).toBe("ACP reply")
    expect(result.sessionId).toBe("11111111-1111-4111-8111-111111111111")
  })

  it("rejects duplicate and reserved IDs", () => {
    isolatedRegistry()
    const candidate = { name: "demo-cli", label: "Demo", protocol: "oneshot" as const, command: process.execPath, args: [], models: [] }
    registerAgent(candidate)
    expect(() => registerAgent(candidate)).toThrow(/already registered/)
    expect(() => registerAgent({ ...candidate, name: "hermes" })).toThrow(/reserved/)
  })
})
