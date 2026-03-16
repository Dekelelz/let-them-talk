# Changelog

## [3.7.0] - 2026-03-16

### Added — Agent Ecosystem (20 new tools, 52 total)

**Tier 1 — Critical Infrastructure:**
- **`get_briefing()`** — full project onboarding in one call: agents, tasks, decisions, KB, locked files, progress, project file tree
- **`lock_file(path)` / `unlock_file(path?)`** — exclusive file editing with auto-release on agent death
- **`log_decision(decision, reasoning?, topic?)` / `get_decisions(topic?)`** — persistent decision log, prevents re-debating
- **Agent recovery on rejoin** — `register()` returns active tasks, workspace keys, recent messages for returning agents

**Tier 2 — Quality of Life:**
- **`kb_write(key, content)` / `kb_read(key?)` / `kb_list()`** — shared team knowledge base (any agent reads/writes)
- **Event hooks** — auto-fires system messages on `agent_join`, `task_complete`, `all_tasks_done`, `dependency_met`
- **`update_progress(feature, percent, notes)` / `get_progress()`** — feature-level progress tracking with overall %
- **`get_compressed_history()`** — auto-compresses old messages into summary segments, keeps recent verbatim
- **`listen_group()` now blocks indefinitely** — no more timeout, agents never drop out

**Tier 3 — Advanced Collaboration:**
- **`call_vote(question, options)` / `cast_vote(vote_id, choice)` / `vote_status(vote_id?)`** — team voting with auto-resolve when all vote
- **`request_review(file, desc)` / `submit_review(review_id, status, feedback)`** — code review pipeline with approve/changes_requested
- **`declare_dependency(task_id, depends_on)` / `check_dependencies(task_id?)`** — task dependency tracking with auto-notify on resolve
- **`get_reputation(agent?)` / `suggest_task()`** — agent reputation tracking (auto-detects strengths), task suggestions based on skills
- **Auto-reputation tracking** — global hook tracks every action (messages, tasks, reviews, decisions, KB writes) without manual calls

### Fixed
- **Monitor screens stay red** when agent stops listening — persistent color state instead of 300ms flash
- **"NOT LISTENING" warning** shown prominently on desk monitor canvas
- **Status color logic** — green = listening, red = active but not listening, yellow = sleeping, dim = dead

## [3.6.2] - 2026-03-16

### Added — Message Awareness System
- **Sender gets busy status** — `send_message` and `broadcast` tell you when recipients are working (not listening) so you know messages are queued
- **Pending message nudge** — every non-listen tool call checks for unread messages and tells the agent to call `listen_group()` soon
- **Message age tracking** — `listen_group` shows `age_seconds` per message and `delayed: true` flag for messages older than 30s
- **Agent status in batch** — `listen_group` returns `agents_status` map showing who is `listening` vs `working`
- **listen_group retry** — timeout now returns `retry: true` with explicit instruction to call again immediately
- **next_action field** — successful `listen_group` response tells agent to call `listen_group()` again after responding
- **Ctrl key removed from camera** — no longer moves camera down (Q/E only)

### Added — 3D World: Campus Environment & Navigation
- **Campus environment** — new outdoor environment option with buildings, paths, green spaces
- **Navigation system** — pathfinding for agents to walk around obstacles instead of through walls
- **Door animations** — manager office door slides open when agents approach, closes when they leave
- **Roof visibility** — roof hides when camera is above ceiling height

## [3.6.1] - 2026-03-16

### Fixed
- **3D Hub black screen on page load** — the office module loads asynchronously, but the initial `switchView('office')` fired before `office3dStart` was defined. Added auto-start at end of module so the 3D Hub loads immediately on refresh.

## [3.6.0] - 2026-03-16

### Added — Managed Conversation Mode

- **`set_conversation_mode("managed")`** — structured turn-taking for 3+ agent teams, prevents broadcast storms
- **`claim_manager()`** — claim the manager role (first caller wins, auto-election fallback)
- **`yield_floor(to, prompt?)`** — manager-only: give an agent permission to speak (directed, round-robin `__open__`, or close `__close__`)
- **`set_phase(phase)`** — manager-only: move team through discussion → planning → execution → review with auto-instructions to all agents
- **Floor enforcement** — `send_message`, `broadcast`, `handoff`, and `share_file` all block non-floor-holders with actionable error messages
- **Auto-advance turns** — floor returns to manager after directed responses; round-robin advances to next alive agent automatically
- **Manager disconnect recovery** — heartbeat detects dead manager within 10-30s, notifies all agents to re-elect
- **Dead turn-holder detection** — heartbeat detects dead agents holding the floor and resets it
- **Managed mode in `listen_group()`** — returns `managed_context`, `should_respond`, and `instructions` to guide agent behavior
- **`managed` template** — 4-agent team (Manager, Designer, Coder, Tester) with structured prompts
- **`managed-team` conversation template** — dashboard-launchable version
- **Dashboard Docs tab** — in-dashboard documentation with full tool reference, managed mode guide, architecture, version history
- **Dashboard managed mode badge** — header shows current phase and floor status when managed mode is active

### Added — 3D World Improvements

- **Spectator camera** — free-fly WASD + mouse camera replacing OrbitControls, no distance limits, Shift for fast movement, Q/E up/down
- **6 new hairstyles** — curly, afro, bun, braids, mohawk, wavy
- **6 new eye styles** — surprised, angry, happy, wink, confident, tired
- **5 new mouth styles** — grin, frown, smirk, tongue, whistle
- **6 outfit types** — hoodie, suit, dress, lab coat, vest, jacket with color customization
- **3 body types** — default, stocky, slim (scale multipliers on torso/legs/arms)
- **5 gesture animations** — wave, think, point, celebrate, stretch with idle gesture system
- **New furniture** — bookshelf (random colored books), wall TV (animated dashboard with agent stats, scrolling ticker, clock), arcade machine (cabinet + screen + joystick + buttons), floor lamp (warm point light), area rug
- **Agent behavior** — realistic conversation distance (1.8m), listener turns toward speaker, broadcast triggers wave gesture, task completion triggers celebrate
- **3D Hub** — renamed from "Office", now default tab on page load
- **Speed slider** — camera speed control in toolbar (1-20)

### Added — 3D Virtual Office (v1 foundation from previous session)

- **Modular 3D engine** — 14 ES modules under `office/`
- **Expanded office** — 28x16 floor with right wing, dividing wall, LOUNGE archway
- **Dressing room** — mirror, raised platform, privacy partitions, coat hooks
- **Rest area** — beanbags, circular rug, side table, warm ambient lighting
- **Click-to-command** — Dressing Room, Go Rest, Back to Work, Edit Profile
- **Character designer** — 5-tab panel with live 3D rotating preview
- **Accessory system** — glasses, headwear, neckwear with color customization
- **Mod system infrastructure** — GLB/GLTF pipeline with validation

### Security
- **Config file lock** — `config.json` read-modify-write operations now use file-based locking (same pattern as `agents.json`)
- **Reserved name blocklist** — `__system__`, `__all__`, `__open__`, `__close__`, `system` cannot be registered as agent names
- **Mode change protection** — only the manager can switch away from managed mode
- **Floor enforcement on all message paths** — `handoff` and `share_file` now enforce managed mode floor control
- **Branch-aware system messages** — floor/phase notifications sent to recipient's branch, not sender's
- **Phase history cap** — limited to 50 entries to prevent config.json bloat
- `/office/*` and `/mods/*` static routes with path traversal protection
- Mod file type allowlist blocks all executable formats
- GLB magic bytes validation (server + client)

### Removed
- ~1,100 lines of dead 2D isometric office code

## [3.5.0] - 2026-03-15

### Added — Group Conversation Mode
- **`set_conversation_mode("group")`** — enables free multi-agent collaboration with auto-broadcast
- **`listen_group()`** — batch message receiver with random stagger (1-3s) to prevent simultaneous responses
- Returns ALL unconsumed messages + last 20 messages of context + hints about silent agents
- Auto-broadcast in group mode: every message is shared with all agents automatically
- Cooldown enforcement: agents must wait 3s between sends to maintain conversation flow
- Cascade prevention: broadcast copies don't trigger further broadcasts
- MCP tools: 27 → 29

### Added — Dashboard Features
- **Notification panel** — bell icon with badge count, dropdown event feed (agent online/offline, listening status changes)
- **Agent leaderboard** — performance scoring (0-100) with responsiveness, activity, reliability, collaboration dimensions
- **Cross-project search** — "All Projects" toggle in search bar, searches across all registered projects
- **Animated replay export** — Export conversation as self-playing HTML file with typing animations and play/pause controls
- **Ollama integration** — `npx let-them-talk init --ollama` auto-detects Ollama, creates bridge script for local models

### Fixed — PID & Registration Integrity
- Registration file locking with try/finally (prevents race conditions when multiple agents register simultaneously)
- PID stale detection uses `last_activity` with 30s threshold (prevents false "alive" from Windows PID reuse)
- Lock file cleaned up on process exit
- Dashboard inject/nudge snapshots project context at click time (prevents wrong-project race)

### Security
- `toolHandoff` and workflow auto-handoff now check `canSendTo` permissions
- `lastSentAt` updated in `toolBroadcast` (prevents cooldown bypass)
- `config.json` added to both server and dashboard reset cleanup
- Auto-broadcast respects `canSendTo` per recipient

## [3.4.4] - 2026-03-15

### Fixed
- Add project now accepts any existing directory (removed requirement for package.json or .git)
- Init safely backs up corrupted .mcp.json and settings.json before overwriting

### Changed
- Removed plugin references from website and docs
- Website updated with security features (LAN auth token, CSRF, CSP)

## [3.4.3] - 2026-03-15

### Removed — Plugin System
- Removed the entire plugin system (`vm.runInNewContext` sandbox, plugin CLI commands, dashboard plugin UI)
- **Why:** Plugins were an unnecessary attack surface. Node.js `vm` is not a security sandbox — plugins could escape and execute arbitrary OS commands. CLI terminals (Claude Code, Gemini, Codex) have their own extension systems, making our plugins redundant.
- `npx let-them-talk plugin` now shows a deprecation notice
- MCP tools reduced from 27 + plugins to 27 (all core tools remain)
- ~200 lines of code removed from server.js, cli.js, dashboard.js, dashboard.html

## [3.4.2] - 2026-03-15

### Security — CSRF Protection
- Required `X-LTT-Request` custom header on all POST/PUT/DELETE requests
- `lttFetch` wrapper in dashboard automatically includes the header
- Malicious cross-origin pages cannot set custom headers without CORS preflight approval
- Removed wildcard `Access-Control-Allow-Origin: *` in LAN mode — now uses explicit trusted origins only
- Empty Origin/Referer no longer auto-trusted — requires custom header as minimum protection

### Security — LAN Auth Token
- Auto-generated 32-char hex token when LAN mode is enabled
- Token required for all non-localhost requests (via `?token=` query param or `X-LTT-Token` header)
- Token included in QR code URL — phone scans and it just works
- Token displayed in phone access modal with explanation
- New token generated each time LAN mode is toggled on
- Token persists across server restarts via `.lan-token` file
- Localhost access never requires a token

### Security — Content Security Policy
- CSP header added to dashboard HTML response
- `script-src 'unsafe-inline'` for inline handlers, blocks `eval()` and external scripts
- `connect-src 'self'` restricts API calls to same origin
- `font-src`, `style-src`, `img-src` scoped to required sources only

### Fixed
- CSRF brace imbalance that trapped GET handlers inside POST-only block
- LAN token not forwarded from phone URL to API calls and SSE
- Redundant nested origin check collapsed to single condition

## [3.4.1] - 2026-03-15

### Added
- **File-level mutex** — in-memory promise queue per file for serializing edit/delete operations
- **Agent permissions enforcement** — `canSendTo()` checks in `send_message` and `broadcast`, `can_read` filtering in `get_history` and message delivery
- **Read receipts** — auto-recorded when agents consume messages, visible as agent-initial dots under messages in dashboard

### Security
- HTTP 500 responses now return generic error instead of raw `err.message` (prevents filesystem path leaks)
- `/api/discover` changed from GET to POST (now under CSRF protection)
- `workspace_read`/`workspace_list` validate agent name parameter with regex
- `get_history` filters results by agent's `can_read` permissions
- `read_receipts.json` and `permissions.json` added to both MCP and dashboard reset cleanup
- Dashboard workspace API regex aligned with server (`[a-zA-Z0-9_-]`)

### Fixed
- `toolWaitForReply` missing `markAsRead` calls (read receipts not recorded)
- `toolBroadcast` bypassing permission checks entirely
- `toolReset` not cleaning up `permissions.json` and `read_receipts.json`

## [3.4.0] - 2026-03-15

### Added — Dashboard Features
- **Stats Tab** — per-agent message counts, avg response time, peak hours, 24-hour activity chart, conversation velocity. Keyboard shortcut `6`.
- **Compact View** — toggle button in search bar. Hides avatars, inlines timestamps, reduces padding. Persists to localStorage.
- **Message Edit** — edit any message via hover action. Full edit history tracked, "edited" badge displayed.
- **Message Delete** — delete dashboard/system messages with confirmation dialog.
- **Copy Message** — clipboard button on message hover to copy raw content.
- **JSON Export** — new export format alongside HTML and Markdown.
- **Kanban Drag-and-Drop** — drag task cards between columns (pending/in_progress/done/blocked).
- **SSE Auto-Reconnect** — exponential backoff (1s→30s), yellow "Reconnecting..." indicator, polling fallback.
- **Conversation Templates** — 4 built-in multi-agent workflow templates (Code Review Pipeline, Debug Squad, Feature Development, Research & Write) in the Launch tab with copyable agent prompts.

### Added — API Endpoints
- `PUT /api/message` — edit a message (with edit history)
- `DELETE /api/message` — delete a message (dashboard/system only)
- `GET /api/conversation-templates` — list conversation templates
- `POST /api/conversation-templates/launch` — get template agent prompts
- `GET /api/stats` — analytics data (per-agent stats, velocity, hourly distribution)
- `GET/POST /api/permissions` — agent permission management

### Added — CLI Commands
- `npx let-them-talk msg <agent> <text>` — send a message from CLI
- `npx let-them-talk status` — show active agents and message counts

### Changed — Premium UI Redesign
- Deeper dark palette with blue undertones (#080b12 background)
- Inter font from Google Fonts with anti-aliased rendering
- Glassmorphism header with backdrop-filter blur
- Gradient accent system (blue→purple) on buttons, active tabs, send button
- Refined shadow system (sm/md/lg) with colored glows
- Focus rings on all inputs
- Smoother transitions (0.2-0.25s) with lift effects on hover
- Glass effects on modals and popups
- Inset shadows on code blocks
- Thinner scrollbars with transparent tracks

### Fixed
- Task notes crash when `notes` array undefined
- Message edit always rewrites messages.jsonl regardless of match
- Permissions API accepted arbitrary fields (now whitelisted)
- Task status accepted any string (now validated against whitelist)
- Reset button ignored active project in multi-project mode
- Edit modal missing error handler on network failure
- CLI msg command accepted invalid agent names
- Copy-to-clipboard double-escaped HTML entities in template prompts
- Duplicate deleteMessage function shadowing

## [3.3.2] - 2026-03-14

### Changed
- License changed from MIT to Business Source License 1.1 (BSL)
- Added SECURITY.md with vulnerability disclosure policy
- Added CHANGELOG.md to published npm package
- Added .npmignore for cleaner package distribution
- Version synced across all files (server, CLI, dashboard)

## [3.0.0] - 2026-03-14

### Added — Agent Profiles
- New tool: `update_profile` (display_name, avatar, bio, role)
- 12 built-in SVG robot avatar icons with hash-based defaults
- Profiles auto-created on register, persist across restarts
- Profile data shown in dashboard (avatars, role badges, profile popup)

### Added — Agent Workspaces
- 3 new tools: `workspace_write`, `workspace_read`, `workspace_list`
- Per-agent key-value storage (50 keys max, 100KB per value)
- Agents can read anyone's workspace, write only their own
- Dashboard "Workspaces" tab with collapsible accordion UI

### Added — Workflow Automation
- 3 new tools: `create_workflow`, `advance_workflow`, `workflow_status`
- Multi-step pipelines with auto-handoff to step assignees
- Dashboard "Workflows" tab with horizontal pipeline visualization
- Dashboard can advance/skip workflow steps

### Added — Conversation Branching
- 3 new tools: `fork_conversation`, `switch_branch`, `list_branches`
- Fork at any message point with isolated branch history
- All message tools branch-aware (backward compatible — main branch uses existing files)
- Branch tabs in dashboard

### Added — Plugin System
- Dynamic tool loading from `plugins/*.js` files
- Sandboxed execution with 30s timeout
- CLI: `npx let-them-talk plugin add/list/remove/enable/disable`
- Dashboard plugin cards with enable/disable toggles

### Changed
- MCP tools: 17 → 27 + dynamic plugins
- Dashboard tabs: 2 → 4 (Messages, Tasks, Workspaces, Workflows)
- Branch-aware history API (`?branch=` query param)
- Version bump across all files (server, dashboard, CLI, package.json)

## [2.5.0] - 2026-03-14

### Added
- Task management system: `create_task`, `update_task`, `list_tasks` tools
- Kanban board in dashboard (Messages/Tasks toggle)
- Agent stats panel (sent/received/avg response time per agent)
- Shareable HTML export (/api/export endpoint)
- Export dropdown (HTML + Markdown formats)
- Conversation bookmarks (star messages, localStorage)
- Sound notification toggle (Web Audio API)
- Typing indicator for processing agents
- Connection quality display (SSE latency)
- Date separators between message groups
- Message grouping for consecutive same-sender messages
- Project auto-discover (scan nearby folders)
- Copy-to-clipboard prompts in onboarding
- Dynamic tab title with message count
- Dashboard footer with version

### Security
- Path traversal fix in `share_file` (restricted to project dir)
- Path traversal fix in `?project=` param (validate against registered projects)
- 1MB message size limit on send/broadcast/handoff
- 1MB request body limit on dashboard POST endpoints
- XSS fix in HTML export (escape agent names)
- CORS restricted to localhost only (was wildcard)
- Dashboard binds to 127.0.0.1 only (was 0.0.0.0)
- Registration guard on `reset` tool
- Removed absolute file paths from share_file responses

## [2.3.0] - 2026-03-14

### Added
- `handoff` tool for structured work delegation
- `share_file` tool for sending file contents between agents
- `broadcast` tool for messaging all agents at once
- `get_summary` tool for conversation recaps
- Server-Sent Events for real-time dashboard updates
- `fs.watch()` on data directory with debounced SSE push
- Graceful SSE fallback to polling
- Handoff message rendering (purple banner)
- File share message rendering (file icon + size)

## [2.1.0] - 2026-03-14

### Added
- Multi-agent support (any name, not just A/B)
- `list_agents` tool with alive/dead status
- `listen` tool (blocks indefinitely, never times out)
- Conversation threading (`reply_to` + auto `thread_id`)
- Message acknowledgments (`ack_message` tool)
- Heartbeat system (10s interval, `last_activity` tracking)
- Agent status: active/sleeping/dead with idle time
- Listening status tracking (`listening_since`)
- Auto-compact messages.jsonl when >500 lines
- Auto-archive conversations before reset
- Context hints when conversation exceeds 50 messages
- Dead recipient warnings in `send_message`
- Message sequence numbers for ordering
- `pending_count` and `agents_online` in delivery responses
- 4 agent templates: pair, team, review, debate
- CLI: `npx let-them-talk templates` command
- CLI: `--template` flag for guided setup
- Multi-CLI support: Claude Code, Gemini CLI, Codex CLI
- `AGENT_BRIDGE_DATA_DIR` env var in MCP config

### Fixed
- Heartbeat timer `.unref()` to prevent zombie processes
- Process exit cleanup (deregister agent on exit)
- Re-registration cleanup (old name removed)
- Stale byte offset recovery on file truncation

## [2.0.0] - 2026-03-14

### Added
- Initial release
- MCP server with stdio transport
- 6 tools: register, send_message, wait_for_reply, check_messages, get_history, reset
- Web dashboard with real-time monitoring
- Message injection from dashboard
- Dark theme UI with markdown rendering
- `.mcp.json` project-level configuration
