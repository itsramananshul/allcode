import { describe, expect, it } from "vitest"
import { HermesAcpRunner } from "./hermes-acp-runner.js"
import type { RunRequest } from "./types.js"

const fixture = `
const readline = require("node:readline")
let promptId
let model = "copilot:gpt-4.1"
let mode = "default"
let turn = 0
const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n")
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line)
  if (message.method === "initialize") send({ id: message.id, result: { protocolVersion: 1 } })
  else if (message.method === "session/new") send({ id: message.id, result: {
    sessionId: "11111111-1111-4111-8111-111111111111",
    models: { currentModelId: model, availableModels: [{ modelId: model, name: "GPT-4.1" }] },
    modes: { currentModeId: mode },
  } })
  else if (message.method === "session/set_model") {
    model = message.params.modelId
    send({ id: message.id, result: {} })
  } else if (message.method === "session/set_mode") {
    mode = message.params.modeId
    send({ id: message.id, result: {} })
  } else if (message.method === "session/prompt") {
    promptId = message.id
    turn += 1
    send({ id: 900 + turn, method: "session/request_permission", params: {
      toolCall: { title: "Write file", rawInput: { path: "test.txt" } },
      options: [{ optionId: "allow_once", kind: "allow_once" }, { optionId: "deny", kind: "reject_once" }],
    } })
  } else if (message.id === 900 + turn) {
    const decision = message.result.outcome.optionId
    send({ method: "session/update", params: { update: {
      sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Considering" },
    } } })
    send({ method: "session/update", params: { update: {
      sessionUpdate: "tool_call", title: "Write file", status: "in_progress", rawInput: { path: "test.txt" },
    } } })
    send({ method: "session/update", params: { update: {
      sessionUpdate: "agent_message_chunk", content: { type: "text", text: turn + ":" + decision + ":" + model + ":" + mode },
    } } })
    send({ id: promptId, result: { stopReason: "end_turn" } })
  }
})
`

const request: RunRequest = { agent: "hermes", cwd: process.cwd(), prompt: "test", permissionMode: "default" }

describe("Hermes ACP route", () => {
  it("forwards exposed thought, tool, and reply updates", async () => {
    const runner = new HermesAcpRunner(() => ({
      command: process.execPath, args: ["-e", fixture], cwd: process.cwd(),
    }))
    const events: Array<{ kind: string; text: string }> = []
    try {
      await runner.run(request, async () => true, undefined, (event) => events.push(event))
      expect(events).toContainEqual({ kind: "reasoning", text: "Considering" })
      expect(events.some((event) => event.kind === "tool" && event.text.includes("Write file"))).toBe(true)
      expect(events.some((event) => event.kind === "text" && event.text.includes("allow_once"))).toBe(true)
    } finally { await runner.close() }
  })

  it("does not start a turn when already interrupted", async () => {
    const runner = new HermesAcpRunner(() => ({
      command: process.execPath, args: ["-e", fixture], cwd: process.cwd(),
    }))
    const controller = new AbortController()
    controller.abort()
    await expect(runner.run(request, undefined, controller.signal)).rejects.toThrow()
    await runner.close()
  })

  it("cancels a running turn while an approval is pending", async () => {
    const runner = new HermesAcpRunner(() => ({
      command: process.execPath, args: ["-e", fixture], cwd: process.cwd(),
    }))
    const controller = new AbortController()
    let approvalStarted!: () => void
    const approvalSeen = new Promise<void>((resolve) => { approvalStarted = resolve })
    try {
      const running = runner.run(request, async () => {
        approvalStarted()
        return await new Promise<boolean>(() => {})
      }, controller.signal)
      await approvalSeen
      controller.abort()
      await expect(running).rejects.toThrow()
    } finally { await runner.close() }
  }, 10_000)

  it("discovers models, keeps a session, and routes approve/deny through the host", async () => {
    const runner = new HermesAcpRunner(() => ({
      command: process.execPath, args: ["-e", fixture], cwd: process.cwd(),
    }))
    try {
      const models = await runner.listModels(request)
      expect(models.currentModelId).toBe("copilot:gpt-4.1")
      const first = await runner.run(request, async () => false)
      const second = await runner.run({ ...request, sessionId: first.sessionId, model: "copilot:gpt-4.1",
        permissionMode: "accept_edits" }, async () => true)
      expect(first.finalText).toBe("1:deny:copilot:gpt-4.1:default")
      expect(second.finalText).toBe("2:allow_once:copilot:gpt-4.1:accept_edits")
      expect(second.sessionId).toBe(first.sessionId)
    } finally { await runner.close() }
  }, 15_000)
})
