<p align="center">
  <img src="agent-bridge/logo.png" alt="Let Them Talk" width="120">
</p>

<h1 align="center">Let Them Talk</h1>

<p align="center">
  Local multi-agent collaboration for AI CLI terminals and API adapters.
</p>

Let Them Talk is a local MCP broker and operator dashboard. Claude Code, Gemini CLI, Codex CLI, and API-backed agents share one project runtime, exchange messages, manage work, and expose the same branch, session, and evidence model through a shared `.agent-bridge/` directory.

## Quick start

```bash
npx let-them-talk init
node .agent-bridge/launch.js
```

In each agent terminal:

1. Register an agent name.
2. Call `get_briefing()` if you are joining existing work.
3. Use `listen()` in direct mode, `listen_group()` in group or managed mode, or `get_work()` if you are running the proactive autonomy loop.

## Current runtime model

- Canonical runtime state is broker-owned and event-backed under `.agent-bridge/runtime/`.
- Legacy JSON and JSONL files remain compatibility projections during migration. They are not the authority model.
- The runtime contract treats branches as full-context namespaces. In the shipped runtime today, branch-local guarantees already cover messages and history, delivery and read state, conversation control and non-general channels, sessions, evidence, tasks and workflows, and workspaces.
- Branch-local guarantees now also cover the governance surfaces that used to remain compatibility-shared during migration: decisions, KB, reviews, dependencies, votes, rules, and progress.
- Branch switches replace the whole migrated branch-local collaboration view at once.
- Sessions are tied to one agent on one branch. Switching branches suspends one branch session and creates or resumes another, and forks copy historical session and evidence context without cloning live execution.
- Terminal task and workflow completion is only authoritative when structured evidence is recorded, including `recorded_at` and `recorded_by_session` metadata.
- Markdown workspace export writes to `.agent-bridge-markdown/` and stays non-authoritative. Editing exported markdown does not change runtime state.

Architecture references:

- `docs/architecture/runtime-contract.md`
- `docs/architecture/branch-semantics.md`
- `docs/architecture/canonical-event-schema.md`
- `docs/architecture/markdown-workspace.md`
- `docs/architecture/runtime-migration-hardening.md`

## Command surface

Setup:

```bash
npx let-them-talk init
npx let-them-talk init --claude
npx let-them-talk init --gemini
npx let-them-talk init --codex
npx let-them-talk init --all
npx let-them-talk init --ollama
npx let-them-talk init --template <name>
```

After init, prefer the local launcher that was written into the project:

```bash
node .agent-bridge/launch.js
node .agent-bridge/launch.js --lan
node .agent-bridge/launch.js status
node .agent-bridge/launch.js msg <agent> <text>
node .agent-bridge/launch.js reset
```

Other packaged CLI helpers:

```bash
npx let-them-talk dashboard
npx let-them-talk status
npx let-them-talk templates
npx let-them-talk uninstall
npx let-them-talk help
```

## Template inventory

Agent templates shipped today:

- `pair`
- `team`
- `review`
- `debate`
- `managed`

Conversation templates shipped today:

- `autonomous-feature`
- `code-review`
- `debug-squad`
- `feature-build`
- `research-write`

## Runtime descriptors and provider capabilities

API-backed agents persist an explicit runtime descriptor with these fields:

- `runtime_type`
- `provider_id`
- `model_id`
- `capabilities`

Supported capability tokens today:

- `chat`
- `vision`
- `image_generation`
- `video_generation`
- `texture_generation`

Legacy `provider`, `provider_color`, and `bot_capability` fields remain compatibility projections over that descriptor.

## Markdown workspace export

```bash
npm --prefix agent-bridge run export:markdown-workspace
```

Default export root is `<project>/.agent-bridge-markdown/`. Exported files declare `authoritative: false` in frontmatter. The export is one-way only. There is no markdown write-back, watcher loop, or import path in the current runtime.

When a source surface is still compatibility-shared or main-only, export stays truthful by emitting it only for `main` or omitting it. The exporter does not fabricate non-main branch copies from shared state.

## Verification

From the repo root:

```bash
npm test
```

Grouped package commands:

```bash
npm --prefix agent-bridge run verify
npm --prefix agent-bridge run verify:contracts
npm --prefix agent-bridge run verify:replay
npm --prefix agent-bridge run verify:invariants
npm --prefix agent-bridge run verify:smoke
```

Current grouped coverage:

- `verify:contracts` checks the runtime contract, canonical event schema, branch semantics, and markdown workspace contract.
- `verify:replay` checks healthy and clean replay plus expected-failure negative replay scenarios.
- `verify:invariants` checks authority routing, dashboard control plane behavior, performance and indexing, provider capabilities, API-agent parity, dashboard semantic-gap coverage, migration hardening, branch isolation, session lifecycle, evidence-backed completion, session-aware context, autonomy v2, advisory contracts, managed-team integration, lifecycle hooks, and markdown workspace export and safety.
- `verify:smoke` runs a representative subset, including the dashboard semantic-gap check.

Coverage is still partial. The suite does not claim a full provider or runtime matrix, and it does not include browser automation.

## Security and license

Security notes live in `agent-bridge/SECURITY.md`.

License: [Business Source License 1.1](agent-bridge/LICENSE)
