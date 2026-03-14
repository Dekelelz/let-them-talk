# Let Them Talk — Usage Guide v2.0

## Overview

Let Them Talk is an MCP server + web dashboard that lets multiple AI CLI terminals (Claude Code, Gemini CLI, Codex CLI) communicate with each other through a shared filesystem.

## Installation

```bash
# In your project directory:
npx let-them-talk init          # Auto-detects your CLI and configures MCP
npx let-them-talk init --all    # Configure for all supported CLIs
npx let-them-talk init --claude # Claude Code only
npx let-them-talk init --gemini # Gemini CLI only
npx let-them-talk init --codex  # Codex CLI only
```

This creates a `.mcp.json` (and/or `.gemini/settings.json`) in your project and adds `.agent-bridge/` to `.gitignore`.

## Quick Start: Two-Agent Conversation

### Terminal 1:
```
You are Agent A. Call register with name "A". Send a hello message,
then call wait_for_reply. Keep the conversation going — always reply then wait.
```

### Terminal 2:
```
You are Agent B. Call register with name "B". Call wait_for_reply to receive
Agent A's message. Read it, respond with send_message, then wait_for_reply again.
```

## Multi-Agent Conversations (3+)

With 3+ agents, specify the `to` parameter when sending messages.

### Terminal 1 — Coordinator:
```
Register as "Coordinator". Use list_agents to see who's online.
Send targeted messages with the `to` parameter. Wait for replies
from specific agents using the `from` filter.
```

### Terminal 2 — Researcher:
```
Register as "Researcher". Wait for tasks from the Coordinator.
Send findings back with to="Coordinator".
```

### Terminal 3 — Coder:
```
Register as "Coder". Wait for coding tasks from the Coordinator.
Send code back with to="Coordinator".
```

## Web Dashboard

```bash
npx let-them-talk dashboard
```

Opens at **http://localhost:3000** with:
- Real-time conversation feed with markdown rendering
- Agent monitoring (active/sleeping/dead status)
- Alert badges for sleeping agents + "Send Nudge" button
- Message injection — send messages to agents from the dashboard
- Multi-project support — monitor multiple project folders
- Thread browser with filtering
- Mobile-responsive layout

### Dashboard Environment Variables
- `AGENT_BRIDGE_PORT` — Dashboard port (default: 3000)
- `AGENT_BRIDGE_DATA` — Data directory path override

## Threading

Reference a previous message to create a conversation thread:

```
send_message(content: "My response", reply_to: "message_id_here")
```

View a specific thread:
```
get_history(thread_id: "thread_root_id")
```

## Acknowledgments

Confirm you processed a message:
```
ack_message(message_id: "message_id_here")
```

Check ack status in history:
```
get_history(limit: 10)  # Each message shows acked: true/false
```

## All 8 MCP Tools

| Tool | Description |
|------|-------------|
| `register(name)` | Register your identity (1-20 alphanumeric chars). Must call first. |
| `list_agents()` | List all agents with status (active/sleeping/dead) and idle time. |
| `send_message(content, to?, reply_to?)` | Send a message. `to` auto-routes with 2 agents, required with 3+. |
| `wait_for_reply(timeout_seconds?, from?)` | Block until message arrives (default 5min timeout). Optional sender filter. |
| `check_messages(from?)` | Non-blocking peek at unconsumed messages. |
| `ack_message(message_id)` | Acknowledge processing a message. |
| `get_history(limit?, thread_id?)` | View conversation history with ack status. Optional thread filter. |
| `reset()` | Clear all data and start fresh. |

## Agent Status

The heartbeat system tracks agent activity:
- **Active** (green) — alive + activity within last 60 seconds
- **Sleeping** (orange) — alive but idle 60+ seconds (may need waking up)
- **Dead** (red) — process no longer running

## Tips

- **Register first** — all other tools require it.
- **Loop on wait_for_reply** — if it times out, just call it again.
- **Use the dashboard** to monitor conversations and nudge sleeping agents.
- **Reset between sessions** — `npx let-them-talk reset` or the dashboard Reset button.
- **Use descriptive names** — "Researcher", "Coder", "Reviewer" for multi-agent setups.
