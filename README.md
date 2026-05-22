# agentforge-mcp

**Stop re-explaining what you want.** An MCP server that turns a rough,
one-line coding request into a structured, tool-tuned prompt — so your AI
coding agent gets it right the first time.

It's a thin client for [AgentForge](https://agentforge.sciscale.org): it
forwards your request to the hosted engine, which extracts the real
requirements, catches the edge cases you didn't mention, formats the prompt
for your specific agent, and quality-checks it before handing it back.

No engine logic runs locally — this package is a ~150-line forwarder. The work
happens server-side, so it stays current without you updating anything.

## Setup

### 1. Get an API key

Sign in at [agentforge.sciscale.org](https://agentforge.sciscale.org), open
**API keys**, and create one. Free accounts get 3 refinements/day; Pro is
unlimited. The key is shown once — copy it.

### 2. Add the server to your coding agent

The server runs via `npx` — nothing to install or build.

**Claude Code:**

```sh
claude mcp add agentforge --env AGENTFORGE_API_KEY=af_your_key_here -- npx -y agentforge-mcp
```

**Cursor / Windsurf / Claude Desktop** — add to your MCP config
(`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, etc.):

```json
{
  "mcpServers": {
    "agentforge": {
      "command": "npx",
      "args": ["-y", "agentforge-mcp"],
      "env": { "AGENTFORGE_API_KEY": "af_your_key_here" }
    }
  }
}
```

## The tool

### `agentforge_refine_prompt`

Turns a plain-language request into a refined prompt.

| Argument | Type | Default | Notes |
|---|---|---|---|
| `request` | string | — | The coding task, in plain language (1–4000 chars). Rough is fine. |
| `target_tool` | string | `claude-code` | `claude-code`, `codex`, `cursor`, `aider`, `continue`, `windsurf`, `kimi`, `generic` |
| `style` | string | `plan-first` | `plan-first`, `direct-edit`, `explore-first` |

Returns the refined prompt as text. The structured result also includes the
account `tier`, the Quality Engine `quality` score, and today's `usage`.

Once configured, just ask your agent — e.g. *"refine this with AgentForge: add
a dark mode toggle that persists, then implement it."*

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENTFORGE_API_KEY` | — | **Required.** Your API key. |
| `AGENTFORGE_API_URL` | `https://agentforge.sciscale.org/api/v1/refine` | Override the endpoint (rarely needed). |

## Develop

```sh
npm install
npm run build      # tsc -> dist/
node dist/index.js # runs on stdio
```

## License

MIT — see [LICENSE](./LICENSE). A project of [sciscale studio](https://wow.sciscale.org).
