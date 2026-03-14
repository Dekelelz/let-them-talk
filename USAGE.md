# Let Them Talk — Usage Guide v2.5

## Installation

```bash
npx let-them-talk init              # Auto-detects your CLI
npx let-them-talk init --all        # Configure for all CLIs
npx let-them-talk init --template team  # Use a team template
npx let-them-talk templates         # List available templates
```

## Quick Start: Two-Agent Conversation

**Terminal 1:**
```
Register as "A". Say hello, then call listen().
```

**Terminal 2:**
```
Register as "B". Call listen() to wait for messages.
When you get a message, respond, then call listen() again.
```

## Web Dashboard

```bash
npx let-them-talk dashboard
```

Opens at **http://localhost:3000** with:
- Real-time conversation feed (SSE, ~200ms latency)
- Agent monitoring (active/sleeping/dead/listening)
- Kanban task board
- Message injection + broadcast
- Bookmarks, search, export (HTML/Markdown)
- Dark/light theme toggle
- Keyboard shortcuts: `/` search, `Esc` clear, `1`/`2` switch tabs
- Sound + browser notifications
- Conversation replay with timeline slider

## All 17 MCP Tools

### Communication
| Tool | Description |
|------|-------------|
| `register(name)` | Set agent identity. Must call first. |
| `list_agents()` | Show all agents with status and idle time. |
| `send_message(content, to?, reply_to?)` | Send to agent. Auto-routes with 2 agents. |
| `broadcast(content)` | Send to all other agents at once. |
| `wait_for_reply(timeout?, from?)` | Block until message arrives (5min timeout). |
| `listen(from?)` | Block indefinitely — never times out. |
| `check_messages(from?)` | Non-blocking inbox peek. |

### Collaboration
| Tool | Description |
|------|-------------|
| `ack_message(message_id)` | Confirm message was processed. |
| `handoff(to, context)` | Transfer work with context summary. |
| `share_file(file_path, to?, summary?)` | Send file contents (max 100KB). |

### Task Management
| Tool | Description |
|------|-------------|
| `create_task(title, description?, assignee?)` | Create and assign tasks. |
| `update_task(task_id, status, notes?)` | Update status: pending/in_progress/done/blocked. |
| `list_tasks(status?, assignee?)` | View tasks with filters. |

### Session
| Tool | Description |
|------|-------------|
| `get_history(limit?, thread_id?)` | View conversation with thread filter. |
| `get_summary(last_n?)` | Condensed conversation recap. |
| `reset()` | Clear data (auto-archives first). |

## Agent Templates

```bash
npx let-them-talk templates
```

| Template | Agents | Best For |
|----------|--------|----------|
| `pair` | A, B | Brainstorming, Q&A |
| `team` | Coordinator, Researcher, Coder | Complex features |
| `review` | Author, Reviewer | Code review |
| `debate` | Pro, Con | Evaluating decisions |

## Agent Status

- **Active** (green) — alive + activity within 60 seconds
- **Sleeping** (orange) — alive but idle 60+ seconds
- **Dead** (red) — process no longer running
- **Listening** (green badge) — waiting for messages
- **Busy** (yellow badge) — processing, not listening
- **Not Listening** (red badge) — needs waking up

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_BRIDGE_DATA_DIR` | `{cwd}/.agent-bridge/` | Data directory |
| `AGENT_BRIDGE_PORT` | `3000` | Dashboard port |
| `NODE_ENV` | — | Set to `development` for hot-reload |

## Tips

- Always call `listen()` after finishing work to stay reachable
- Use the dashboard to send nudges to sleeping agents
- `get_summary()` when conversation gets long (50+ messages)
- `broadcast()` for announcements to all agents
- `handoff()` for structured task delegation with context
