# LetThemTalk Branch Semantics Reference

Status: normative current-runtime branch reference  
Normative parent: `docs/architecture/runtime-contract.md`  
Schema companion: `docs/architecture/canonical-event-schema.md`  
Current-code anchors: `agent-bridge/server.js`, `agent-bridge/state/canonical.js`, `agent-bridge/state/tasks-workflows.js`, `agent-bridge/state/agents.js`, `agent-bridge/dashboard.js`  
Last updated: 2026-04-17

This document freezes the implementation-driving meaning of the runtime-contract rule that a branch is a full-context namespace. It reflects the shipped runtime after the branch-local isolation work for delivery and read state, conversation control, non-general channels, workspaces, tasks, workflows, governance surfaces, sessions, and evidence.

Legacy compatibility filenames remain implementation details during migration. They are not a third semantic bucket, and they do not change the rule that agent-visible collaboration state belongs to the branch-local bucket.

## Two-bucket scope model

### Runtime-global bucket

Runtime-global state is the small set that describes the shared local runtime or shared working tree rather than branch reasoning state.

Canonical runtime-global state:
- agent registry, liveness, heartbeat, branch pointer, and session/branch discovery indexes,
- profiles,
- file locks,
- branch registry plus runtime manifest/migration metadata.

Runtime-owned but non-canonical shared state:
- plugin registry/code,
- dashboard discovery, LAN/auth/operator settings, and project lists,
- temp files, lock files, migration backups, and similar operational artifacts.

Forking or switching branches MUST NOT clone, fork, or reinterpret this bucket.

### Branch-local bucket

Branch-local state is every agent-visible collaboration or reasoning surface.

Shipped branch-local state today:
- messages/history and canonical branch message events,
- delivery/read state such as consumed offsets, acknowledgements, read receipts, and compressed history,
- conversation mode, managed-floor state, phase state, and non-general channel state,
- workspaces,
- decisions, KB, reviews, dependencies, votes, rules, and progress,
- sessions and evidence,
- tasks and workflows.

Derived branch-local read models:
- channel projections and other per-branch read models derived from branch-local events.

Switching branches MUST replace the whole migrated branch-local bucket at once. It MUST NOT switch only message/history while leaving the rest shared. The shipped runtime already does that for the branch-local domains above.

## Fork-time snapshot semantics

### Inherited branch-local state

Branch creation snapshots the migrated branch-local state that the current fork implementation explicitly copies from the source branch at the fork point. Snapshot inheritance is copy-on-fork, not a live overlay.

The inherited snapshot includes:
- visible messages/history at the fork point,
- delivery/read state and channel projections needed to preserve what each agent had already consumed, acknowledged, or read at the fork point,
- conversation metadata and non-general channel state,
- governance state such as decisions, KB, reviews, dependencies, votes, rules, and progress,
- task/workflow state,
- historical evidence context relevant to the copied branch-local state, including preserved session references inside copied evidence.

Implementations may materialize the snapshot eagerly or lazily, but reads in the new branch MUST behave as if this full snapshot existed from branch creation onward.

### Non-inherited / shared runtime state

The runtime-global bucket remains shared across branches and is not copied into a new namespace. That includes agent liveness, profiles, locks, branch registry, manifest/migration state, and runtime-owned operator/discovery files.

File locks stay global because the working tree is shared. Lock records may carry branch/session metadata for audit or UI explanation, but the lock scope itself is runtime-global.

### Session and evidence snapshot rules

Historical evidence records are inherited as branch-local context. Active sessions do not stay live across a fork, and the target branch does not start with copied session manifests or cloned live execution.

The first post-fork action on the target branch MUST create or resume a distinct branch-scoped session. After the fork, new evidence recorded in one branch MUST NOT appear in the other branch unless a later explicit cross-branch feature is introduced.

## Branch-local read/write resolution

### Read resolution

A branch-local read resolves against exactly one branch namespace.

Resolution order:
1. explicit `branch_id`, if provided;
2. otherwise the caller's active session branch;
3. otherwise reject the read as under-scoped.

A branch-local read MUST NOT fall back to another branch, to `main`, or to a shared global collaboration file. If a projection is missing or stale, the runtime rebuilds it from the target branch snapshot/events for that same branch.

### Write resolution

A branch-local write resolves against exactly one target branch.

Rules:
- mutating collaboration commands write to the caller's explicit `branch_id` or active session branch,
- the write appends canonical events and/or updates projections for that branch only,
- branch-local writes in branch `B` MUST NOT mutate branch `A`,
- compatibility-shared legacy filenames during migration are leak points, not semantic exceptions.

Runtime-global writes ignore branch switching for scope purposes, although they may record origin branch/session metadata when that helps explain the action.

### Missing projection / rebuild behavior

Projection absence does not widen scope. Missing branch-local projections are rebuilt from the target branch snapshot and subsequent branch-local events. They are never reconstructed by reading another branch's projection or by treating a global legacy file as the branch source of truth.

## Domain matrix

| Domain | Current storage/runtime reality | Frozen target scope | Fork-time inheritance | Read/write resolution | Migration priority |
| --- | --- | --- | --- | --- | --- |
| Messages / history / canonical message events | `server.js` and `state/canonical.js` resolve branch-specific message/history files and branch-local canonical message events | Branch-local | Snapshot visible conversation at fork point, then diverge independently | Read/write only against the selected branch stream/projections | Shipped |
| Delivery/read markers (`consumed-*`, acknowledgements, read receipts, compressed history) | `state/canonical.js` resolves branch-specific `acks.json`, `read_receipts.json`, `compressed.json`, and `consumed-*` files | Branch-local derived state | Snapshot marker state at fork point | Resolve inside the active branch namespace; no cross-branch fallback | Shipped |
| Conversation metadata and non-general channels | `state/canonical.js` resolves branch-specific `config.json`, `channels.json`, and non-general channel message/history files | Branch-local | Snapshot mode, phase, manager/floor, membership, and channel history state | Branch switch flips the whole conversation namespace at once | Shipped |
| Tasks | `state/tasks-workflows.js` and `state/canonical.js` resolve `tasks.json` on `main` and `branch-<branch>-tasks.json` elsewhere through branch-aware mutators and dashboard reads | Branch-local | Snapshot copied at fork point | Read/write only inside target branch | Shipped |
| Workflows | `state/tasks-workflows.js`, `state/canonical.js`, and `dashboard.js` resolve branch-specific workflow files and branch-aware plan reads | Branch-local | Snapshot copied at fork point | Read/write only inside target branch | Shipped |
| Workspaces | `state/canonical.js`, `server.js`, and `dashboard.js` resolve `workspaces/<agent>.json` on `main` and `branch-<branch>-workspaces/<agent>.json` elsewhere through branch-aware reads, writes, and export paths | Branch-local per-agent state | Snapshot copied at fork point | Read/write only inside the selected branch workspace namespace | Shipped |
| Decisions / KB / reviews / dependencies / votes / rules / progress | `state/canonical.js`, `server.js`, `dashboard.js`, and markdown/export validators resolve branch-specific governance projections through canonical branch-aware helpers (`decisions.json` on `main`, `branch-<branch>-*.json` elsewhere) | Branch-local | Snapshot copied at fork point | Read/write only inside target branch; cross-branch summaries iterate branch-local views explicitly | Shipped |
| Sessions / evidence | Runtime branch session manifests live under `.agent-bridge/runtime/branches/<branch>/sessions/`, with a runtime-global `sessions-index.json` plus branch-specific evidence stores | Branch-local with a runtime-global discovery index | Historical evidence context copies; live sessions do not stay active in the forked branch, and session manifests are not fork-copied | Branch switch suspends one branch session and creates/resumes another | Shipped |
| Agent registry / profiles | `state/agents.js` persists shared `agents.json`, `profiles.json`, and heartbeat files | Runtime-global | Shared, not copied | Branch switch updates discovery metadata, not branch-local collaboration state | Stay global |
| Locks / branch registry / manifest / migration metadata | Shared working-tree/runtime surfaces | Runtime-global | Shared, not copied | Never branch-local | Stay global |

## Current leak points / migration-first priorities

### Former P0 leaks now closed

The following Task 4 P0 leak statements are historical reference points now, not current runtime truth:

1. Delivery/read state is still effectively global.
2. Conversation control and non-general channels still leak.
3. Forking is still message-centric.

The shipped runtime now isolates those domains with branch-scoped files and branch-aware reads. `check-branch-isolation.js` is the current proof surface for that shipped behavior.

### Remaining compatibility-shared gaps

There are no remaining agent-visible collaboration surfaces that intentionally resolve through shared compatibility governance files in the shipped runtime.

### Next domains to move branch-local

Tasks, workflows, delivery/read state, conversation control, non-general channels, workspaces, governance surfaces, sessions, and evidence are already in the shipped branch-local slice. Future branch work can focus on new features rather than finishing compatibility-shared governance migration.

## Validation path

Run the Task 4A checker with:

```bash
node agent-bridge/scripts/check-branch-semantics.js
```

That validator proves the reference still contains:
- the two-bucket model,
- fork-time snapshot rules,
- branch-local read/write resolution rules,
- the domain matrix,
- the named closed P0 leaks, remaining compatibility gaps, and migration priorities.
