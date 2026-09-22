# Agent Workbench

Agent Workbench is a local, provider-neutral bridge between **Claude Code**, **OpenCode**, and **Codex**.

It does not impersonate one client as another and does not copy credentials between products. Each delegated task genuinely runs in the selected agent, using that agent's own account, subscriptions, model catalog, tools, permissions, and session state.

## Architecture

```text
              ┌─────────────────────────────┐
              │ The agent the user opened   │
              │ Claude / OpenCode / Codex   │
              └──────────────┬──────────────┘
                             │ MCP tool call
                             ▼
              ┌─────────────────────────────┐
              │ Agent Workbench broker      │
              │ tasks, limits, routing      │
              └───────┬─────────┬───────────┘
                      │         │
          ┌───────────▼──┐  ┌──▼──────────┐  ┌───────────────┐
          │ Claude CLI   │  │ OpenCode CLI│  │ Codex CLI     │
          │ Claude auth  │  │ Go/providers│  │ Codex auth    │
          └──────────────┘  └─────────────┘  └───────────────┘
```

Example: when Claude calls `start_task` with `agent: "opencode"`, OpenCode—not Claude—selects and runs the requested OpenCode model. Claude remains the lead agent and receives the task result.

## Current MVP

- One launcher that opens the selected agent's real native TUI
- `/agent` picker plus `/agent claude`, `/agent opencode`, and `/agent codex`
- Selecting an agent changes both the main engine and the complete terminal experience
- Native slash commands pass directly to the selected CLI
- Native adapters for Claude Code, OpenCode, and Codex
- Async MCP tools: `list_agents`, `start_task`, `task_status`, `list_tasks`, `cancel_task`
- Target-engine session continuation through `sessionId`
- Optional native target model selection
- Workspace allowlist and maximum delegation depth
- No automatic permission bypasses
- Safe subprocess invocation without a command shell

## Build

```powershell
npm install
npm run check
node dist/cli.js agents
```

Open the native workspace with Claude as the initial main agent:

```powershell
node dist/cli.js workspace --agent claude --cwd C:\path\to\project
```

Inside the native interface, type `/agent` to select a different main agent. The launcher clears the current input, replaces the active native CLI, and keeps the same working directory. Returning to an agent asks its CLI to continue the most recent session in that workspace. All non-`/agent` input—including every native slash command—is passed to the selected CLI unchanged.

## Direct CLI usage

```powershell
node dist/cli.js run opencode --cwd C:\path\to\project --model opencode/big-pickle "Inspect the failing tests and fix them"
node dist/cli.js run codex --cwd C:\path\to\project "Review the OpenCode changes"
node dist/cli.js run claude --cwd C:\path\to\project "Plan the next implementation step"
```

## Add the bridge to Claude Code

Add a project `.mcp.json`:

```json
{
  "mcpServers": {
    "agent-workbench": {
      "type": "stdio",
      "command": "node",
      "args": ["C:/absolute/path/to/agent-workbench/dist/cli.js", "mcp"],
      "env": {
        "AGENT_WORKBENCH_HOST": "claude",
        "AGENT_WORKBENCH_ALLOWED_ROOTS": "C:/absolute/path/to/your/project"
      }
    }
  }
}
```

Claude can then call `start_task` to delegate to OpenCode or Codex and poll `task_status` for the result.

## Add the bridge to OpenCode

Merge this into the project's `opencode.jsonc`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "agent-workbench": {
      "type": "local",
      "command": ["node", "C:/absolute/path/to/agent-workbench/dist/cli.js", "mcp"],
      "enabled": true,
      "environment": {
        "AGENT_WORKBENCH_HOST": "opencode",
        "AGENT_WORKBENCH_ALLOWED_ROOTS": "C:/absolute/path/to/your/project"
      }
    }
  }
}
```

## Add the bridge to Codex

Project-scoped `.codex/config.toml`:

```toml
[mcp_servers.agent-workbench]
command = "node"
args = ["C:/absolute/path/to/agent-workbench/dist/cli.js", "mcp"]

[mcp_servers.agent-workbench.env]
AGENT_WORKBENCH_HOST = "codex"
AGENT_WORKBENCH_ALLOWED_ROOTS = "C:/absolute/path/to/your/project"
```

## Security model

- The MCP bridge permits work only beneath `AGENT_WORKBENCH_ALLOWED_ROOTS`.
- Delegation depth defaults to three, preventing accidental Claude → OpenCode → Codex → Claude loops.
- Codex runs with `workspace-write`; Claude does not bypass permission checks; OpenCode retains its configured permissions.
- Prompts are passed as subprocess arguments/stdin, never interpolated into shell commands.
- Credentials stay in their original CLI stores and are never returned by the bridge.

## Upstream references

The `upstream/` directory contains shallow reference clones and is deliberately gitignored:

- <https://github.com/anomalyco/opencode> (MIT)
- <https://github.com/openai/codex> (Apache-2.0)
- <https://github.com/anthropics/claude-code> (public distribution/support repository; not the full engine source)

## Next milestones

1. Stream task events instead of polling.
2. Add managed git worktrees for safe parallel edits.
3. Persist exact per-agent session IDs instead of relying on each CLI's “most recent” lookup.
4. Add capability discovery and model catalogs through each engine's native API.
5. Add review/handoff workflows and durable task persistence.

The project is intentionally source-only for now. Choose and add an open-source license before publishing.
