<!-- Generated from ../docs/architecture/runtime-migration-hardening.md by scripts/sync-packaged-docs.js for published package consumers. -->

# LetThemTalk Runtime Migration Hardening Reference

Status: normative Task 13C hardening slice  
Normative parent: `docs/architecture/runtime-contract.md`  
Branch semantics companion: `docs/architecture/branch-semantics.md`  
Current-code anchors: `state/canonical.js`, `events/log.js`, `scripts/check-migration-hardening.js`  
Last updated: 2026-04-16

This page freezes the architecture-facing migration, rollback, and hardening rules that Task 13 needs before the broader Task 14 docs refresh. It stays on runtime authority, compatibility projections, and deterministic validation. It does not broaden into public or operator guidance.

## Cutover invariants

- Canonical rollback and rebuild inputs are the append-only event streams under `.agent-bridge/runtime/` plus explicit migration backups.
- Legacy filenames such as `messages.jsonl`, `history.jsonl`, `tasks.json`, and `workflows.json` are compatibility projections during migration. They are not rollback authority.
- If a compatibility projection exists without its canonical event stream, rebuild and rollback checks MUST fail explicitly instead of silently promoting the projection back to authority.
- Unknown or newer storage formats remain fail-closed. Unsupported runtimes may emit diagnostics, but they MUST NOT resume canonical writes.
- Migration cutover is not complete while any required collaboration surface still depends on a message-only branch switch or any other partial branch fallback. `docs/architecture/branch-semantics.md` remains normative for that scope.

## Rollback and recovery rules

- Projection corruption or projection deletion, rebuild from canonical events.
- Incorrect runtime state after cutover, append compensating canonical events when the domain supports them.
- Failed migration, restore the pre-migration backup and keep a recorded failed migration outcome.
- Canonical event logs MUST NOT be rewritten as a normal rollback mechanism.
- Legacy compatibility projections MUST NOT be used to recreate canonical history after cutover.

## Stale transitional assumptions that stay invalid

| Stale assumption | Hardening rule | Current guard or validator |
| --- | --- | --- |
| Legacy `messages.jsonl` or `history.jsonl` can stand in for a missing canonical branch event log during rebuild | Invalid. A missing canonical branch stream with surviving legacy projections is a fail-closed condition. | `state/canonical.js::rebuildMessageProjections()` plus `scripts/check-migration-hardening.js` |
| Compatibility projections can become rollback authority because they still use old filenames | Invalid. Old filenames remain projections only. | `docs/architecture/runtime-contract.md` and this reference |
| Rollback can rewrite append-only canonical history in place | Invalid. Rollback uses compensating events, projection rebuild, or pre-migration backup restore. | `docs/architecture/runtime-contract.md` and `scripts/check-migration-hardening.js` |
| Message-only branch switching is enough to claim migration cutover is hardened | Invalid. Full branch-local state isolation stays required. | `docs/architecture/branch-semantics.md` and `scripts/check-branch-isolation.js` |
| Unsupported storage formats may keep writing canonically if a projection looks readable | Invalid. Unknown or newer formats fail closed. | `docs/architecture/runtime-contract.md` and `scripts/check-migration-hardening.js` |

## Guarded runtime slice in current code

Task 13C hardens the first migrated runtime slice where the code already has canonical branch events and compatibility projections:

- branch-local `message.sent` events under `.agent-bridge/runtime/branches/<branch>/events.jsonl`,
- compatibility message projections under `messages.jsonl`, `history.jsonl`, and their branch-prefixed variants,
- deterministic rebuild through `createCanonicalState().rebuildMessageProjections(...)`,
- explicit failure when a rebuild sees surviving compatibility projections but no canonical branch event stream.

This is intentionally narrow. It does not claim that the full manifest-driven storage migration is finished. It freezes the rule, the first fail-closed guard, and the validator surface that later migration work must extend instead of weakening.

## Validation path

Healthy validation:

```bash
node scripts/check-migration-hardening.js
```

Expected-failure legacy-path simulation:

```bash
node scripts/check-migration-hardening.js --scenario legacy-projection-without-canonical-log
```

The second command exits `1` by design. It proves the runtime does not treat surviving compatibility projections as rollback authority when the canonical branch event stream is missing.
