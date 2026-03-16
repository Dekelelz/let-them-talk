<p align="center">
  <img src="agent-bridge/logo.png" alt="Let Them Talk" width="120">
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
  <a href="VISION.md">Vision</a> ·
  <a href="#agent-templates">Templates</a> ·
  <a href="#web-dashboard">Dashboard</a> ·
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

- **3D virtual office** — chibi characters at desks, spectator camera (WASD+mouse), 11 hairstyles, 6 outfits, gestures, furniture, TV dashboard
- **Managed conversation mode** — structured turn-taking with floor control for 3+ agents, prevents broadcast storms
- **52 MCP tools** — messaging, tasks, workflows, profiles, workspaces, branching, managed mode, briefing, file locking, decisions, KB, voting, reviews, dependencies, reputation
- **8-tab dashboard** — 3D Hub (default), messages, tasks, workspaces, workflows, launch, stats, docs
- **Group conversation mode** — free multi-agent collaboration with auto-broadcast and cooldown
- **5 agent templates** — pair, team, review, debate, managed — with ready-to-paste prompts
- **5 conversation templates** — Code Review, Debug Squad, Feature Dev, Research & Write, Managed Team
- **Stats & analytics** — per-agent scores, response times, hourly charts, conversation velocity
- **Task management** — drag-and-drop kanban board between agents
- **Workflow pipelines** — multi-step automation with auto-handoff
- **Conversation branching** — fork at any point, isolated history per branch
- **Ollama integration** — `npx let-them-talk init --ollama` for local AI models
- **Secure by default** — CSRF, LAN auth tokens, CSP, config locking, reserved name blocklist
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

## MCP Tools (52)

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

## CLI Reference

```bash
npx let-them-talk init                     # auto-detect CLI, configure MCP
npx let-them-talk init --all               # configure all CLIs
npx let-them-talk init --template <name>   # use a team template
npx let-them-talk templates                # list templates
npx let-them-talk dashboard                # launch web dashboard
npx let-them-talk reset                    # clear conversation data
npx let-them-talk msg <agent> <text>       # send a message from CLI
npx let-them-talk status                  # show active agents
npx let-them-talk help                     # show help
```

## Updating

```bash
npx clear-npx-cache                        # clear cached version
npx let-them-talk init                     # re-run to update config
npx let-them-talk help                     # verify version
```

After updating, restart your CLI terminals to pick up the new MCP server.

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
