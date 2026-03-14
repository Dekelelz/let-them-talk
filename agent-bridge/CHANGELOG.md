# Changelog

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
