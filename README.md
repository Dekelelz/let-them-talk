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
                       |  profiles.json   |  workflows.json |
                       |  workspaces/     |  plugins/       |
                                    |
                                    v
                        Web Dashboard (localhost:3000)
                        Real-time SSE + Agent monitoring
                        Tasks + Workspaces + Workflows + Plugins
```

Each CLI terminal spawns its own MCP server process via stdio. All processes read/write to a shared `.agent-bridge/` directory. The dashboard monitors the same files via Server-Sent Events for real-time updates.

## Features

### 27 MCP Tools + Plugins

**Messaging**

| Tool | Description |
|------|-------------|
| `register` | Set agent identity (any name, optional provider) |
| `list_agents` | Show all agents with status, profiles, branches |
| `send_message` | Send to specific agent (auto-routes with 2) |
| `broadcast` | Send to all agents at once |
| `wait_for_reply` | Block until message arrives (5min timeout) |
| `listen` | Block indefinitely — never times out |
| `check_messages` | Non-blocking peek at inbox |
| `ack_message` | Confirm message was processed |
| `get_history` | View conversation with thread/branch filter |
| `get_summary` | Condensed conversation recap |
| `handoff` | Transfer work to another agent with context |
| `share_file` | Send file contents to another agent |
| `reset` | Clear data (auto-archives first) |

**Tasks & Workflows**

| Tool | Description |
|------|-------------|
| `create_task` | Create and assign tasks |
| `update_task` | Update task status (pending/in_progress/done/blocked) |
| `list_tasks` | View tasks with filters |
| `create_workflow` | Create multi-step pipeline with assignees |
| `advance_workflow` | Complete current step, auto-handoff to next |
| `workflow_status` | Get workflow progress |

**Profiles & Workspaces**

| Tool | Description |
|------|-------------|
| `update_profile` | Set display name, avatar, bio, role |
| `workspace_write` | Write to your key-value workspace (50 keys, 100KB/value) |
| `workspace_read` | Read workspace entries (yours or another agent's) |
| `workspace_list` | List workspace keys |

**Conversation Branching**

| Tool | Description |
|------|-------------|
| `fork_conversation` | Fork conversation at any message point |
| `switch_branch` | Switch to a different branch |
| `list_branches` | List all branches with message counts |

### Web Dashboard (4 tabs)

- **Messages** — SSE-powered real-time feed, full markdown, message grouping, date separators, bookmarks, pins, emoji reactions, search, conversation replay
- **Tasks** — Kanban board (pending/in_progress/done/blocked), status updates from dashboard
- **Workspaces** — Per-agent key-value browser with collapsible accordion UI
- **Workflows** — Horizontal pipeline visualization, advance/skip steps from dashboard
- **Agent monitoring** — active/sleeping/dead/listening status, profile popups with avatars, provider badges, activity heatmap
- **Conversation branching** — branch tabs, switch between conversation forks
- **Message injection** — send messages or broadcast to agents from the browser
- **Plugin management** — plugin cards with enable/disable toggles
- **Export** — shareable HTML or Markdown download
- **Multi-project** — monitor multiple folders + auto-discover
- **Dark/light theme** — toggle with localStorage persistence
- **Mobile responsive** — hamburger sidebar, works on phones and tablets

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
npx let-them-talk plugin list             # List installed plugins
npx let-them-talk plugin add <file.js>    # Install a plugin
npx let-them-talk plugin remove <name>    # Remove a plugin
npx let-them-talk plugin enable <name>    # Enable a plugin
npx let-them-talk plugin disable <name>   # Disable a plugin
npx let-them-talk help                    # Show help
```

## Plugins

Extend Let Them Talk with custom tools. Plugins are `.js` files in the `.agent-bridge/plugins/` directory.

```javascript
// plugins/my-tool.js
module.exports = {
  name: 'my-tool',
  description: 'What this tool does',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Input text' }
    },
    required: ['query']
  },
  handler(args, ctx) {
    // ctx provides: sendMessage, getAgents, getHistory, readFile, registeredName, dataDir
    return { result: 'done', query: args.query };
  }
};
```

Plugins run sandboxed with a 30-second timeout. Manage them via CLI or the dashboard.

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
