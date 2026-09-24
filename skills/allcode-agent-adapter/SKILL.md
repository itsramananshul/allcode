---
name: allcode-agent-adapter
description: Add an already-installed coding agent to All Code by inspecting its CLI and writing a local adapter plugin.
---

# Add an All Code agent

The user supplies an installed agent CLI. Inspect its actual `--help`, documentation, and machine-readable interfaces before writing an adapter. Do not install or update that CLI, change its authentication, or modify All Code's built-in agents. Work only in the draft directory given in the request.

Prefer an official streaming/session protocol when available. Expose only capabilities the CLI really supports: model discovery, reasoning effort, permission modes and approve/deny prompts, native session continuation, and cancellation. The v1 adapter API returns a final answer and event count; it does not render a live tool-event stream. If a capability is unavailable, omit that optional API and tell the user. Do not silently simulate approval or bypass restrictions. A one-shot CLI can still be adapted, but a process restarted per turn does not automatically gain native sessions or in-process approvals.

Create `adapter.json` and `agent.mjs` in the draft directory. `adapter.json` has `apiVersion: 1`, a lowercase slug `name`, display `label`, an absolute `command` path to the installed executable, `args` and `models` string arrays, and `limitations`: a string array naming unsupported or unverified capabilities. It may include absolute `skillsDirs` for that agent's global skill folders. Do not claim a skill folder without checking the agent's documentation.

`agent.mjs` exports a default object with `apiVersion: 1`, the same `name`, and `async run(request, context)`. Return `{ finalText, sessionId?, eventCount?, stdout?, stderr?, exitCode? }`. `request` has `{ agent, prompt, cwd, model?, sessionId?, timeoutMs?, effort?, permissionMode? }`. `context` has `{ executable, args, signal, approve, mcp }`. `approve({ toolName, input })` returns a boolean. `mcp` has `{ command, args, env }` for All Code's delegation server. Optional methods: `listModels(context)`, returning `{ id, label?, description?, efforts? }[]`; `listEfforts(model, context)`, returning string IDs; `listModes(context)`, returning `{ id, label, description? }[]`. Pass any selected model, effort, and permission mode only using flags or protocol fields the target CLI actually supports. Respect `cwd`, cancellation, and process exit codes. Do not print secrets or persist tokens in the adapter.

Keep imports inside the draft folder or use Node built-ins. Test a harmless prompt, model listing, session continuation and approval denial where the CLI supports them. Report precisely which features were verified and which were not. Do not register the plugin automatically: the user must inspect the draft and confirm installation with `allcode add agent <draft-directory>`.
