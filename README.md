# Let Them Talk

[![npm version](https://img.shields.io/npm/v/let-them-talk.svg)](https://www.npmjs.com/package/let-them-talk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**MCP server + web dashboard that lets AI CLI agents talk to each other.**

Open two (or more) Claude Code, Gemini CLI, or Codex CLI terminals — and let them collaborate, debate, review code, or divide tasks. Watch the conversation unfold in a real-time web dashboard with a kanban board, agent monitoring, and message injection.

## Quick Start

```bash
# 1. Install in any project
npx let-them-talk init

# 2. Launch the web dashboard
npx let-them-talk dashboard

# 3. In Terminal 1: tell the agent to register as "A", say hello, then call listen()
# 4. In Terminal 2: tell the agent to register as "B", then call listen()
```

Or use a template for guided setup:

```bash
npx let-them-talk init --template team    # Coordinator + Researcher + Coder
npx let-them-talk init --template review  # Author + Reviewer
npx let-them-talk init --template debate  # Pro + Con
npx let-them-talk templates               # List all templates
```

## How It Works

```
Terminal 1 (Claude Code)          Terminal 2 (Gemini CLI)          Terminal 3 (Codex CLI)
        |                                 |                                |
        v                                 v                                v
   MCP Server                        MCP Server                      MCP Server
   (stdio process)                   (stdio process)                 (stdio process)
        |                                 |                                |
        +------------- Shared Filesystem (.agent-bridge/) ----------------+
                       |  messages.jsonl  |  history.jsonl  |
                       |  agents.json     |  tasks.json     |
                                    |
                                    v
                        Web Dashboard (localhost:3000)
                        Real-time SSE + Agent monitoring
                        Kanban board + Message injection
```

Each CLI terminal spawns its own MCP server process via stdio. All processes read/write to a shared `.agent-bridge/` directory. The dashboard monitors the same files via Server-Sent Events for real-time updates.

## Features

### 17 MCP Tools

| Tool | Description |
|------|-------------|
| `register` | Set agent identity (any name) |
| `list_agents` | Show all agents with status |
| `send_message` | Send to specific agent (auto-routes with 2) |
| `broadcast` | Send to all agents at once |
| `wait_for_reply` | Block until message arrives (5min timeout) |
| `listen` | Block indefinitely — never times out |
| `check_messages` | Non-blocking peek at inbox |
| `ack_message` | Confirm message was processed |
| `get_history` | View conversation with thread filter |
| `get_summary` | Condensed conversation recap |
| `handoff` | Transfer work to another agent with context |
| `share_file` | Send file contents to another agent |
| `create_task` | Create and assign tasks |
| `update_task` | Update task status (pending/in_progress/done/blocked) |
| `list_tasks` | View tasks with filters |
| `reset` | Clear data (auto-archives first) |

### Web Dashboard

- **Real-time feed** — SSE-powered, ~200ms latency, full markdown rendering
- **Agent monitoring** — active/sleeping/dead/listening status with idle times
- **Kanban board** — task management with drag-free status updates
- **Message injection** — send messages to agents from the browser
- **Bookmarks** — star important messages, filter by bookmarks
- **Search** — filter by content, sender, or recipient
- **Sound notifications** — optional audio alert for new messages
- **Export** — shareable HTML or Markdown download
- **Multi-project** — monitor multiple project folders + auto-discover
- **Mobile responsive** — works on phones and tablets

### Reliability

- **Heartbeat** — 10s pings track agent liveness
- **Auto-compact** — message queue cleaned when > 500 lines
- **Auto-archive** — conversations saved before reset
- **Context hints** — warns agents when conversation gets long
- **Dead recipient warnings** — alerts when sending to offline agents
- **Clean exit** — agents deregister on process exit

## Agent Templates

Pre-built team configurations with ready-to-paste prompts:

| Template | Agents | Best For |
|----------|--------|----------|
| `pair` | A, B | Simple conversations, brainstorming |
| `team` | Coordinator, Researcher, Coder | Complex features, research + implementation |
| `review` | Author, Reviewer | Code review with structured feedback |
| `debate` | Pro, Con | Evaluating trade-offs and decisions |

## CLI Commands

```bash
npx let-them-talk init                    # Auto-detect CLI and configure
npx let-them-talk init --all              # Configure for all CLIs
npx let-them-talk init --template <name>  # Use a team template
npx let-them-talk templates               # List available templates
npx let-them-talk dashboard               # Launch web dashboard
npx let-them-talk reset                   # Clear conversation data
npx let-them-talk help                    # Show help
```

## Supported CLIs

| CLI | Config | Auto-detected |
|-----|--------|---------------|
| Claude Code | `.mcp.json` | Yes |
| Gemini CLI | `.gemini/settings.json` | Yes |
| Codex CLI | `.mcp.json` | Yes |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_BRIDGE_DATA_DIR` | `{cwd}/.agent-bridge/` | Data directory path |
| `AGENT_BRIDGE_PORT` | `3000` | Dashboard port |
| `NODE_ENV` | — | Set to `development` for hot-reload |

## License

MIT
