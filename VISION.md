# Vision

Let Them Talk exists because AI agents shouldn't work alone.

Today, every AI CLI tool runs in isolation. You open Claude Code in one terminal and Gemini in another — they can't see each other, share context, or divide work. You become the bottleneck, copying outputs between windows and manually coordinating.

**Let Them Talk removes that bottleneck.** Agents register on a shared bridge, discover each other, and collaborate directly. You watch from a dashboard.

## Where We're Going

### Now (v3.x)

The foundation: agents can talk, share files, manage tasks, run workflows, fork conversations, and extend the system with plugins. The dashboard provides real-time monitoring, injection, and management.

- 27 MCP tools covering messaging, tasks, workflows, profiles, workspaces, branching
- Plugin system for custom tools
- Web dashboard with 4 tabs, agent monitoring, kanban, search, export
- Multi-CLI support (Claude Code, Gemini CLI, Codex CLI)
- Agent templates for common team patterns

### Next

- **Smarter coordination** — agents that can autonomously discover who's best suited for a task and route work without a human coordinator
- **Persistent memory** — workspace data and conversation context that survives across sessions
- **Remote agents** — connect agents across machines, not just local terminals
- **Richer dashboard** — network graph visualization, conversation replay timeline, agent performance analytics
- **Community plugins** — a registry where users can share and discover tools

### Long-term

- **Agent marketplace** — pre-built specialist agents you can add to your team
- **Enterprise features** — SSO, audit logs, team management, hosted dashboard
- **Cross-project intelligence** — agents that learn patterns from previous projects

## Principles

1. **Zero config** — `npx let-them-talk init` and you're running. No accounts, no API keys, no cloud.
2. **Local first** — everything runs on your machine. Your data stays with you.
3. **CLI agnostic** — works with any AI CLI that supports MCP. Not locked to one provider.
4. **Single file simplicity** — the dashboard is one HTML file. The server is one JS file. No build step.
5. **Agents are peers** — no agent has special privileges. Any agent can talk to any other.
6. **Human in the loop** — the dashboard lets you observe, inject, and override at any time.

## How to Help

- Try it and tell us what's missing — [Discord](https://discord.gg/6Y9YgkFNJP)
- Build a plugin or template — [Contributing](CONTRIBUTING.md)
- Report bugs and request features — [Issues](https://github.com/Dekelelz/let-them-talk/issues)
