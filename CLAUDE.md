# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

**Let Them Talk** — an MCP server + web dashboard that lets multiple AI CLI terminals (Claude Code, Gemini CLI, Codex CLI) communicate with each other. Each terminal spawns its own server process via stdio; all processes read/write to a shared `.agent-bridge/` directory on disk.

## Commands

```bash
# Install in any project (auto-detects CLI type)
npx let-them-talk init
npx let-them-talk init --all     # Configure for all CLIs
npx let-them-talk init --template team  # Init with team template

# Launch the web dashboard
npx let-them-talk dashboard

# List available agent templates
npx let-them-talk templates

# Reset conversation data
npx let-them-talk reset

# Run MCP server directly (normally launched automatically by CLI)
npm start
```

No tests, linter, or build step. Raw Node.js (CommonJS).

## Architecture

**Core files:**
- `server.js` — MCP server (17 tools, StdioServerTransport, heartbeat system)
- `dashboard.js` — HTTP server for web dashboard (multi-project, message injection, SSE real-time, tasks API)
- `dashboard.html` — Single-page frontend (markdown rendering, agent monitoring, responsive)
- `cli.js` — CLI entry point with multi-CLI auto-detection

**Multiple MCP server processes, one shared filesystem:**
- Each CLI terminal spawns its own `server.js` process
- In-memory state: `registeredName`, `lastReadOffset`, `heartbeatInterval`, `messageSeq`
- Shared disk state in `.agent-bridge/`: messages (JSONL), history (JSONL), agents (JSON), acks (JSON), tasks (JSON), per-agent consumed trackers (JSON)
- Dashboard reads the same directory for real-time monitoring via SSE

**Data directory resolution (server.js + dashboard.js):**
1. `$AGENT_BRIDGE_DATA_DIR` / `$AGENT_BRIDGE_DATA` env var
2. `{cwd}/.agent-bridge/` (project-local, default)
3. Legacy fallback: `{__dirname}/data/`

**17 MCP tools:** register, list_agents, send_message, broadcast, wait_for_reply, listen, check_messages, ack_message, get_history, get_summary, handoff, share_file, create_task, update_task, list_tasks, reset

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
- **SSE real-time** — `fs.watch()` on data dir pushes updates via Server-Sent Events
- **Auto-compact** — messages.jsonl compacted when exceeding 500 lines
- **Auto-archive** — conversations archived before reset
- **Context hints** — warns agents when conversation exceeds 50 messages
- **Task management** — structured task creation, assignment, and tracking between agents
