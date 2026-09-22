# Models and routing

All Code keeps agent selection and model selection related but distinct:

- `/agent` chooses which CLI executes the next request.
- `/model` chooses a model ID understood by that CLI.

A model ID is never translated into a different provider's ID. For example, `opencode/big-pickle` is passed only to OpenCode. The account or free-tier rules enforced by OpenCode still apply.

## Discovery

OpenCode models come from `opencode models`. Codex models come from the Codex app-server `model/list` method. Claude Code currently exposes stable account aliases (`default`, `opus`, `sonnet`, `haiku`, and `fable`) because its CLI does not expose the same catalog command.

Catalog discovery has a timeout and degrades to an error for one backend without blocking the others. A model is marked `free` only when its native ID explicitly identifies a free route or is the known `opencode/big-pickle` route.

## Saved selection

All Code stores one model ID per agent. Switching away and back restores that selection. Choosing an out-of-range list number leaves the current selection unchanged. You may enter an exact provider model ID that is not listed, but the native CLI is the final authority on whether it exists and is available to your account.

## Rate limits and availability

All Code cannot bypass a provider's quota, regional availability, authentication requirement, or client restriction. A `429` remains a rate-limit response, and a provider-only free model remains restricted to the provider's supported client. Switch to another available route or wait for the provider limit to reset.
