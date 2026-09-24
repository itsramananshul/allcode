# Architecture

All Code is a terminal interface over four installed coding agents.

```text
┌─────────────────────────────────────────────┐
│                 All Code                    │
│  prompt loop · slash commands · session     │
└─────────────────────┬───────────────────────┘
                      │ active route
      ┌───────────┬───┴───────┬───────────┐
      ▼           ▼           ▼           ▼
 Claude Code   OpenCode     Codex       Hermes
   adapter      adapter     adapter       ACP
      └───────────┴───────┬───┴───────────┘
                      │
                      ▼
              All Code MCP server
                 delegated tasks
```

## Prompt loop

`src/allcode.ts` owns the terminal. It handles All Code slash commands locally, stores model/effort/permission selections per agent, and sends other input through `runAgent`. `src/workspace-screen.ts` draws the fixed input, searchable pickers, and approval review pane.

## Adapters

`src/adapters.ts` builds a non-interactive invocation for each CLI:

- Claude Code uses print mode with JSON output.
- OpenCode uses `opencode run --format json`.
- Codex uses `codex exec --json` with the `workspace-write` sandbox.
- Hermes uses `hermes acp` over JSON-RPC, preserving an ACP session across interactive turns.

`src/parsers.ts` extracts final text and native session IDs from each event stream.

The interactive Claude route keeps a print-mode `stream-json` process in `src/claude-stream-runner.ts`. It prestarts when Claude becomes active, accepts subsequent turns over the same stdin stream, and restarts with `--resume` when Claude's model, effort, or permission mode changes. The one-shot and delegated routes still use a separate process for each task.

Interactive approvals use a separate path when the chosen permission mode needs one: Claude Code connects to the local approval broker, OpenCode uses a local server session, Codex uses its app-server protocol, and Hermes sends ACP `session/request_permission` requests. The resulting requests go through the same All Code approval pane. Headless `allcode run` and delegated Hermes tasks deny ACP requests when no approval handler is available.

## Sessions

`src/session.ts` stores workspace state in `.allcode/session.json`:

- active agent
- selected model per agent
- selected effort and permission mode per agent
- native session ID per agent
- shared messages
- delivery cursor per agent

Writes use a temporary file followed by an atomic rename.

## Models

`src/models.ts` reads native catalogs. Catalog requests run independently, so a missing agent does not block results from the others. Codex app-server discovery has a 12-second timeout. Hermes discovery opens an ACP session and reads its advertised models.

## Delegated tasks

`src/mcp-server.ts` exposes task tools. `src/task-manager.ts` runs delegated work asynchronously and records its state as queued, running, completed, failed, or cancelled.

Every child adapter receives the MCP server configuration. This lets an agent send a bounded subtask through another adapter.

## Processes

`src/process-runner.ts` starts executables directly, captures bounded output, handles cancellation, and terminates the child process tree on timeout. Commands are passed as argument arrays rather than shell strings.

## Adding an agent

Built-in adapters live in `src/adapters.ts`. `/add agent` stores registrations in `~/.allcode/agents.json`; `src/agent-registry.ts` lists them alongside built-in routes. ACP registrations use the ACP runner for model catalogs, sessions, and approval requests. One-shot registrations use direct process spawning, stdin or a `{prompt}` argument, and plain-text stdout. Custom adapters are copied to `~/.allcode/adapters/<name>` and implement the v1 plugin API (`run`, with optional model, effort, and permission-mode catalogs). They can call All Code's approval handler and MCP server. All routes receive shared conversation through the session handoff layer. Custom adapter code is outside the package and survives package updates, though the v1 API must remain compatible.

`src/skill-installer.ts` reads local or GitHub-hosted `SKILL.md` folders, shows target paths, and copies only after confirmation. Codex and OpenCode share the `.agents/skills` destination; Claude Code and Hermes have separate destinations. A custom agent may add its own declared skill directories.
