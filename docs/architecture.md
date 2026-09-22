# Architecture

All Code separates the stable user interface from the engines that perform work.

```text
                         ┌──────────────────────┐
                         │  All Code terminal   │
                         │  commands + context  │
                         └──────────┬───────────┘
                                    │ selected route
                 ┌──────────────────┼──────────────────┐
                 ▼                  ▼                  ▼
          ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
          │ Claude Code │    │  OpenCode   │    │    Codex    │
          │   adapter   │    │   adapter   │    │   adapter   │
          └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
                 └──────────────────┼──────────────────┘
                                    ▼
                         ┌──────────────────────┐
                         │ All Code MCP broker  │
                         │ bounded delegation   │
                         └──────────────────────┘
```

## Components

- `src/all-code.ts` owns the interface and local slash commands.
- `src/session.ts` persists the active route, models, native session IDs, delivery cursors, and shared messages.
- `src/adapters.ts` converts a neutral task into each CLI's supported non-interactive invocation.
- `src/models.ts` discovers live provider catalogs and parses their native results.
- `src/mcp-server.ts` exposes cross-agent task tools.
- `src/task-manager.ts` tracks delegated work and cancellation.
- `src/security.ts` constrains delegated working directories.

## Context handoff

Every successful or failed turn is stored in `.all-code/session.json`. Each agent has a delivery cursor. When an agent becomes active, it receives only the conversation it has not seen, followed by the current request. This keeps switches useful without resending the entire transcript on every turn.

The 48,000-character handoff bound is a transport guard, not a model token count. Each native agent still controls its own context compaction and limits.

## Delegation

Each headless adapter injects the All Code MCP broker into the target process. The selected agent can call:

- `list_agents`
- `start_task`
- `task_status`
- `list_tasks`
- `cancel_task`

The target agent runs with its own native tools. The broker returns its result to the caller; it does not pretend that one vendor's private tools belong to another vendor.

## Adding an agent

Implement `AgentAdapter`, register it in `src/adapters.ts`, add its name to `src/types.ts`, provide model discovery, and add invocation/parser tests. Keep authentication and permission decisions inside the native CLI rather than inventing an All Code credential format.
