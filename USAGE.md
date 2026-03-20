# Let Them Talk — Usage Guide v5.1.0

## Installation

```bash
npx let-them-talk init              # Auto-detects your CLI
npx let-them-talk init --all        # Configure for all CLIs
npx let-them-talk init --claude     # Claude Code only
npx let-them-talk init --gemini     # Gemini CLI only
npx let-them-talk init --codex      # Codex CLI only
npx let-them-talk init --ollama     # Ollama agent bridge (local LLM)
npx let-them-talk init --template team  # Use a team template
```

Works on **Windows, macOS, and Linux**. Cross-platform path handling built in.

## CLI Commands

```bash
npx let-them-talk init              # Configure MCP for your CLI(s)
npx let-them-talk dashboard         # Launch web dashboard (http://localhost:3000)
npx let-them-talk dashboard --lan   # Dashboard accessible on LAN (phone/tablet)
npx let-them-talk templates         # List available agent templates
npx let-them-talk run "prompt"      # Autonomous execution (--agents N, --timeout M)
npx let-them-talk status            # Show active agents and message count
npx let-them-talk msg <agent> <text>  # Send a message from the CLI
npx let-them-talk doctor            # Diagnose setup issues
npx let-them-talk plugin            # Plugin management (list/add/remove/enable/disable)
npx let-them-talk reset             # Clear data (auto-archives first)
npx let-them-talk uninstall         # Remove agent-bridge from all CLI configs
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
- Agent monitoring (active/sleeping/dead/listening states)
- Kanban task board with assignment and status tracking
- Workflow pipeline visualization
- Workspace viewer (per-agent key-value stores)
- Knowledge base browser
- Message injection + broadcast
- Bookmarks, search, export (HTML/Markdown)
- Conversation replay with timeline slider
- Plan dashboard with live progress, pause/stop/skip/reassign
- Dark/light theme toggle
- Sound + browser notifications
- Keyboard shortcuts: `/` search, `Esc` clear, `1`/`2` switch tabs

## All 66 MCP Tools

### Core Communication
| Tool | Description |
|------|-------------|
| `register(name)` | Set agent identity. Must call first. |
| `list_agents()` | Show all agents with status and idle time. |
| `send_message(content, to?, reply_to?)` | Send to agent. Auto-routes with 2 agents. |
| `broadcast(content)` | Send to all other agents at once. |
| `wait_for_reply(timeout?, from?)` | Block until message arrives (5min timeout). |
| `listen(from?)` | Block indefinitely — never times out. |
| `listen_codex()` | Listen variant for Codex CLI compatibility. |
| `listen_group()` | Listen in group conversation mode with turn management. |
| `check_messages(from?)` | Non-blocking inbox peek. |
| `search_messages(query)` | Full-text search across message history. |

### Collaboration
| Tool | Description |
|------|-------------|
| `ack_message(message_id)` | Confirm message was processed. |
| `handoff(to, context)` | Transfer work with context summary. |
| `share_file(file_path, to?, summary?)` | Send file contents (max 100KB). |
| `distribute_prompt(prompt)` | Fan out a prompt to multiple agents. |

### Channels
| Tool | Description |
|------|-------------|
| `join_channel(channel)` | Join a named channel. |
| `leave_channel(channel)` | Leave a channel. |
| `list_channels()` | Show all channels and their members. |

### Task Management
| Tool | Description |
|------|-------------|
| `create_task(title, description?, assignee?)` | Create and assign tasks. |
| `update_task(task_id, status, notes?)` | Update: pending/in_progress/done/blocked. |
| `list_tasks(status?, assignee?)` | View tasks with filters. |
| `suggest_task(title, description?)` | Suggest a task for the team. |

### Workflows & Autonomy
| Tool | Description |
|------|-------------|
| `create_workflow(name, steps)` | Define a multi-step pipeline. |
| `advance_workflow(workflow_id)` | Move to the next step (auto-handoff). |
| `workflow_status(workflow_id)` | Check pipeline progress. |
| `start_plan(plan)` | Launch an autonomous execution plan. |
| `get_work()` | Pull next available task (autonomy loop). |
| `verify_and_advance(task_id, result)` | Submit work + auto-verify + advance. |
| `retry_with_improvement(task_id, feedback)` | Retry failed task with accumulated learnings. |

### Workspaces
| Tool | Description |
|------|-------------|
| `workspace_write(key, value)` | Write to your agent's workspace. |
| `workspace_read(agent?, key?)` | Read any agent's workspace. |
| `workspace_list(agent?)` | List workspace keys. |

### Knowledge Base
| Tool | Description |
|------|-------------|
| `kb_write(key, value)` | Write to the shared knowledge base. |
| `kb_read(key)` | Read from the knowledge base. |
| `kb_list()` | List all knowledge base entries. |

### Branching
| Tool | Description |
|------|-------------|
| `fork_conversation(branch_name)` | Create a conversation branch. |
| `switch_branch(branch_name)` | Switch to a different branch. |
| `list_branches()` | Show all conversation branches. |

### Voting & Code Review
| Tool | Description |
|------|-------------|
| `call_vote(question, options?)` | Start a team vote. |
| `cast_vote(vote_id, choice)` | Vote on an open question. |
| `vote_status(vote_id)` | Check vote results. |
| `request_review(file, description?)` | Request code review from the team. |
| `submit_review(review_id, verdict, comments?)` | Submit a review (approve/reject/comment). |

### Dependencies & Progress
| Tool | Description |
|------|-------------|
| `declare_dependency(from_task, to_task)` | Declare a task dependency. |
| `check_dependencies(task_id)` | Check if dependencies are met. |
| `update_progress(task_id, percent, note?)` | Report progress on a task. |
| `get_progress(task_id?)` | Check progress for tasks. |

### Team Intelligence
| Tool | Description |
|------|-------------|
| `get_guide()` | Get role-specific guidance for your agent. |
| `get_briefing()` | Get a situational briefing (what happened, what's next). |
| `get_reputation(agent?)` | View reputation scores and stats. |
| `get_compressed_history()` | Get a compressed summary of long conversations. |
| `log_decision(decision, reasoning?)` | Log an architectural decision with rationale. |
| `get_decisions()` | View the decision log. |

### Rules & Governance
| Tool | Description |
|------|-------------|
| `add_rule(rule, scope?)` | Add a team rule or guideline. |
| `list_rules()` | View all active rules. |
| `remove_rule(rule_id)` | Remove a rule. |
| `toggle_rule(rule_id)` | Enable/disable a rule. |

### File Locking
| Tool | Description |
|------|-------------|
| `lock_file(file_path)` | Lock a file to prevent conflicts. |
| `unlock_file(file_path)` | Release a file lock. |

### Session & Mode
| Tool | Description |
|------|-------------|
| `get_history(limit?, thread_id?)` | View conversation with thread filter. |
| `get_summary(last_n?)` | Condensed conversation recap. |
| `set_conversation_mode(mode)` | Switch between direct/group mode. |
| `set_phase(phase)` | Set the current project phase. |
| `claim_manager()` | Claim the manager/coordinator role. |
| `yield_floor()` | Yield your turn in group mode. |
| `update_profile(display_name?, avatar?, bio?)` | Set your agent profile. |
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
| `ollama` | Local LLM agent | Offline/local AI |

## Autonomy Engine

The v5.x autonomy loop lets agents self-organize without human intervention:

```
get_work → do work → verify_and_advance → get_work (repeat)
```

- **Parallel workflows** with dependency graphs (`depends_on`)
- **Auto-retry** with skill accumulation (3 attempts then team escalation)
- **Watchdog engine** detects idle/stuck agents, auto-reassigns work
- **100ms handoff cooldowns** in autonomous mode
- **Plan dashboard** with live progress, pause/stop/skip/reassign controls

Use `npx let-them-talk run "build a REST API" --agents 3 --timeout 30` to launch a fully autonomous session.

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
- `get_work()` to enter the autonomous work loop
- `kb_write()` to share knowledge that persists across conversations
- `request_review()` before merging critical changes
- `call_vote()` for team decisions that need consensus
- Use `--lan` flag on dashboard to monitor from your phone
