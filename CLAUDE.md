# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Let Them Talk** — an MCP server + web dashboard that lets multiple AI CLI terminals (Claude Code, Gemini CLI, Codex CLI) communicate with each other. Each terminal spawns its own server process via stdio; all processes read/write to a shared `.agent-bridge/` directory on disk.

## Commands

```bash
# Install in any project (auto-detects CLI type)
npx let-them-talk init
npx let-them-talk init --all     # Configure for all CLIs

# Launch the web dashboard
npx let-them-talk dashboard

# Reset conversation data
npx let-them-talk reset

# Run MCP server directly (normally launched automatically by CLI)
npm start
```

No tests, linter, or build step. Raw Node.js (CommonJS).

## Architecture

**Core files:**
- `server.js` — MCP server (8 tools, StdioServerTransport, heartbeat system)
- `dashboard.js` — HTTP server for web dashboard (multi-project, message injection)
- `dashboard.html` — Single-page frontend (markdown rendering, agent monitoring, responsive)
- `cli.js` — CLI entry point with multi-CLI auto-detection

**Multiple MCP server processes, one shared filesystem:**
- Each CLI terminal spawns its own `server.js` process
- In-memory state: `registeredName`, `lastReadOffset`, `heartbeatInterval`
- Shared disk state in `.agent-bridge/`: messages (JSONL), history (JSONL), agents (JSON), acks (JSON), per-agent consumed trackers (JSON)
- Dashboard reads the same directory for real-time monitoring

**Data directory resolution (server.js + dashboard.js):**
1. `$AGENT_BRIDGE_DATA_DIR` / `$AGENT_BRIDGE_DATA` env var
2. `{cwd}/.agent-bridge/` (project-local, default)
3. Legacy fallback: `{__dirname}/data/`

**8 MCP tools:** `register`, `list_agents`, `send_message`, `wait_for_reply`, `check_messages`, `ack_message`, `get_history`, `reset`

## Key Design Decisions

- **Append-only writes** for messages/history (no file locking)
- **Per-agent consumed tracking** — each agent writes only its own consumed file
- **PID-based stale detection** + process exit cleanup for instant status
- **Heartbeat** — 10s interval updates `last_activity`, `.unref()` prevents zombie processes
- **Flexible agent names** — any alphanumeric (1-20 chars), validated by `sanitizeName()`
- **Auto-routing** — `to` optional with 2 agents, required with 3+
- **Threading** — `reply_to` auto-computes `thread_id`
- **Acknowledgments** — `ack_message` in `acks.json`, shown in history
- **Multi-CLI** — init auto-detects Claude Code, Gemini CLI, Codex CLI
- **Multi-project dashboard** — monitor multiple project folders from one dashboard
