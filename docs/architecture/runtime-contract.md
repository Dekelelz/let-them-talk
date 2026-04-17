# LetThemTalk Runtime Contract

Status: normative for Phase 1 runtime work  
Audience: implementation team, validator authors, dashboard/CLI/API-agent maintainers  
Last updated: 2026-04-17

## Guide-level overview

LetThemTalk is moving from “many processes rewriting shared files” to “one broker owns canonical state, everyone else sends commands and reads projections.”

- One broker lease holder is the only canonical writer for a project runtime.
- Canonical truth is append-only events; JSON/JSONL state files become rebuildable projections/materialized views.
- A branch is a full-context namespace, not just a different message/history file.
- A session is scoped to an agent on a branch and can be resumed with its outstanding work and evidence context.
- Completion is only authoritative when the broker records evidence for it.
- Unknown or newer on-disk formats fail closed; they are never silently rewritten.

Normative language in this document uses MUST, MUST NOT, SHOULD, and MAY in the RFC-style sense.

## Summary

This document freezes the target runtime architecture for LetThemTalk.

The authoritative model is a single-writer local broker with append-only canonical event streams and rebuildable projections. Dashboard routes, CLI helpers, API agents, and any future tooling are broker clients, not peer writers. Branches fork full branch-local context. Sessions are durable and branch-scoped. Completion, advancement, and similar “done” transitions require evidence. Storage evolution is explicit, versioned, and fail-closed on unknown formats.

This contract is intentionally implementation-driving. Later tasks may change code structure, module boundaries, or transport details, but they MUST NOT reopen the authority, event, branch, session, evidence, or versioning decisions frozen here.

## Context / Motivation

The current runtime is concentrated in `agent-bridge/server.js`, but canonical writes are not exclusive to that path.

Concrete current drift that this contract closes:

- `agent-bridge/dashboard.js` directly rewrites `tasks.json` and directly edits/deletes `messages.jsonl` and `history.jsonl`.
- `agent-bridge/cli.js` directly appends messages into `messages.jsonl` and `history.jsonl`.
- `agent-bridge/api-agents.js` directly mutates `agents.json`, `profiles.json`, and also appends messages/history.
- Historically, `agent-bridge/server.js` treated branches as alternate `messages.jsonl` / `history.jsonl` files only; the shipped runtime now extends branch-local scope across work, governance, session, evidence, and workspace surfaces.
- `agent-bridge/server.js` has event-like side effects such as `fireEvent(...)`, but those notifications are not canonical lifecycle records.
- Session recovery today is ad hoc (`register` recovery payloads, heartbeat/recovery files, recent messages) rather than a first-class runtime contract.

The result is authority drift, ambiguous source-of-truth rules, weak replay/recovery behavior, and branch semantics that are too narrow for later autonomy and verification work.

## Goals / Non-goals

### Goals

- Freeze one canonical writer model for all shared runtime state.
- Preserve a filesystem-native local runtime rather than introducing a network service or remote dependency.
- Make canonical history append-only and reconstructable.
- Make branch semantics full-context for agent-visible reasoning state.
- Make session lifecycle explicit and resumable.
- Make completion and workflow advancement evidence-backed.
- Freeze versioning, migration, and unknown-format handling so later tasks can implement without re-debating compatibility policy.

### Non-goals

- This document does not choose a specific broker IPC transport; stdio handoff, local HTTP, pipe/socket IPC, or an extracted in-process broker module are implementation choices as long as the single-writer contract is preserved.
- This document does not redesign dashboard UX.
- This document does not require a database migration; the runtime remains filesystem-native.
- This document does not define merge/cherry-pick semantics between branches.
- This document does not force all dashboard-owned operator/UI state into broker governance in Phase 1.

## Authority boundaries

### 1. Canonical writer rule

For a given project runtime directory, there MUST be exactly one active broker lease holder allowed to mutate canonical runtime state.

- Today, the future broker authority is anchored in `agent-bridge/server.js` because that file already owns most runtime semantics.
- Later refactors MAY extract broker code into dedicated modules or a helper process, but there is still only one canonical writer per runtime.
- Dashboard routes, CLI commands, API agents, scripts, and future tools MUST call broker commands/APIs and MUST NOT write canonical files directly.

### 2. Current canonical reality vs frozen target

The table below names the current source-of-truth files and freezes their target status under the new contract.

| Domain | Current canonical today | Frozen target status | Transitional or invalid writer paths |
| --- | --- | --- | --- |
| Message delivery and history | `.agent-bridge/messages.jsonl`, `.agent-bridge/history.jsonl` | Branch-local projections derived from canonical message events | `dashboard.js` message edit/delete rewrite paths, `cli.js::cliMsg`, `api-agents.js` direct append path |
| Agent registry and liveness | `.agent-bridge/agents.json` plus heartbeat overlay files | Global projection derived from runtime-global `agent.*` and `session.*` events | `api-agents.js::_registerInAgentsJson`, `_unregisterFromAgentsJson`, direct heartbeat updates |
| Profiles | `.agent-bridge/profiles.json` | Global projection derived from `profile.*` events | `api-agents.js` direct profile writes |
| Tasks | `.agent-bridge/tasks.json` | Branch-local projection derived from `task.*` events | `dashboard.js::apiUpdateTask` and any future non-broker task write |
| Workflows | `.agent-bridge/workflows.json` | Branch-local projection derived from `workflow.*` events | Any non-broker workflow mutation |
| Branch registry | `.agent-bridge/branches.json` and branch-specific message/history files | Global branch registry projection plus per-branch canonical event streams | Current message-only branch isolation is transitional and insufficient |
| Workspace / agent memory | `.agent-bridge/workspaces/{agent}.json` on `main` plus `branch-<branch>-workspaces/{agent}.json` elsewhere | Branch-local per-agent projection derived from `workspace.*` events | Any direct file write by clients |
| Decisions, KB, reviews, dependencies, votes, rules, progress | `.agent-bridge/decisions.json`, `kb.json`, `reviews.json`, `dependencies.json`, `votes.json`, `rules.json`, `progress.json` on `main`, plus `branch-<branch>-*.json` projections elsewhere | Branch-local projections derived from canonical events in the branch stream | Any dashboard/CLI/API-agent direct write or raw cross-branch read |
| File locks | `.agent-bridge/locks.json` | Runtime-global projection derived from `lock.*` events | Any non-broker direct lock mutation |
| Acknowledgements and compressed history | `.agent-bridge/acks.json`, `compressed.json` | Derived projections/operational artifacts, not canonical truth | Any code may rebuild them through broker-owned projection code only |
| Conversation mode / managed-floor state / branch conversation metadata | Currently shared in `.agent-bridge/config.json` | Branch-local projections derived from `conversation.*` events | Shared global config for branch-local conversation semantics is transitional |

### 3. Explicitly non-canonical state

The following remain outside canonical branch replay unless a future contract explicitly pulls them in:

- dashboard/operator-only state such as project lists and world/office layout state,
- LAN/auth/dashboard process settings,
- `api-agents.json` and similar dashboard-owned provider configuration,
- lock files, temp files, migration backups, and other operational files.

These files MAY exist and MAY be written by their owning process, but they MUST NOT be treated as authoritative branch state.

## Storage model

### 1. Canonical storage principle

Canonical state is append-only event data. Projections/materialized state are caches that can be rebuilt from canonical events plus explicitly versioned snapshot checkpoints.

The broker MUST NOT treat mutable JSON state files as the source of truth after the migration cutover.

### 2. Target runtime layout

The implementation MUST converge on a layout equivalent to the following:

```text
.agent-bridge/
  runtime/
    manifest.json                  # runtime/storage version manifest
    broker.lock                    # operational single-writer lease, not canonical data
    events.jsonl                   # runtime-global canonical events
    projections/
      agents.json
      profiles.json
      locks.json
      branch-index.json
      sessions-index.json
    branches/
      main/
        events.jsonl               # branch-local canonical events
        projections/
          messages.jsonl
          history.jsonl
          tasks.json
          workflows.json
          workspaces/
          decisions.json
          kb.json
          reviews.json
          dependencies.json
          votes.json
          rules.json
          progress.json
          evidence.json
          conversation.json
          sessions.json
        snapshots/
          latest.json
      <branch>/
        events.jsonl
        projections/
        snapshots/
```

Equivalent filenames MAY be used temporarily during migration, but the scope split above is normative:

- runtime-global events and projections live under `runtime/`,
- full branch-local state lives under `runtime/branches/<branch>/...`,
- snapshots are rebuild checkpoints, never the ultimate source of truth.

### 3. Compatibility projections

During migration, the broker MAY continue materializing legacy filenames such as `tasks.json`, `workflows.json`, `messages.jsonl`, and `history.jsonl` so existing readers keep working.

However:

- those legacy files are projections once event-sourcing is enabled,
- direct writes to those files become contract violations even if the filenames still exist,
- deleting and rebuilding those projections MUST be safe,
- if a compatibility projection exists but its canonical event stream is missing, rebuild and rollback MUST fail explicitly instead of treating the projection as authoritative.

### 4. Append-only rule

Canonical event streams MUST only support append. They MUST NOT be edited in place, compacted by rewriting history, or selectively deleted.

Implications:

- message edits become `message.corrected` or equivalent events,
- message deletion/redaction becomes `message.redacted` or equivalent tombstone events,
- task/workflow status corrections become compensating events,
- rollback is modeled as new events or whole-runtime backup restore during migration, never history surgery.

## Event / command model

### 1. Command handling

Clients submit commands to the broker. The broker validates, authorizes, resolves scope, appends canonical events, and then updates projections.

Command processing order is normative:

1. validate command envelope,
2. resolve runtime-global vs branch-local scope,
3. check session and branch authority,
4. append canonical event(s),
5. update projections and snapshots,
6. emit notifications/read-model updates.

If step 4 does not happen, the command did not commit.

### 2. Required command envelope

Every mutating broker command MUST include, explicitly or by broker-populated context:

- `command_id`
- `type`
- `issued_at`
- `actor_agent`
- `session_id`
- `branch_id` for branch-local commands
- `causation_id` when the command is responding to another event/command
- `correlation_id` for multi-step flows
- `payload`

Commands that depend on current projection state SHOULD include an expected version/sequence guard so stale clients fail explicitly instead of silently overwriting newer state.

### 3. Required event envelope

Every canonical event MUST include:

- `event_id`
- `stream` (`runtime` or `branch`)
- `branch_id` when applicable
- `seq` (monotonic within that stream)
- `type`
- `occurred_at`
- `schema_version`
- `actor_agent`
- `session_id` when applicable
- `command_id`
- `causation_id`
- `correlation_id`
- `payload`

Unknown fields in events MUST be preserved. Canonical events are write-once records.

### 4. Required event families

The architecture MUST support canonical events for at least these domains:

- `agent.*`, `profile.*`, `lock.*`, `migration.*`, `branch.*` in the runtime-global stream
- `session.*`, `conversation.*`, `message.*`, `task.*`, `workflow.*`, `workspace.*`, `decision.*`, `kb.*`, `review.*`, `dependency.*`, `vote.*`, `rule.*`, `progress.*`, `evidence.*` in branch-local streams

Synthetic helper notifications such as the current `fireEvent(...)` system messages are projections/side effects only. They are not canonical lifecycle truth.

### 5. Evidence-backed completion semantics

Any command that produces a terminal or advancement claim for work MUST carry evidence or be rejected.

At minimum, an evidence payload MUST include:

- `summary`
- `verification`
- `files_changed`
- `confidence`
- `recorded_at`
- `recorded_by_session`

Completion is authoritative only when the broker records an `evidence.*` event and the corresponding `task.*` / `workflow.*` completion event references that evidence record.

Consequences:

- a direct status flip to `done` without evidence is invalid,
- `dashboard.js::apiUpdateTask` style mutations are incompatible with the target contract,
- `verify_and_advance`-style flows become the model for completion, not a special case.

Historical legacy completions imported during migration that lack structured evidence MUST be marked as migrated legacy completions with an evidence-gap flag. They MUST NOT be silently upgraded into first-class evidence-backed completions.

## Branching / isolation semantics

### 1. Full-context branch rule

A LetThemTalk branch is a full branch-local runtime namespace.

Forking a branch MUST fork all branch-local agent-visible context, not only message/history files.

Branch-local state includes:

- messages and history,
- derived delivery/read state such as consumed offsets, acknowledgements, read receipts, compressed history, and non-general channel projections,
- tasks and workflows,
- workspace/memory state,
- decisions and KB,
- reviews, dependencies, progress, votes, rules,
- conversation mode, channels, manager/floor state, and similar conversation metadata,
- branch-local sessions and evidence records.

Task 4A freezes the implementation-driving detail for this section in `docs/architecture/branch-semantics.md`, including the two-bucket scope model, fork snapshot behavior, branch-local read/write resolution, and the current leak-priority order. That reference elaborates this section but MUST NOT contradict it.

### 2. Runtime-global exceptions

The following remain runtime-global because they describe the shared local runtime or shared working tree rather than branch reasoning state:

- agent registration/liveness,
- profiles,
- file locks,
- runtime manifest and migration metadata,
- explicitly non-canonical dashboard/operator state.

Locks are global because the underlying working tree is shared. Lock events MUST still record branch and session metadata so the UI can explain where a lock originated.

### 3. Fork semantics

When branch `B` is forked from branch `A` at event sequence `N`:

- the runtime-global stream records `branch.created`,
- branch `B` receives a seed snapshot/checkpoint representing the full branch-local state of `A` at `N`,
- branch `B` starts its own append-only branch event stream,
- subsequent events in `B` MUST NOT mutate `A`, and subsequent events in `A` MUST NOT mutate `B`.

Implementation may optimize seed creation, but the observable semantics above are fixed. The snapshot semantics for derived delivery state and live-session handling are further frozen in `docs/architecture/branch-semantics.md`.

### 4. Switch semantics

Switching branch changes the entire branch-local read/write view at once. It MUST NOT switch only message history while keeping tasks, workflows, or knowledge shared.

The current `getMessagesFile(...)` / `getHistoryFile(...)`-only branch isolation is explicitly insufficient and MUST be removed during migration.

### 5. Session scope / resumption semantics

A session is scoped to:

- one logical agent identity,
- one branch,
- one continuous execution interval between `session.started` and a terminal or interrupted state.

Rules:

- Re-registering the same logical agent on the same branch MUST resume the most recent resumable session when possible.
- Re-registering the same logical agent on a different branch MUST create or resume a different branch-scoped session; branch-local context MUST NOT be silently carried across branches.
- Branch switch MUST suspend the old branch session and create/resume the target branch session.
- A resumable session MUST surface outstanding tasks, pending workflow steps, recent conversation context, workspace state pointers, and recent evidence/completion claims relevant to that branch.
- Session identity MUST be included in all branch-local canonical events.

Required session states are:

- `active`
- `interrupted`
- `completed`
- `failed`
- `abandoned`

If an agent process disappears without a terminal session event, the broker MUST synthesize `session.interrupted` or `session.abandoned` according to timeout policy; it MUST NOT pretend the session completed successfully.

## Versioning / migration / compatibility

### 1. Manifest

The runtime MUST publish a version manifest at startup and after every migration.

`manifest.json` MUST include at least:

- `runtime_contract_version` (semantic version for this architecture contract)
- `storage_format_version` (integer or integer-major semantic for on-disk compatibility)
- `min_reader_format_version`
- `min_writer_format_version`
- `migrations_applied`
- `created_at`
- `last_migrated_at`

### 2. Version rules

- Incompatible on-disk changes require a storage format major bump.
- Additive event payload fields MAY be minor changes if old readers can safely preserve and ignore them.
- Removing or reinterpreting event meaning is a breaking change and requires a major bump.
- Projections MAY evolve more frequently than canonical streams, but projection rebuild from the canonical stream MUST stay deterministic for a given storage format version.

### 3. Unknown-format behavior

Fail closed is mandatory.

- If runtime code sees a storage format newer than it supports, it MUST refuse canonical writes.
- It MAY expose a minimal unsupported-format diagnostic, but it MUST NOT attempt best-effort mutation.
- If a projection builder encounters an unknown event type or schema version in an otherwise supported stream, it MUST preserve the raw event and mark the affected projection as stale/unsupported rather than dropping or rewriting the event.

### 4. Migration policy

Migrations MUST be explicit, idempotent, and evidenceable.

The required migration order is:

1. create manifest and broker lease support,
2. introduce canonical event streams,
3. backfill/import legacy state into canonical events,
4. rebuild projections from canonical events,
5. switch dashboard/CLI/API-agent callers to broker-only commands,
6. reject/remove direct-write legacy paths,
7. retain compatibility projections only as long as necessary.

Every migration MUST record:

- source format version,
- target format version,
- backup location,
- start and finish timestamps,
- success/failure status.

Migration hardening is not complete until deterministic validation proves both canonical-first rebuild and explicit rejection of legacy-only rollback assumptions. Task 13C freezes that validator-facing slice in `docs/architecture/runtime-migration-hardening.md`.

## Failure, rollback, and recovery

### 1. Crash and partial failure rules

- If event append fails, the command fails and no state transition occurred.
- If event append succeeds but projection update fails, the event remains canonical and the affected projection becomes stale until rebuild succeeds.
- Stale projections MUST be detectable; silent fallback to corrupted or partially rebuilt projections is forbidden.

### 2. Recovery model

- Projections and snapshots MUST be rebuildable from canonical events.
- Session recovery MUST use canonical session/evidence/task/workflow data, not heuristics over whatever files happen to exist.
- Dead-agent lock cleanup is a compensating runtime action, not a silent deletion of canonical history.

### 3. Rollback policy

Operational rollback uses compensating events or branch restore, not in-place canonical history edits.

- Incorrect task completion -> append corrective event.
- Incorrect message removal -> append redaction reversal/correction event if supported.
- Broken projection -> rebuild projection.
- Failed migration -> restore the pre-migration backup and record the failed migration in the manifest/history.
- Missing canonical stream with surviving compatibility projections -> fail explicit rebuild/rollback checks instead of promoting the projection back to authority.

Canonical event logs MUST NOT be rewritten as a normal rollback mechanism.

## Verification expectations

Later implementation tasks are not complete until they can produce evidence that the runtime obeys this contract.

At minimum, verification MUST prove:

1. only the broker lease holder can mutate canonical event streams,
2. dashboard, CLI, and API-agent flows route through broker commands instead of direct canonical writes,
3. message edit/delete behavior is append-only at the canonical layer,
4. branch fork/switch isolates all branch-local state, not only messages/history,
5. session resumption is branch-scoped and surfaces outstanding work,
6. completion without evidence is rejected,
7. unknown/newer storage formats refuse writes,
8. projections can be rebuilt from canonical events after deletion or corruption,
9. compatibility projections are rejected as rollback authority when the corresponding canonical stream is missing.

The future validator and invariant checks MAY evolve, but they MUST test against these behaviors rather than weaker file-existence checks.

## Alternatives / drawbacks

- A single local broker is stricter than the current shared-file free-for-all and introduces IPC/forwarding work.
- Append-only events use more disk than in-place JSON rewrites.
- Full-context branch snapshots duplicate data or require snapshot optimization.
- Runtime-global locks plus branch-local task state create a deliberate two-scope model that implementers must keep straight.
- Event import of legacy data with evidence gaps means some historical records will remain explicitly “legacy” rather than perfectly normalized.

These drawbacks are accepted because they buy deterministic authority, replay, recovery, and verification.

## Open questions / future evolution

The following are intentionally left open because they do not block Phase 1 implementation of this contract:

- whether branches later support merge/cherry-pick semantics or remain isolation-only,
- whether any currently non-canonical dashboard/operator state should eventually move under broker governance,
- retention/compaction policy for old snapshots and projections once rebuild tooling exists.
