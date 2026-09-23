import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { listAdapters } from "./adapters.js"
import { executableStatus } from "./executable.js"
import { validateWorkspace } from "./security.js"
import { TaskManager } from "./task-manager.js"
import { agentNames, type AgentName, type RunRequest, type TaskRecord } from "./types.js"

const manager = new TaskManager()

function response(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value as Record<string, unknown>,
  }
}

function publicTask(task: TaskRecord) {
  return {
    ...task,
    request: { ...task.request, prompt: task.request.prompt.slice(0, 240) },
  }
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer(
    { name: "allcode", version: "0.1.0" },
    {
      instructions: "You are the selected lead agent. Keep ownership of the user's task, but proactively choose Claude Code, OpenCode, or Codex when another engine is better suited to a subtask. Use list_agents to inspect availability, start_task to delegate, and task_status to collect the result before integrating it. Each target performs work with its own native models and full native tool set while retaining its own authentication, subscriptions, permissions, and session state. Do not delegate back to the current host unless the user explicitly requests it.",
    },
  )

  server.registerTool("list_agents", {
    description: "List the locally available coding-agent engines.",
    inputSchema: {},
  }, async () => response({
    host: process.env.ALL_CODE_HOST ?? "unknown",
    agents: listAdapters().map((adapter) => ({
      name: adapter.name,
      description: adapter.description,
      ...executableStatus(adapter.name),
    })),
  }))

  server.registerTool("start_task", {
    description: "Start a coding task inside another agent engine. Returns immediately with a task ID; use task_status to read progress/result.",
    inputSchema: {
      agent: z.enum(agentNames).describe("The engine that must actually execute the task"),
      prompt: z.string().min(1).max(200_000),
      cwd: z.string().min(1).describe("Working directory, restricted to configured allowed roots"),
      model: z.string().optional().describe("Optional native model ID understood by the target engine"),
      sessionId: z.string().optional().describe("Optional target-engine session/thread ID to continue"),
      timeoutMs: z.number().int().min(1_000).max(7_200_000).optional(),
    },
  }, async ({ agent, prompt, cwd, model, sessionId, timeoutMs }) => {
    const request: RunRequest = {
      agent: agent as AgentName,
      prompt,
      cwd: validateWorkspace(cwd),
      model,
      sessionId,
      timeoutMs,
    }
    return response(publicTask(manager.start(request)))
  })

  server.registerTool("task_status", {
    description: "Read a delegated task's state and final result.",
    inputSchema: { taskId: z.string().uuid() },
  }, async ({ taskId }) => {
    const task = manager.get(taskId)
    if (!task) throw new Error(`Unknown task: ${taskId}`)
    return response(publicTask(task))
  })

  server.registerTool("list_tasks", {
    description: "List tasks started by this workbench process.",
    inputSchema: {},
  }, async () => response({ tasks: manager.list().map(publicTask) }))

  server.registerTool("cancel_task", {
    description: "Cancel a running delegated task and its child process tree.",
    inputSchema: { taskId: z.string().uuid() },
  }, async ({ taskId }) => response({ taskId, cancelled: manager.cancel(taskId) }))

  const approvalPort = Number(process.env.ALL_CODE_APPROVAL_PORT)
  const approvalToken = process.env.ALL_CODE_APPROVAL_TOKEN
  if (Number.isInteger(approvalPort) && approvalPort > 0 && approvalToken) {
    server.registerTool("approval_prompt", {
      description: "Ask the All Code user to approve or deny a Claude Code tool call. Never approve automatically.",
      inputSchema: {
        tool_name: z.string(),
        input: z.object({}).passthrough(),
      },
    }, async ({ tool_name, input }) => {
      let approved = false
      try {
        const result = await fetch(`http://127.0.0.1:${approvalPort}/approval`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${approvalToken}` },
          body: JSON.stringify({ toolName: tool_name, input }),
          signal: AbortSignal.timeout(30 * 60 * 1000),
        })
        if (result.ok) approved = (await result.json() as { approved?: boolean }).approved === true
      } catch { /* fail closed if the user-facing broker is unavailable */ }
      return {
        content: [{ type: "text" as const, text: JSON.stringify(approved
          ? { behavior: "allow", updatedInput: input }
          : { behavior: "deny", message: "Denied by the All Code user or the approval prompt was unavailable" }) }],
      }
    })
  }

  await server.connect(new StdioServerTransport())
}
