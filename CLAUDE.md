# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

## What this is

Let Them Talk is a local MCP broker and operator dashboard for multi-agent collaboration. Claude Code, Gemini CLI, Codex CLI, and API-backed agents share one project runtime through `.agent-bridge/`.

## Source of truth docs

- `docs/architecture/runtime-contract.md`
- `docs/architecture/branch-semantics.md`
- `docs/architecture/canonical-event-schema.md`
- `docs/architecture/markdown-workspace.md`
- `docs/architecture/runtime-migration-hardening.md`

Use those architecture docs and `agent-bridge/package.json` as the current truth source for runtime behavior and grouped verification coverage.

## Commands

```bash
# Install in any project
npx let-them-talk init
npx let-them-talk init --claude
npx let-them-talk init --gemini
npx let-them-talk init --codex
npx let-them-talk init --all
npx let-them-talk init --ollama
npx let-them-talk init --template <name>

# After init, prefer the local launcher
node .agent-bridge/launch.js
node .agent-bridge/launch.js --lan
node .agent-bridge/launch.js status
node .agent-bridge/launch.js msg <agent> <text>
node .agent-bridge/launch.js reset

# Packaged helpers
npx let-them-talk dashboard
npx let-them-talk status
npx let-them-talk templates
npx let-them-talk uninstall
npx let-them-talk help

# Run MCP server directly
npm --prefix agent-bridge start

# Markdown workspace export
npm --prefix agent-bridge run export:markdown-workspace

# Verification
npm test
npm --prefix agent-bridge run verify
npm --prefix agent-bridge run verify:contracts
npm --prefix agent-bridge run verify:replay
npm --prefix agent-bridge run verify:invariants
npm --prefix agent-bridge run verify:smoke
```

## Runtime shape

- `agent-bridge/server.js` remains the broker and MCP entrypoint.
- `agent-bridge/dashboard.js` is the operator dashboard and export API surface.
- `agent-bridge/state/canonical.js` is the canonical read and write facade used by server, dashboard, CLI, and API-agent paths.
- `agent-bridge/runtime-descriptor.js` defines the explicit runtime descriptor surface: `runtime_type`, `provider_id`, `model_id`, and `capabilities`.

Current runtime rules:

- canonical runtime data lives under `.agent-bridge/runtime/`
- legacy `.json` and `.jsonl` files in `.agent-bridge/` remain compatibility projections during migration
- the runtime contract treats branches as full-context namespaces, not message-only forks. In the shipped runtime today, branch-local guarantees already cover messages and history, delivery and read state, conversation control and non-general channels, sessions, evidence, tasks and workflows, and workspaces
- branch-local guarantees now also cover the governance surfaces that used to remain compatibility-shared during migration: decisions, KB, reviews, dependencies, votes, rules, and progress
- branch switches replace the whole migrated branch-local collaboration view at once
- sessions are branch-scoped, resumable on the same branch, and switched or forked with historical context but not cloned live execution
- completion is only authoritative when evidence is recorded, including `recorded_at` and `recorded_by_session`
- `.agent-bridge-markdown/` is a generated export surface only, never a runtime input
- compatibility-shared or main-only markdown surfaces are emitted only for `main` or omitted, never copied into non-main branch folders

Current capability tokens are:

- `chat`
- `vision`
- `image_generation`
- `video_generation`
- `texture_generation`

Legacy `provider`, `provider_color`, and `bot_capability` fields remain compatibility projections over the explicit descriptor.

## Verification

Verification is script-driven and deterministic.

- `npm test` at the repo root delegates to `agent-bridge`
- `verify:contracts` checks the runtime contract, canonical event schema, branch semantics, and markdown workspace contract
- `verify:replay` checks healthy and clean replay plus expected-failure negative replay scenarios
- `verify:invariants` checks authority routing, dashboard control plane behavior, performance and indexing, provider capabilities, API-agent parity, dashboard semantic-gap coverage, migration hardening, branch isolation, session lifecycle, evidence-backed completion, session-aware context, autonomy v2, advisory contracts, managed-team integration, lifecycle hooks, and markdown workspace export and safety
- `verify:smoke` runs a representative subset, including the dashboard semantic-gap check

There is no lint or build step. Coverage is still partial. The verification surface does not claim a full provider or runtime matrix, and it does not include browser automation.
