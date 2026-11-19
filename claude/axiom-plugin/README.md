# The Axiom plugin for Claude Code

One install gives Claude Code both Axiom connectors and the know-how for using them:

- **axiom-command**: Axiom Command (leads, tasks, calendar, the founders' Claudes' jobs and questions).
- **axiom-engine**: the Axiom Revenue Engine (campaigns, batches, replies, inbox health). Tools and limits: `docs/runbooks/CLAUDE_CONNECTOR.md`.
- A skill, `axiom-engine`, that says which connector to use for what, and the engine's rules.

## Install

```
claude plugin marketplace add rileyhins17/axiom-revenue-engine
claude plugin install axiom@axiom-tools
```

## Your keys

Each founder makes their own two keys, once, and keeps them out of every file:

1. Axiom Command → Settings → Claude connector → make a key.
2. Axiom Revenue Engine → More → Settings → Claude connector → make a key.
3. Put both in the environment Claude Code starts from (your shell profile, or the cloud routine's environment variables):

```
export AXIOM_COMMAND_KEY=<your Command key>
export AXIOM_ENGINE_KEY=<your engine key>
```

The plugin's `.mcp.json` only names those variables; no key is ever written in this repository. A key shows once when it is made; if you lose it, make a new one (the old one stops working at once). Anyone holding your engine key can read the engine's data and pause a campaign, so treat it like a password.

## Check it works

Start Claude Code and run `/mcp`: both servers should show as connected. A warning about a missing variable means that key isn't in the environment. Then ask: "What needs me on the engine today?"

claude.ai (the website and phone app) doesn't use this plugin: there, each founder adds the engine's link address under Settings → Connectors → Add custom connector (the engine's Settings screen shows the link).
