# Architecture

All Code is a terminal interface over three CLI adapters.

```text
┌─────────────────────────────────────────────┐
│                 All Code                    │
│  prompt loop · slash commands · session     │
└─────────────────────┬───────────────────────┘
                      │ active route
          ┌───────────┼───────────┐
          ▼           ▼           ▼
    Claude Code    OpenCode     Codex
       adapter      adapter     adapter
          └───────────┼───────────┘
                      │
                      ▼
              All Code MCP server
                 delegated tasks
```

## Prompt loop

`src/allcode.ts` owns the terminal. It handles All Code slash commands locally and sends other input through `runAgent`.

## Adapters

`src/adapters.ts` builds a non-interactive invocation for each CLI:

- Claude Code uses print mode with JSON output.
- OpenCode uses `opencode run --format json`.
- Codex uses `codex exec --json` with the `workspace-write` sandbox.

`src/parsers.ts` extracts final text and native session IDs from each event stream.

## Sessions

`src/session.ts` stores workspace state in `.allcode/session.json`:

- active agent
- selected model per agent
- native session ID per agent
- shared messages
- delivery cursor per agent

Writes use a temporary file followed by an atomic rename.

## Models

`src/models.ts` reads native catalogs. Catalog requests run independently, so a missing agent does not block results from the others. Codex app-server discovery has a 12-second timeout.

## Delegated tasks

`src/mcp-server.ts` exposes task tools. `src/task-manager.ts` runs delegated work asynchronously and records its state as queued, running, completed, failed, or cancelled.

Every child adapter receives the MCP server configuration. This lets an agent send a bounded subtask through another adapter.

## Processes

`src/process-runner.ts` starts executables directly, captures bounded output, handles cancellation, and terminates the child process tree on timeout. Commands are passed as argument arrays rather than shell strings.

## Adding an agent

1. Add the route name to `src/types.ts`.
2. Implement `AgentAdapter` in `src/adapters.ts`.
3. Add native model discovery in `src/models.ts`.
4. Add event parsing and invocation tests.
5. Add the route to the picker and command reference.
