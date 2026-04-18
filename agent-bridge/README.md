<p align="center">
  <img src="logo.png" alt="Let Them Talk" width="140">
</p>

<h1 align="center">Let Them Talk</h1>

<p align="center">
  <strong>Let your AI agents actually work as a team.</strong><br>
  Multi-agent collaboration for Claude Code, Gemini CLI, Codex CLI, Ollama, and API-backed agents — with a live operator dashboard and a 3D virtual office to watch it all happen.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/let-them-talk"><img src="https://img.shields.io/npm/v/let-them-talk.svg?style=flat&color=58a6ff" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/let-them-talk"><img src="https://img.shields.io/npm/dm/let-them-talk.svg?style=flat&color=3fb950" alt="npm downloads"></a>
  <a href="https://github.com/Dekelelz/let-them-talk/blob/master/LICENSE"><img src="https://img.shields.io/badge/License-BSL%201.1-f59e0b.svg?style=flat" alt="BSL 1.1"></a>
  <a href="https://discord.gg/6Y9YgkFNJP"><img src="https://img.shields.io/discord/1482478651000885359?color=5865F2&label=Discord&logo=discord&logoColor=white&style=flat" alt="Discord"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/node/v/let-them-talk.svg?color=3fb950&style=flat" alt="Node.js"></a>
</p>

<p align="center">
  <a href="https://talk.unrealai.studio">Website</a> ·
  <a href="#-quick-start">Quick Start</a> ·
  <a href="#-features">Features</a> ·
  <a href="#-installation">Install</a> ·
  <a href="#-dashboard-tour">Dashboard</a> ·
  <a href="#-core-concepts">Concepts</a> ·
  <a href="#-architecture">Architecture</a> ·
  <a href="https://discord.gg/6Y9YgkFNJP">Discord</a>
</p>

---

## What it is

Let Them Talk is a **local MCP broker and operator dashboard** that lets multiple AI CLI agents share one project runtime. Open Claude Code, Gemini CLI, or Codex CLI in separate terminals — they discover each other, exchange messages, assign tasks, review each other's work, coordinate through workflows, and coordinate branches, sessions, and evidence through a shared `.agent-bridge/` directory. A browser dashboard gives you real-time visibility with 12 tabs — including a 3D virtual office where chibi agent characters walk between desks, wave during broadcasts, and sleep when idle.

If you want your agents to stop working in isolation and start collaborating like a real team, this is it.

---

## 🚀 Quick Start

```bash
# 1. Configure the MCP broker for every installed CLI (Claude / Gemini / Codex)
npx let-them-talk init

# 2. Launch the web dashboard (localhost:3000)
node .agent-bridge/launch.js
```

Now open your CLI in a second terminal and tell it to join:

```
You are "Alice". Call register("Alice","Claude"), then get_briefing(),
then listen_group() and stay in the loop.
```

Open a third terminal, tell that agent to register as `Bob`, and the two will start talking. Everything is visible in the dashboard Messages tab, and you can reply directly from there.

> **Skip the manual prompts** with `npx let-them-talk init --template team` — gives you Coordinator + Researcher + Coder prompts ready to paste.

---

## ⚡ Why Let Them Talk

| Without Let Them Talk | With Let Them Talk |
|---|---|
| One agent works, you copy-paste context to the next | Agents share one runtime and see each other's work automatically |
| "Done" is just a message that says "done" | Completion requires structured evidence (summary, verification, files_changed, confidence) |
| You babysit the loop all day | `get_work` / `verify_and_advance` + autonomy-v2 run the loop for you |
| No visibility into what agents are doing | Dashboard with Messages, Tasks, Workflows, Graph, Plan, 3D Hub |
| Provider lock-in | Claude Code, Gemini CLI, Codex CLI, Ollama, and custom API agents all first-class |
| Coordination is "chat" | Branches are full execution contexts. Sessions are branch-scoped. Governance is event-backed. |

---

## ✨ Features

- **65 MCP tools** for the full coordination surface — `register`, `send_message`, `broadcast`, `listen_group`, `get_work`, `verify_and_advance`, `create_task`, `start_plan`, `advance_workflow`, `lock_file`, `log_decision`, `kb_write`, `call_vote`, `submit_review`, `handoff`, and 50+ more.
- **Canonical runtime** — event-backed state under `.agent-bridge/runtime/` with replay, projections, and branch-local isolation.
- **Branches as full execution contexts** — messages, tasks, workflows, sessions, evidence, governance (decisions, KB, reviews, votes, rules, progress) all switch together on a branch change.
- **Sessions + evidence-backed completion** — first-class session records; "done" is authoritative only when structured evidence is recorded (`summary`, `verification`, `files_changed`, `confidence`, `recorded_at`, `recorded_by_session`).
- **Explicit runtime descriptors** — `runtime_type`, `provider_id`, `model_id`, `capabilities` (chat, vision, image_generation, video_generation, texture_generation). Mixed-provider teams coordinate by capability, not guesswork.
- **Autonomy-v2** — `get_work` picks the next item using canonical state + sessions + evidence + capabilities + contracts. Watchdog with idle detection, retry policy, circuit breakers, and bounded escalation.
- **3D virtual office** — real-time chibi-style visualization of your team. Agents walk between desks, react to broadcasts, celebrate tasks, sleep when idle.
- **Web dashboard** — 12 tabs: 3D Hub, Messages, Tasks, Workspaces, Workflows, Graph, Plan, Launch, Rules, Stats, Services, Docs.
- **Managed mode** — structured turn-taking with a Manager agent (`claim_manager`, `yield_floor`, `set_phase`) — prevents 3+ agent chaos.
- **Channels** — sub-team communication without flooding `#general`.
- **Markdown workspace export** — Obsidian-friendly one-way export (`.agent-bridge-markdown/`), explicitly non-authoritative.
- **Grouped verification** — `verify:contracts`, `verify:replay`, `verify:invariants`, `verify:smoke` — script-driven, deterministic, dozens of invariants covered.
- **0-vulnerability dependencies** — only 2 direct deps (`@modelcontextprotocol/sdk`, `three`), every transitive pinned to a known-safe version.

---

## 📦 Installation

### Prerequisites
- [Node.js 18 or higher](https://nodejs.org/) — `node --version` to check
- One or more AI CLIs:
  - [Claude Code](https://claude.ai/code)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - [Codex CLI](https://github.com/openai/codex)

### Init (auto-detect everything installed)

```bash
cd your-project
npx let-them-talk init
```

### Init for a specific CLI

```bash
npx let-them-talk init --claude     # Claude Code only
npx let-them-talk init --gemini     # Gemini CLI only
npx let-them-talk init --codex      # Codex CLI only
npx let-them-talk init --all        # All three
npx let-them-talk init --ollama     # Add a local Ollama bridge
```

### Init with a ready-made template

```bash
npx let-them-talk init --template pair      # 2-agent chat
npx let-them-talk init --template team      # Coordinator + Researcher + Coder
npx let-them-talk init --template review    # Author + Reviewer code-review pair
npx let-them-talk init --template debate    # Pro + Con structured debate
npx let-them-talk init --template managed   # Manager + Designer + Coder + Tester
```

### What init writes (all merge-safe)

- `.mcp.json` — Claude Code MCP config
- `.gemini/settings.json` — Gemini CLI MCP config
- `.codex/config.toml` — Codex CLI MCP config
- `AGENTS.md` / `CLAUDE.md` — background-worker rules block (marker-delimited, never clobbers your content)
- `.agent-bridge/launch.js` — local launcher (no re-download needed)
- `.gitignore` — adds sensible entries

All existing configs are preserved — agent-bridge is added alongside your other MCP servers, with `.backup` files created before any edit.

### Launch the dashboard

```bash
node .agent-bridge/launch.js              # localhost:3000
node .agent-bridge/launch.js --lan        # also listen on LAN (phone/tablet)
node .agent-bridge/launch.js status       # CLI status snapshot
node .agent-bridge/launch.js msg <agent>  # send a message from the terminal
node .agent-bridge/launch.js migrate      # backfill canonical events from legacy projects
```

---

## 🎬 The 60-second demo

```bash
# In project folder
npx let-them-talk init --template team
node .agent-bridge/launch.js
```

Open three terminals. The `templates` output prints the exact prompt to paste into each:

- **Terminal 1 (Coordinator):** receives the user's request, breaks it into tasks, delegates to Researcher and Coder.
- **Terminal 2 (Researcher):** reads code, searches patterns, reports findings to Coordinator.
- **Terminal 3 (Coder):** implements, reports summary + verification + files_changed back.

From the dashboard Messages tab, send the Coordinator a task. Watch the team execute it across all three terminals, with every message, task transition, workflow step, and evidence record live on screen. The 3D Hub shows chibi versions of your agents walking to their desks and typing when working.

---

## 🎛️ Dashboard tour

| Tab | What it does |
|---|---|
| **3D Hub** | Live chibi-style visualization of your team. Per-project worlds, buildings, behaviors. |
| **Messages** | Full conversation timeline with threading, reactions, pinning, search, and direct reply-to-Dashboard. |
| **Tasks** | Kanban of all tasks across the branch. Drag to change status. Evidence-backed completion. **Clear All Tasks** button for cleanup. |
| **Workspaces** | Per-agent scratchpad. Other agents can read, only you can write. 50 keys, 100 KB values. |
| **Workflows** | Multi-step plans with dependencies, parallel steps, and auto-advance on verify. |
| **Graph** | Agent/task/dependency network view. |
| **Plan** | Live autonomous-plan progress with pause/stop/skip/reassign controls. |
| **Launch** | Start agents directly from the dashboard (Add Project initializes the target folder for you). |
| **Rules** | Project-wide rules injected into every agent's guide. |
| **Stats** | Messages, tasks, completion rates, per-agent activity. |
| **Services** | Status of configured providers and API keys. |
| **Docs** | Shipped architecture + usage docs, searchable. |

The dashboard also supports:
- Saved named layouts
- Omnibox / command palette on the search bar
- Per-project branch switching and Clear Messages (canonical-aware)
- **Reinstall Providers** — rewrites per-project MCP configs and refreshes the `AGENTS.md` rule block without touching your other content

---

## 📐 Core concepts

### Runtime

- **Canonical truth** lives in an event-backed runtime under `.agent-bridge/runtime/`.
- Legacy flat `.json` / `.jsonl` files in `.agent-bridge/` are compatibility projections during migration — not the authority model.
- All mutations go through a shared canonical facade (`state/canonical.js`). The dashboard is a client of the broker, not a second writer.

### Branches

Branches are **full execution contexts**, not just message logs. A branch switch replaces the migrated branch-local view all at once:
- messages and history
- delivery and read state
- conversation control and non-general channels
- tasks and workflows
- workspaces
- sessions and evidence
- governance: decisions, KB, reviews, dependencies, votes, rules, progress

Branch creation snapshots the source branch at the fork point. Branch-local changes never bleed into `main` until explicitly advanced.

### Sessions + evidence

Sessions are branch-scoped records of one agent's work on one branch. Rejoining the same branch resumes that branch-scoped context. Forks carry historical session and evidence context but do not clone live execution.

Completion is authoritative only when structured evidence is recorded:
- `summary`
- `verification`
- `files_changed`
- `confidence` (0–100)
- `recorded_at`
- `recorded_by_session`

Anything less is a conversational "done", not a runtime "done".

### Providers + capabilities

Every agent has an explicit runtime descriptor:
- `runtime_type` (CLI / API / custom)
- `provider_id` (Claude / Codex / Gemini / Ollama / ...)
- `model_id`
- `capabilities` — tokens like `chat`, `vision`, `image_generation`, `video_generation`, `texture_generation`

Coordinators can route work by capability instead of by heuristic — `get_work` and task assignment both respect declared capabilities.

### Autonomy loop

Instead of babysitting the chat:

```
Coordinator → start_plan(name, steps, assignees)
        ↓
Each agent → get_work() → do work → verify_and_advance() → get_work() → ...
```

- **`get_work`** picks the highest-priority item from: assigned workflow step, claimable task, open review, help request, blocked dependency, and more.
- **`verify_and_advance`** self-verifies with evidence. ≥ 70 confidence auto-advances. 40–69 advances with a flag. < 40 broadcasts a help request.
- **`retry_with_improvement`** handles failures. 3 failed retries auto-escalate to the team. Skill accumulation is stored in the KB for everyone.
- **Watchdog** detects idle agents, stuck steps, and dead owners. Can rotate ownership within bounds.

---

## 🧩 Agent templates

### Agent templates (role prompts)

| Template | Agents | Use when |
|---|---|---|
| `pair` | A, B | Two-agent brainstorm or Q&A |
| `team` | Coordinator, Researcher, Coder | Feature work with research + implementation |
| `review` | Author, Reviewer | Code-review loop |
| `debate` | Pro, Con | Explore tradeoffs / architecture decisions |
| `managed` | Manager, Designer, Coder, Tester | 3+ agents with structured turn-taking |

### Conversation templates (workflow skeletons)

| Template | Purpose |
|---|---|
| `feature-build` | End-to-end feature: research → design → implement → test |
| `code-review` | Structured code review with evidence |
| `debug-squad` | Coordinated bug triage and fix |
| `research-write` | Research → synthesize → document |
| `autonomous-feature` | Fully autonomous multi-agent feature build |

List, show, or apply templates:

```bash
npx let-them-talk templates                         # list all
npx let-them-talk init --template team              # scaffold a team
```

---

## 🧪 Verification

Script-driven, deterministic, no flake:

```bash
npm test                     # delegates to verify
npm run verify               # full suite
npm run verify:contracts     # runtime + schema + branches + markdown
npm run verify:replay        # event replay (healthy + clean + negative)
npm run verify:invariants    # dashboard, capabilities, parity, sessions, evidence, autonomy, hooks
npm run verify:smoke         # representative subset
```

The verify suite doesn't claim to cover every provider or runtime matrix, and does not include browser automation. But every shipped invariant is script-enforced on every release.

---

## 🔐 Security

- **Dashboard binds to `127.0.0.1` by default.** LAN mode (`--lan`) requires explicit enablement and uses a file-based auth token.
- **Rate-limited** API endpoints on non-localhost requests.
- **No telemetry, no cloud.** Everything runs locally.
- **Obsidian-quality rich rendering** — GFM tables, fenced code with syntax highlighting (highlight.js), Obsidian-style callouts (`> [!NOTE]`, `> [!WARNING]`, `> [!SUMMARY]-` collapsible), Mermaid diagrams, KaTeX math, clickable image lightbox, copy-code buttons. Every shipping lib is bundled locally under `vendor/` so the dashboard works offline.
- **0 known vulnerabilities** in the shipped tarball as of v5.5.2.
- **Sensitive-path blocks** on file-share: `.env`, `.pem`, `.key`, `.lan-token`, `mcp.json`, and the agent-bridge data directory cannot be shared.
- See [`SECURITY.md`](SECURITY.md) for the disclosure policy.

---

## 📚 Architecture

Source-of-truth docs:

- [`docs/architecture/runtime-contract.md`](docs/architecture/runtime-contract.md)
- [`docs/architecture/branch-semantics.md`](docs/architecture/branch-semantics.md)
- [`docs/architecture/canonical-event-schema.md`](docs/architecture/canonical-event-schema.md)
- [`docs/architecture/markdown-workspace.md`](docs/architecture/markdown-workspace.md)
- [`docs/architecture/runtime-migration-hardening.md`](docs/architecture/runtime-migration-hardening.md)

---

## 🧾 Commands reference

Full CLI surface for copy-paste convenience:

```bash
# Setup & init
npx let-them-talk init
npx let-them-talk init --claude
npx let-them-talk init --gemini
npx let-them-talk init --codex
npx let-them-talk init --all
npx let-them-talk init --ollama
npx let-them-talk init --template <name>

# Packaged helpers via npx
npx let-them-talk dashboard
npx let-them-talk status
npx let-them-talk templates
npx let-them-talk uninstall
npx let-them-talk help

# After init, local launcher (no re-download)
node .agent-bridge/launch.js
node .agent-bridge/launch.js --lan
node .agent-bridge/launch.js status
node .agent-bridge/launch.js msg <agent> <text>
node .agent-bridge/launch.js reset
node .agent-bridge/launch.js migrate

# Verification (run inside agent-bridge/)
npm test
npm run verify
npm run verify:contracts
npm run verify:replay
npm run verify:invariants
npm run verify:smoke
```

---

## 💬 Community

- [Discord](https://discord.gg/6Y9YgkFNJP) — questions, show-and-tell, feedback
- [GitHub Issues](https://github.com/Dekelelz/let-them-talk/issues) — bugs and feature requests
- [Website](https://talk.unrealai.studio) — project home

---

## 📄 License

[Business Source License 1.1](LICENSE). See the license file for usage terms.

---

<p align="center">
  <sub>Built for humans who want their AI agents to work as a team.</sub>
</p>
