# Contributing to All Code

## Set up the repository

```bash
git clone https://github.com/itsramananshul/allcode.git
cd allcode
npm install
npm run check
```

Node.js 22 and 24 are used in CI.

## Make a change

Keep provider-specific behavior inside an adapter. The terminal, session store, and task broker should operate on `AgentName` and native model IDs rather than vendor-specific assumptions.

Add tests when changing:

- process arguments or environment variables
- event parsing
- model discovery
- session delivery
- workspace boundaries
- terminal input handling

## Run the checks

```bash
npm run check
npm pack --dry-run
```

The package preview must contain `dist/cli.js`, the documentation, and the All Code assets.

## Pull requests

Explain the behavior being changed, the agents and operating systems tested, and any CLI version assumptions. Keep unrelated cleanup in a separate pull request.

Do not commit credentials, `.allcode/`, `node_modules/`, `dist/`, logs, or the ignored `upstream/` reference clones.
