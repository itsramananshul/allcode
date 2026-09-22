import { describe, expect, it } from "vitest"
import { runProcess } from "./process-runner.js"

describe("bounded process execution", () => {
  it("captures output without using a command shell", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "process.stdout.write('allcode-ok')"],
      cwd: process.cwd(),
    }, 5_000)
    expect(result).toMatchObject({ exitCode: 0, stdout: "allcode-ok", timedOut: false })
  })

  it("marks a process that exceeds its timeout", async () => {
    const result = await runProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000)"],
      cwd: process.cwd(),
    }, 50)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })
})
