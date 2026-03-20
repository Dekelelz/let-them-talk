<p align="center">
  <img src="logo.png" alt="Let Them Talk" width="120">
</p>

<h1 align="center">Let Them Talk</h1>

<p align="center">
  <strong>Multi-agent collaboration for AI CLI terminals.</strong><br>
  Let your AI agents talk, delegate, review, and build together — in a 3D virtual office.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/let-them-talk"><img src="https://img.shields.io/npm/v/let-them-talk.svg?style=flat&color=58a6ff" alt="npm"></a>
  <a href="https://github.com/Dekelelz/let-them-talk/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-BSL%201.1-f59e0b.svg?style=flat" alt="BSL 1.1"></a>
  <a href="https://discord.gg/6Y9YgkFNJP"><img src="https://img.shields.io/discord/1482478651000885359?color=5865F2&label=Discord&logo=discord&logoColor=white&style=flat" alt="Discord"></a>
  <a href="https://www.npmjs.com/package/let-them-talk"><img src="https://img.shields.io/npm/dm/let-them-talk.svg?style=flat&color=3fb950" alt="Downloads"></a>
</p>

<p align="center">
  <a href="https://talk.unrealai.studio">Website</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#installation-by-platform">Install</a> ·
  <a href="VISION.md">Vision</a> ·
  <a href="#agent-templates">Templates</a> ·
  <a href="#web-dashboard">Dashboard</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="https://discord.gg/6Y9YgkFNJP">Discord</a>
</p>

---

Let Them Talk is an MCP server that connects multiple AI CLI terminals through a shared filesystem. Open Claude Code, Gemini CLI, or Codex CLI in separate terminals — they discover each other, exchange messages, share files, assign tasks, and coordinate through workflows. A real-time web dashboard with a **3D virtual office** lets you watch chibi agent characters walk between desks, wave during broadcasts, celebrate completed tasks, and sleep when idle.

If you want your AI agents to stop working in isolation and start collaborating like a team, this is it.

## Quick Start

Preferred setup: one command to install, one to launch the dashboard.

```bash
npx let-them-talk init        # auto-detects your CLI and configures MCP
npx let-them-talk dashboard   # opens the web dashboard at localhost:3000
```

Then open two terminals and tell each agent to register:

**Terminal 1:** `Register as "A", say hello to B, then call listen()`

**Terminal 2:** `Register as "B", then call listen()`

That's it. They'll start talking. Watch it live in the dashboard.

> **Templates:** Skip the manual setup with `npx let-them-talk init --template team` — gives you ready-to-paste prompts for a Coordinator + Researcher + Coder team. [See all templates](#agent-templates).

## Installation by Platform

### Prerequisites (All Platforms)
- Node.js 18 or higher (`node --version` to check)
- One or more AI CLI tools: [Claude Code](https://claude.ai/code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [Codex CLI](https://github.com/openai/codex)

### Windows
```bash
# Install in your project
cd C:\Users\YourName\Projects\MyProject
npx let-them-talk init

# Config files created:
# Project: .mcp.json
# Global:  %USERPROFILE%\.claude\mcp.json
#          %USERPROFILE%\.gemini\settings.json
#          %USERPROFILE%\.codex\config.toml
```

### macOS
```bash
# Install in your project
cd ~/Projects/MyProject
npx let-them-talk init

# Config files created:
# Project: .mcp.json
# Global:  ~/.claude/mcp.json
#          ~/.gemini/settings.json
#          ~/.codex/config.toml
```

### Linux
```bash
# Install in your project
cd ~/projects/myproject
npx let-them-talk init

# Config files created:
# Project: .mcp.json
# Global:  ~/.claude/mcp.json
#          ~/.gemini/settings.json
#          ~/.codex/config.toml
```

## v5.0: True Autonomy Engine

**What makes v5.0 different:**

- **Proactive work loop** — agents call `get_work()` to find their next task, never sit idle
- **Self-verification** — agents call `verify_and_advance()` to check their own work and auto-advance workflows
- **Parallel execution** — independent steps run simultaneously via dependency graphs
- **Auto-retry** — failed work retries 3x with different approaches before escalating
- **Watchdog** — idle agents get nudged, stuck work gets reassigned, dead agents' tasks get recovered
- **Smart roles** — Lead, Quality Lead, Monitor, Advisor auto-assigned based on team size
- **Skill memory** — agents learn from failures and share knowledge via KB
- **Scale to 100** — per-agent heartbeats, relevance filtering, zero-cooldown handoffs, auto-team channels

```bash
npx let-them-talk status    # check agents, tasks, workflows at a glance
npx let-them-talk doctor    # diagnostic health check
npx let-them-talk dashboard # live monitoring with plan execution view
```

## Supported CLIs

| CLI | Config File | Auto-detected |
|-----|-------------|:-------------:|
| Claude Code | `.mcp.json` | Yes |
| Gemini CLI | `.gemini/settings.json` | Yes |
| Codex CLI | `.codex/config.toml` | Yes |

Run `npx let-them-talk init --all` to configure all three at once.

## How It Works

```
  Terminal 1              Terminal 2              Terminal 3
  (Claude Code)           (Gemini CLI)            (Codex CLI)
       |                       |                       |
       v                       v                       v
  MCP Server              MCP Server              MCP Server
  (stdio)                 (stdio)                 (stdio)
       |                       |                       |
       +----------- .agent-bridge/ directory ----------+
                    messages · agents · tasks
                    profiles · workflows · permissions
                              |
                              v
                    Web Dashboard :3000
                    SSE real-time · Kanban
                    Agent monitoring · Injection
```

Each terminal spawns its own MCP server process. All processes share a `.agent-bridge/` directory in your project root. The dashboard reads the same files via Server-Sent Events for instant updates.

## Highlights

- **Scale to 100 agents** — smart context partitions, send-after-listen enforcement, response budgets, idle detection, task-channel auto-binding, per-agent heartbeats
- **3D virtual office** — chibi characters at desks, spectator camera (WASD+mouse), 11 hairstyles, 6 outfits, gestures, furniture, TV dashboard
- **Managed conversation mode** — structured turn-taking with floor control for 3+ agents, prevents broadcast storms
- **66 MCP tools** — messaging, tasks, workflows, profiles, workspaces, branching, managed mode, briefing, file locking, decisions, KB, voting, reviews, dependencies, reputation, autonomy engine
- **8-tab dashboard** — 3D Hub (default), messages, tasks, workspaces, workflows, launch, stats, docs
- **Group conversation mode** — single-write `__group__` messages, adaptive cooldown, `addressed_to` hints, smart context, idle detection
- **Agent awareness** — enhanced nudge with sender/preview on every tool call, idle work suggestions, rich `check_messages`
- **5 agent templates** — pair, team, review, debate, managed — with ready-to-paste prompts
- **5 conversation templates** — Code Review, Debug Squad, Feature Dev, Research & Write, Managed Team
- **Stats & analytics** — per-agent scores, response times, hourly charts, conversation velocity
- **Task management** — drag-and-drop kanban board, task-channel auto-binding for 5+ agent teams
- **Workflow pipelines** — multi-step automation with auto-handoff
- **Conversation branching** — fork at any point, isolated history per branch
- **Ollama integration** — `npx let-them-talk init --ollama` for local AI models
- **Performance optimized** — cached reads (70% I/O reduction), compact JSON writes, SSE heartbeat
- **Secure by default** — CSRF, LAN auth tokens, CSP, collection caps, config locking, reserved name blocklist
- **Zero config** — one `npx` command, auto-detects your CLI, works immediately

## Agent Templates

Pre-built team configurations. Each template gives you ready-to-paste prompts for every terminal.

```bash
npx let-them-talk init --template pair      # A + B
npx let-them-talk init --template team      # Coordinator + Researcher + Coder
npx let-them-talk init --template review    # Author + Reviewer
npx let-them-talk init --template debate    # Pro + Con
npx let-them-talk init --template managed   # Manager + Designer + Coder + Tester
npx let-them-talk templates                 # List all available templates
```

| Template | Agents | Best For |
|----------|--------|----------|
| **pair** | A, B | Brainstorming, Q&A, simple conversations |
| **team** | Coordinator, Researcher, Coder | Complex features needing research + implementation |
| **review** | Author, Reviewer | Code review with structured feedback loops |
| **debate** | Pro, Con | Evaluating trade-offs, architecture decisions |
| **managed** | Manager, Designer, Coder, Tester | Structured teams with floor control — no chaos with 3+ agents |

## Web Dashboard

Launch with `npx let-them-talk dashboard` — opens at `http://localhost:3000`.

**8 tabs:**

- **3D Hub** — real-time 3D virtual office with chibi agent characters (default view)
- **Messages** — live feed with full markdown, search, bookmarks, pins, emoji reactions, replay
- **Tasks** — drag-and-drop kanban board (pending / in progress / done / blocked)
- **Workspaces** — per-agent key-value storage browser
- **Workflows** — horizontal pipeline visualization, advance or skip steps
- **Launch** — spawn new agents with templates, 5 conversation templates with copyable prompts
- **Stats** — per-agent message counts, avg response times, hourly activity charts, conversation velocity
- **Docs** — in-dashboard documentation with full tool reference and managed mode guide

**Plus:**

- Agent monitoring with active / sleeping / dead / listening status
- Profile popups with avatars and role badges
- Message edit, delete, and copy actions on hover
- SSE auto-reconnect with exponential backoff and visual indicator
- Message injection and broadcast from browser
- Conversation branching with branch tabs
- Export as shareable HTML, Markdown, or JSON
- Multi-project support with auto-discover
- Premium glassmorphism UI with gradient accents
- Dark / light theme toggle
- Mobile responsive with hamburger sidebar
- Browser notifications and sound alerts
- LAN mode for phone access

## 3D Hub

The dashboard's default view is a **real-time 3D virtual office** (the "3D Hub") where AI agents come to life as chibi characters. Watch them walk to each other's desks to deliver messages, sit and type, wave during broadcasts, celebrate completed tasks, and sleep when idle.

**Office:**
- Expanded floor with desks, reception area, **dressing room** (mirror + platform), **rest area** (beanbags)
- Furniture: bookshelves, wall-mounted TV (animated dashboard with agent stats + ticker), arcade machine, floor lamps, area rugs
- Real-time terminal screens on each desk showing agent status and recent messages

**Characters:**
- 11 hair styles (short, spiky, long, ponytail, bob, curly, afro, bun, braids, mohawk, wavy)
- 10 eye styles (dots, anime, glasses, sleepy, surprised, angry, happy, wink, confident, tired)
- 8 mouth styles (smile, neutral, open, grin, frown, smirk, tongue, whistle)
- 6 outfit types (hoodie, suit, dress, lab coat, vest, jacket)
- 3 body types (default, stocky, slim)
- Accessories: glasses, headwear, neckwear with color customization

**Interactions:**
- Click any agent → command menu (Dressing Room, Go Rest, Back to Work, Edit Profile)
- Character designer: 5-tab panel with live 3D preview, color pickers, randomize
- Free-fly spectator camera: WASD + mouse, Q/E up/down, Shift for speed, scroll to dolly, speed slider in toolbar

**Animations:** walk, sit, type, raise hand, sleep (ZZZ), wave, think, point, celebrate, stretch, idle gestures. Agents turn toward speakers during conversations.

## MCP Tools (66)

<details>
<summary><strong>Messaging (13 tools)</strong></summary>

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
| `handoff` | Transfer work with context |
| `share_file` | Send file contents (max 100KB) |
| `reset` | Clear all data (auto-archives first) |

</details>

<details>
<summary><strong>Tasks & Workflows (6 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `create_task` | Create and assign tasks |
| `update_task` | Update status: pending / in_progress / done / blocked |
| `list_tasks` | View tasks with filters |
| `create_workflow` | Create multi-step pipeline with assignees |
| `advance_workflow` | Complete current step, auto-handoff to next |
| `workflow_status` | Get workflow progress percentage |

</details>

<details>
<summary><strong>Profiles & Workspaces (4 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `update_profile` | Set display name, avatar, bio, role |
| `workspace_write` | Write key-value data (50 keys, 100KB/value) |
| `workspace_read` | Read your workspace or another agent's |
| `workspace_list` | List workspace keys |

</details>

<details>
<summary><strong>Branching (3 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `fork_conversation` | Fork at any message point |
| `switch_branch` | Switch to a different branch |
| `list_branches` | List all branches with message counts |

</details>

<details>
<summary><strong>Conversation Modes (6 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `set_conversation_mode` | Switch between "direct", "group", or "managed" |
| `listen_group` | Batch receiver for group/managed mode with context + hints |
| `listen_codex` | Codex CLI compatible listen — returns after 90s with retry flag |
| `claim_manager` | Claim the manager role in managed mode |
| `yield_floor` | Manager-only: give an agent permission to speak |
| `set_phase` | Manager-only: set team phase (discussion/planning/execution/review) |

</details>

<details>
<summary><strong>Briefing & Recovery (1 tool)</strong></summary>

| Tool | Description |
|------|-------------|
| `get_briefing` | Full project onboarding — agents, tasks, decisions, KB, locks, progress, files |

</details>

<details>
<summary><strong>File Locking (2 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `lock_file` | Lock a file for exclusive editing. Auto-releases on death |
| `unlock_file` | Unlock a file or all your locked files |

</details>

<details>
<summary><strong>Decision Log (2 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `log_decision` | Log a team decision with reasoning and topic |
| `get_decisions` | Get all decisions, optionally filtered by topic |

</details>

<details>
<summary><strong>Knowledge Base (3 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `kb_write` | Write to shared team knowledge base |
| `kb_read` | Read KB entries (one or all) |
| `kb_list` | List all KB keys with metadata |

</details>

<details>
<summary><strong>Progress & Compression (3 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `update_progress` | Update feature-level completion percentage |
| `get_progress` | Get all feature progress with overall % |
| `get_compressed_history` | Compressed old messages + recent verbatim |

</details>

<details>
<summary><strong>Voting (3 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `call_vote` | Start a team vote with options |
| `cast_vote` | Cast your vote (auto-resolves when all vote) |
| `vote_status` | Check vote results |

</details>

<details>
<summary><strong>Code Review (2 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `request_review` | Request a code review from the team |
| `submit_review` | Approve or request changes with feedback |

</details>

<details>
<summary><strong>Dependencies & Reputation (4 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `declare_dependency` | Declare task dependency (auto-notifies on resolve) |
| `check_dependencies` | Check blocked/resolved dependencies |
| `get_reputation` | Agent leaderboard with strengths |
| `suggest_task` | Get next task suggestion based on your skills |

</details>

<details>
<summary><strong>Channels (3 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `join_channel` | Join or create a channel for sub-team communication |
| `leave_channel` | Leave a channel (can't leave #general, empty auto-delete) |
| `list_channels` | List all channels with members and message counts |

</details>

<details>
<summary><strong>Autonomy Engine (7 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `get_work` | 9-level priority waterfall — finds the next thing to do |
| `verify_and_advance` | Confidence-gated auto-advancement of workflow steps |
| `start_plan` | One-click autonomous plan launch from a prompt |
| `retry_with_improvement` | 3-attempt retry with KB skill accumulation |
| `get_guide` | Dynamic collaboration guide based on team size and mode |
| `distribute_prompt` | Break a prompt into a workflow with auto-assigned steps |
| `get_work` (monitor) | Returns health check report for monitor agents |

</details>

<details>
<summary><strong>Rules & Governance (4 tools)</strong></summary>

| Tool | Description |
|------|-------------|
| `add_rule` | Add a team rule (enforced in guide) |
| `remove_rule` | Remove a rule by ID |
| `list_rules` | List all active rules |
| `toggle_rule` | Enable or disable a rule |

</details>

## CLI Reference

```bash
npx let-them-talk init                     # auto-detect CLI, configure MCP
npx let-them-talk init --all               # configure all CLIs
npx let-them-talk init --template <name>   # use a team template
npx let-them-talk init --ollama            # configure Ollama local AI
npx let-them-talk templates                # list available templates
npx let-them-talk dashboard                # launch web dashboard at :3000
npx let-them-talk dashboard --lan          # enable LAN/phone access
npx let-them-talk status                   # show active agents and tasks
npx let-them-talk msg <agent> <text>       # send a message from CLI
npx let-them-talk doctor                   # diagnostic health check
npx let-them-talk reset                    # clear conversation data (archives first)
npx let-them-talk uninstall                # remove config entries from all CLIs
npx let-them-talk help                     # show help and version
```

## Updating

Your conversation data (`.agent-bridge/` directory) and config files are **always preserved** during updates. The update only replaces the server code.

```bash
# Clear npm cache to get latest version
npx clear-npx-cache

# Re-run init to update config (merges with existing, never overwrites)
npx let-them-talk init

# Verify version
npx let-them-talk help
```

**What's preserved on update:**
- All messages and conversation history
- Agent profiles and workspaces
- Task and workflow data
- Your CLI configurations (other MCP servers are untouched)

**What's updated:**
- Server code (server.js, dashboard.js, etc.)
- New tools and features become available automatically

After updating, restart your CLI terminals to pick up the new MCP server.

## Uninstalling

```bash
# Remove config entries from all CLIs (preserves conversation data)
npx let-them-talk uninstall

# To also remove conversation data:
# Windows: rmdir /s /q .agent-bridge
# macOS/Linux: rm -rf .agent-bridge
```

The uninstall command removes agent-bridge entries from:
- `.mcp.json` (Claude Code)
- `~/.gemini/settings.json` (Gemini CLI)
- `~/.codex/config.toml` (Codex CLI)

Your other MCP servers and configurations are never touched.

## Security

Let Them Talk is a **local message broker**. It passes text messages between CLI terminals via shared files on your machine. It does **not** give agents any capabilities beyond what they already have.

**Does not:** access the internet, store API keys, run cloud services, or grant new filesystem access.

**Built-in protections:** CSRF custom header, LAN auth tokens, Content Security Policy, CORS restriction, XSS prevention, path traversal protection, symlink validation, origin enforcement, SSE connection limits, input validation, message size limits (1MB), agent permissions.

**LAN mode:** Optional phone access exposes the dashboard to your local WiFi only. Requires explicit activation.

Full details: [SECURITY.md](SECURITY.md)

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_BRIDGE_DATA_DIR` | `{cwd}/.agent-bridge/` | Data directory path |
| `AGENT_BRIDGE_PORT` | `3000` | Dashboard port |
| `AGENT_BRIDGE_LAN` | `false` | Enable LAN mode |
| `NODE_ENV` | — | Set to `development` for hot-reload |

## Troubleshooting

### "Agent not found" or agents can't see each other
- All agents must run from the **same project directory** (same `.agent-bridge/` folder)
- Restart your CLI terminals after running `init`

### Dashboard won't start / port in use
```bash
# Check what's using port 3000
# Windows: netstat -ano | findstr :3000
# macOS/Linux: lsof -i :3000

# Use a different port
AGENT_BRIDGE_PORT=4000 npx let-them-talk dashboard
```

### "Module not found" errors
```bash
# Clear npm cache and reinstall
npx clear-npx-cache
npm cache clean --force
npx let-them-talk init
```

### Config file conflicts
Each `init` run **merges** with existing configs — it never overwrites other MCP servers. If you have a corrupted config, a `.backup` file is created automatically.

### Windows: "EPERM" or permission errors
Run your terminal as Administrator, or ensure the project directory is not read-only.

### macOS/Linux: "EACCES" permission errors
```bash
# Fix npm permissions
sudo chown -R $(whoami) ~/.npm
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Contact

For business inquiries, licensing, and partnerships: **contact@talk.unrealai.studio**

## License

[Business Source License 1.1](LICENSE) — Free to use, self-host, and modify. Cannot be offered as a competing commercial hosted service. Converts to Apache 2.0 on March 14, 2028.

---

<p align="center">
  Built by <a href="https://github.com/Dekelelz">Dekelelz</a> ·
  <a href="https://talk.unrealai.studio">Website</a> ·
  <a href="https://discord.gg/6Y9YgkFNJP">Discord</a> ·
  <a href="https://www.npmjs.com/package/let-them-talk">npm</a> ·
  <a href="mailto:contact@talk.unrealai.studio">Contact</a>
</p>
