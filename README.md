<p align="center">
  <img src="assets/allcode-mascot.png" alt="All Code" width="220">
</p>

<h1 align="center">All Code</h1>

<p align="center">Claude Code, OpenCode, and Codex in one terminal.</p>

<p align="center">
  <a href="https://github.com/itsramananshul/allcode/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/itsramananshul/allcode/ci.yml?branch=main&style=flat-square&label=build" alt="Build status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-white?style=flat-square" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22-lightgrey?style=flat-square" alt="Node.js 22 or newer">
</p>

All Code keeps one conversation while you move between coding agents. Start a task in OpenCode, switch to Claude Code, send a review to Codex, and continue without rebuilding the context by hand.

Each agent runs through its installed CLI. The models, account, tools, configuration, and permissions attached to that CLI stay available.

## Install

All Code requires Node.js 22 or newer and at least one supported agent:

- [Claude Code](https://github.com/anthropics/claude-code)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Codex](https://github.com/openai/codex)

```bash
git clone https://github.com/itsramananshul/allcode.git
cd allcode
npm install
npm link
```

Run it from a project directory:

```bash
cd path/to/project
allcode
```

## Use

Type a request as usual. All Code sends it to the active agent.

```text
› find the cause of the failing authentication test
```

Type `/` to open the command palette above the input. The list filters as you type; use the arrow keys to browse, Enter to run the highlighted command, Tab to complete it in the input, and Escape to close it. The input stays at the bottom of the screen while you work.

![All Code command palette](docs/images/command-palette.svg)

Change agents without leaving the session:

```text
› /agent codex
› review the current diff

› /agent claude
› apply the review and run the tests
```

Choose a model from the active agent:

```text
› /model
› /model opencode/big-pickle
```

The agent and model pickers are searchable and keyboard-driven. `/model` browses the active agent's models; `/models` browses all discovered models and switches agents when you select one. Use the arrow keys and Enter—you do not need to type a model ID.

`/effort` lists the reasoning levels advertised by the selected model. `/mode` opens that agent's permission modes. Claude Code, OpenCode Ask mode, and Codex's interactive modes pause for approval when the provider requests it; All Code shows the proposed action and lets you allow it once or deny it. The default choice is Deny. Use the arrow keys or Page Up/Down to inspect a long request, Tab to switch the choice, and Enter to confirm. `/status` shows the current effort and mode.

While an agent runs, a rotating status word shows the elapsed time. In Windows Terminal, the header displays the full All Code mascot image.

![All Code working state](docs/images/working-state.svg)

List models from OpenCode and Codex alongside All Code's Claude aliases:

```bash
allcode models
```

All Code remembers the selected agent, one model per agent, native session IDs, and the shared conversation in `.allcode/session.json`.

## Agents

| Agent | Route | Model source |
| --- | --- | --- |
| Claude Code | `claude` | Claude account aliases and model IDs |
| OpenCode | `opencode` | `opencode models`, including configured providers and the OpenCode Go catalog |
| Codex | `codex` | Codex app-server model catalog |

Check the local installation:

```bash
allcode agents
```

All Code also gives the active agent an MCP broker. It can delegate a task to either of the other agents, wait for the result, and incorporate that result into the current job.

## Commands

| Command | Action |
| --- | --- |
| `/agent` | Open the agent picker |
| `/agent <name>` | Switch to Claude Code, OpenCode, or Codex |
| `/model` | Open the model picker for the active agent |
| `/model <id>` | Select an exact model ID |
| `/models` | Browse and select a model from any agent |
| `/effort` | Choose reasoning effort for the active model |
| `/mode` | Choose the active agent's permission mode |
| `/status` | Show the current route and session |
| `/clear` | Clear the workspace transcript |
| `/help` | Show commands |
| `/exit` | Exit All Code |

Shell commands and configuration are covered in the [command reference](docs/commands.md).

## Documentation

- [Getting started](docs/getting-started.md)
- [Command reference](docs/commands.md)
- [Agents and models](docs/agents-and-models.md)
- [Architecture](docs/architecture.md)
- [Security](docs/security.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contributing](CONTRIBUTING.md)

## Development

```bash
npm install
npm run check
```

The test matrix runs on Windows, macOS, and Linux with Node.js 22 and 24.

## License

[MIT](LICENSE)
