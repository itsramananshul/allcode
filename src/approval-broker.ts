import { createServer, type Server } from "node:http"
import { randomUUID } from "node:crypto"

export interface ApprovalRequest {
  toolName: string
  input: Record<string, unknown>
}

export type ApprovalHandler = (request: ApprovalRequest) => Promise<boolean>

export class ApprovalBroker {
  private server?: Server
  readonly token = randomUUID()
  port = 0

  constructor(private readonly handler: ApprovalHandler) {}

  async start(): Promise<void> {
    this.server = createServer(async (request, response) => {
      if (request.method !== "POST" || request.url !== "/approval" || request.headers.authorization !== `Bearer ${this.token}`) {
        response.writeHead(403).end()
        return
      }
      let body = ""
      try {
        for await (const chunk of request) {
          body += chunk.toString("utf8")
          if (body.length > 1_000_000) throw new Error("Approval payload too large")
        }
        const parsed = JSON.parse(body) as ApprovalRequest
        if (typeof parsed.toolName !== "string" || !parsed.input || typeof parsed.input !== "object" || Array.isArray(parsed.input)) {
          throw new Error("Invalid approval payload")
        }
        const approved = await this.handler(parsed)
        response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ approved }))
      } catch {
        response.writeHead(400).end(JSON.stringify({ approved: false }))
      }
    })
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject)
      this.server!.listen(0, "127.0.0.1", resolve)
    })
    const address = this.server.address()
    if (!address || typeof address === "string") throw new Error("Approval broker did not bind to a TCP port")
    this.port = address.port
  }

  async close(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server!.close(() => resolve()))
    this.server = undefined
  }
}
