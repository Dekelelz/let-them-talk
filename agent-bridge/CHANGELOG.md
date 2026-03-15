# Changelog

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
