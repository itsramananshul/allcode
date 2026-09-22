# All Code

<p align="center">
  <img src="assets/allcode-mascot.png" alt="All Code mascot" width="220">
</p>

<p align="center"><strong>One terminal workspace. Every coding agent.</strong></p>

All Code is a local, open-source terminal workspace for **Claude Code**, **OpenCode**, and **Codex**. It gives you one stable monochrome interface, lets you switch the active execution engine with `/agent`, discovers each engine's models, carries conversation context across switches, and gives every engine an MCP broker for delegating work to the other two.

All Code does not proxy private APIs or copy credentials. Each task runs through the selected CLI, with that CLI's own authentication, subscription, model access, tools, permissions, and session state.

## What works

- One `allcode` command and one consistent interface on Windows, macOS, and Linux.
- `/agent claude`, `/agent opencode`, and `/agent codex` switch the active backend.
- `/model` and `/models` discover models from installed CLIs instead of maintaining a stale hard-coded catalog.
- Per-agent model and native session IDs persist in `.allcode/session.json`.
- Conversation turns are handed to an agent when it joins an existing workspace.
- The active agent receives MCP tools for starting, checking, listing, and cancelling tasks in the other engines.
- Delegated work is restricted to configured workspace roots and capped by a recursion limit.
- A compatibility mode can still open each product's native terminal UI with `allcode native`.

## Quick start

You need Node.js 22 or newer and at least one supported CLI installed:

- [Claude Code](https://github.com/anthropics/claude-code)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Codex](https://github.com/openai/codex)

```powershell
git clone https://github.com/itsramananshul/allcode.git
cd allcode
npm install
npm run check
npm link
allcode
```

Your existing CLI logins remain where those CLIs store them. All Code does not ask for or persist API keys.

## Inside All Code

```text
/agent              choose Claude Code, OpenCode, or Codex
/agent opencode     switch directly to OpenCode
/model              browse models for the active agent
/model MODEL_ID     select an exact native model ID
/models             list models from every installed agent
/status             show the active route and saved session
/clear              redraw the workspace
/help               show local commands
/exit               exit
```

Text and unrecognized slash commands are sent to the active backend. A provider command therefore runs only when that provider supports the same command in non-interactive mode; All Code's local commands always take precedence.

## Direct and delegated execution

Run a single task without opening the interface:

```powershell
allcode run opencode --model opencode/big-pickle "Inspect the failing tests"
allcode run codex "Review the current diff"
allcode run claude "Plan the next implementation step"
```

The same adapters power the MCP broker. When an active agent calls `start_task`, the target CLI really performs the work and returns its native result. The current agent remains responsible for integrating that result.

## Documentation

- [Getting started](docs/getting-started.md)
- [Commands](docs/commands.md)
- [Architecture](docs/architecture.md)
- [Models and routing](docs/model-routing.md)
- [Security](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)

## Project status

All Code is an early release. Routing, context handoff, model discovery, bounded process execution, and MCP delegation are implemented; automated tests cover the core modules, while release CI builds on Windows, macOS, and Linux. Direct re-export of a proprietary agent's internal tool schema is intentionally not claimed: cross-agent capabilities are exposed through delegation, while each target executes with its own native tools.

## License

[MIT](LICENSE)
