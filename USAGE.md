# Let Them Talk Usage Guide v5.5.4

This guide is the short operator view of the current runtime. For normative architecture details, use the docs under `docs/architecture/`.

## Install and launch

```bash
npx let-them-talk init
npx let-them-talk init --claude
npx let-them-talk init --gemini
npx let-them-talk init --codex
npx let-them-talk init --all
npx let-them-talk init --ollama
npx let-them-talk init --template <name>
```

After init, use the local launcher from the project:

```bash
node .agent-bridge/launch.js
node .agent-bridge/launch.js --lan
node .agent-bridge/launch.js status
node .agent-bridge/launch.js msg <agent> <text>
node .agent-bridge/launch.js reset
```

Packaged helpers still available through `npx`:

```bash
npx let-them-talk dashboard
npx let-them-talk status
npx let-them-talk templates
npx let-them-talk uninstall
npx let-them-talk help
```

## Join, listen, and resume work

Recommended entry sequence for an agent:

1. Register an agent name.
2. Call `get_briefing()` if the project already has history, tasks, or decisions.
3. Call `get_guide()` if you need the current collaboration rules for the active mode.

Current loop guidance:

- Direct mode: use `listen()`.
- Group or managed mode: use `listen_group()`.
- Codex CLI compatibility path: use `listen_codex()` when the runtime instructs it.
- Proactive autonomy loop: use `get_work()` and finish work with `verify_and_advance()`.

## Branch, session, and evidence model

- Canonical runtime truth is event-backed under `.agent-bridge/runtime/`.
- Legacy JSON and JSONL files are compatibility projections during migration. They are not the authority model.
- The runtime contract treats branches as full-context namespaces. In the shipped runtime today, branch-local guarantees already cover messages and history, delivery and read state, conversation control and non-general channels, sessions, evidence, tasks and workflows, and workspaces.
- Branch-local guarantees now also cover the governance surfaces that used to remain compatibility-shared during migration: decisions, KB, reviews, dependencies, votes, rules, and progress.
- A branch switch changes the whole migrated branch-local collaboration view, not only message history.
- Sessions are scoped to one agent on one branch. Rejoining the same branch resumes that branch-scoped context, switching branches suspends one branch session and creates or resumes another, and forks carry historical session and evidence context without cloning live sessions.
- Completion is only authoritative when structured evidence is recorded.
- The current evidence payload centers on `summary`, `verification`, `files_changed`, `confidence`, `recorded_at`, and `recorded_by_session`.

## Runtime descriptors and provider capabilities

API-backed agents now persist an explicit runtime descriptor with:

- `runtime_type`
- `provider_id`
- `model_id`
- `capabilities`

Supported capability tokens:

- `chat`
- `vision`
- `image_generation`
- `video_generation`
- `texture_generation`

Legacy `provider`, `provider_color`, and `bot_capability` fields remain compatibility projections over the explicit descriptor.

## Templates shipped today

Agent templates:

- `pair`
- `team`
- `review`
- `debate`
- `managed`

Conversation templates:

- `autonomous-feature`
- `code-review`
- `debug-squad`
- `feature-build`
- `research-write`

## Markdown workspace export and safety

```bash
npm --prefix agent-bridge run export:markdown-workspace
```

Current markdown workspace rules:

- default export root is `<project>/.agent-bridge-markdown/`
- exported files declare `authoritative: false`
- export is one-way only
- markdown edits do not write back into runtime state
- there is no watcher loop or implicit markdown import path
- compatibility-shared and main-only surfaces are exported only for `main` or omitted, never fabricated into non-main branch folders

## Verification

Repo root:

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

Grouped coverage today:

- `verify:contracts` checks the runtime contract, canonical event schema, branch semantics, and markdown workspace contract.
- `verify:replay` checks healthy and clean replay plus expected-failure negative replay scenarios.
- `verify:invariants` checks authority routing, dashboard control plane behavior, performance and indexing, provider capabilities, API-agent parity, dashboard semantic-gap coverage, migration hardening, branch isolation, session lifecycle, evidence-backed completion, session-aware context, autonomy v2, advisory contracts, managed-team integration, lifecycle hooks, and markdown workspace export and safety.
- `verify:smoke` runs a representative subset, including the dashboard semantic-gap check.

Coverage is still partial. The suite does not claim a full provider or runtime matrix, and it does not include browser automation.

## Source of truth references

- `README.md`
- `CLAUDE.md`
- `docs/architecture/runtime-contract.md`
- `docs/architecture/branch-semantics.md`
- `docs/architecture/canonical-event-schema.md`
- `docs/architecture/markdown-workspace.md`
- `docs/architecture/runtime-migration-hardening.md`
