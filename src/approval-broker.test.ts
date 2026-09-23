import { describe, expect, it } from "vitest"
import { ApprovalBroker } from "./approval-broker.js"

describe("approval broker", () => {
  it("passes a tool request to the human decision handler and rejects unauthenticated calls", async () => {
    const seen: string[] = []
    const broker = new ApprovalBroker(async ({ toolName }) => {
      seen.push(toolName)
      return toolName === "Read"
    })
    await broker.start()
    try {
      const url = `http://127.0.0.1:${broker.port}/approval`
      const denied = await fetch(url, { method: "POST", body: "{}" })
      expect(denied.status).toBe(403)
      const result = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${broker.token}` },
        body: JSON.stringify({ toolName: "Write", input: { file_path: "note.txt" } }),
      })
      expect(await result.json()).toEqual({ approved: false })
      expect(seen).toEqual(["Write"])
    } finally {
      await broker.close()
    }
  })
})
