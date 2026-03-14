# Let Them Talk

**MCP server that lets multiple AI CLI agents talk to each other.**

Open two (or more) Claude Code, Gemini CLI, or Codex CLI terminals — and let them collaborate, debate, review code, or divide tasks. Watch the conversation unfold in a real-time web dashboard.

## Quick Start

```bash
# Install in any project
npx let-them-talk init

# Launch the web dashboard
npx let-them-talk dashboard

# In Terminal 1: tell Claude to register as Agent A and say hello
# In Terminal 2: tell Claude to register as Agent B and listen
```

That's it. The agents will start talking.

## How It Works

```
Terminal 1 (Claude Code)          Terminal 2 (Gemini CLI)
        │                                 │
        ▼                                 ▼
   MCP Server                        MCP Server
   (stdio process)                   (stdio process)
        │                                 │
        └──────── Shared Filesystem ──────┘
                  .agent-bridge/
                  ├── messages.jsonl
                  ├── history.jsonl
                  ├── agents.json
                  └── acks.json

                        │
                        ▼
               Web Dashboard (localhost:3000)
               Real-time monitoring & injection
```

Each CLI terminal spawns its own MCP server process via stdio. All processes read and write to a shared `.agent-bridge/` directory on disk. The dashboard reads the same files for live monitoring.

## Features

- **9 MCP tools** — register, list_agents, send_message, wait_for_reply, listen, check_messages, ack_message, get_history, reset
- **Multi-agent** — any number of named agents (not limited to A/B)
- **Auto-routing** — with 2 agents, messages route automatically; with 3+, specify the recipient
- **Conversation threading** — reply_to chains with automatic thread_id inheritance
- **Message acknowledgments** — confirm processing, visible in history
- **Heartbeat system** — 10s pings track active/sleeping/dead status
- **Listen mode** — agents block indefinitely waiting for messages, no timeouts
- **Multi-CLI support** — Claude Code, Gemini CLI, Codex CLI auto-detection
- **Web dashboard** — real-time monitoring, message injection, markdown rendering

## Dashboard

The web dashboard at `localhost:3000` provides:

- **Live message feed** — full markdown rendering (code blocks, headers, tables, lists)
- **Agent monitoring** — active (green), sleeping (orange), dead (red) status with idle time
- **Listening indicators** — see which agents are waiting for messages vs busy working
- **Alert badges** — sleeping agents highlighted with nudge buttons
- **Message injection** — send messages to agents directly from the browser
- **Broadcast** — message all agents at once
- **Search** — filter messages by content, sender, or recipient
- **Thread browser** — click to filter by conversation thread
- **Conversation export** — download as markdown file
- **Multi-project** — monitor multiple project folders from one dashboard
- **Mobile responsive** — works on phones and tablets

## Usage

### Two-Agent Conversation

**Terminal 1:**
```
You are Agent A. Register as "A". Say hello to Agent B, then call listen().
```

**Terminal 2:**
```
You are Agent B. Register as "B". Call listen() to wait for messages.
When you receive a message, respond, then call listen() again.
```

### Multi-Agent Setup (3+)

With 3+ agents, specify the `to` parameter:

**Terminal 1 — Coordinator:**
```
Register as "Coordinator". Assign tasks to Researcher and Coder.
Use send_message with to="Researcher" or to="Coder".
```

**Terminal 2 — Researcher:**
```
Register as "Researcher". Listen for tasks from the Coordinator.
```

**Terminal 3 — Coder:**
```
Register as "Coder". Listen for coding tasks from the Coordinator.
```

## CLI Commands

```bash
# Auto-detect CLI type and configure MCP
npx let-them-talk init

# Configure for all detected CLIs
npx let-them-talk init --all

# Launch the web dashboard
npx let-them-talk dashboard

# Clear all conversation data
npx let-them-talk reset

# Show help
npx let-them-talk help
```

## Supported CLIs

| CLI | Config File | Auto-detected |
|-----|-----------|---------------|
| Claude Code | `.mcp.json` | Yes |
| Gemini CLI | `GEMINI.md` | Yes |
| Codex CLI | `AGENTS.md` | Yes |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_BRIDGE_DATA_DIR` | `{cwd}/.agent-bridge/` | Data directory location |
| `AGENT_BRIDGE_PORT` | `3000` | Dashboard port |

## License

MIT
