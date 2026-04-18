# LetThemTalk Upgrade Summary

Status: implementation summary for future agents and maintainers  
Audience: engineers, agent authors, operators, reviewers  
Last updated: 2026-04-18

## What this file is

This file explains the major runtime, dashboard, verification, provider, branch, session, and knowledge-workspace upgrades that were implemented in this repository.

It is not the normative contract. For rules and guarantees, treat these files as the source of truth:

- `docs/architecture/runtime-contract.md`
- `docs/architecture/branch-semantics.md`
- `docs/architecture/canonical-event-schema.md`
- `docs/architecture/markdown-workspace.md`
- `docs/architecture/runtime-migration-hardening.md`

This file answers a different question:

> “What changed in practice, where did it land, and how should future agents think about the upgraded system?”

---

## High-level before/after

### Old mental model

LetThemTalk used to be much closer to:

- many processes rewriting shared JSON / JSONL files,
- branching mostly centered on message/history files,
- session recovery mostly heuristic,
- dashboard acting as both UI and a second authority writer,
- provider capability mostly inferred from provider names or ad hoc fields,
- completion often being conversational rather than evidence-backed.

### New mental model

LetThemTalk now behaves much more like a local collaboration runtime with clear layering:

1. **Canonical runtime truth**  
   Owned by broker/canonical helpers, event-backed, projection-driven.

2. **Branch-local execution contexts**  
   Branches are no longer just alternate message logs; they are real collaboration namespaces.

3. **Session/evidence-aware work model**  
   Session state, evidence references, and stronger completion semantics now exist.

4. **Explicit provider/runtime descriptors**  
   API/non-CLI agents are closer to first-class runtime citizens.

5. **Dashboard as control plane client**  
   The dashboard is more strongly broker-backed and less of a shadow writer.

6. **One-way markdown workspace export**  
   Obsidian-friendly, but explicitly non-authoritative.

7. **Scripted grouped verification**  
   A real verification surface now exists.

---

## Major architectural changes

## 1. Canonical runtime authority

### What changed

- Canonical runtime truth was centralized around shared canonical/state helpers instead of leaving direct state mutation scattered across server, dashboard, CLI, and API-agent code.
- The system now leans on explicit canonical helpers and event-backed/projection-backed semantics rather than raw JSON mutation as the primary model.

### Main implementation anchors

- `agent-bridge/state/canonical.js`
- `agent-bridge/state/io.js`
- `agent-bridge/state/messages.js`
- `agent-bridge/state/agents.js`
- `agent-bridge/state/tasks-workflows.js`
- `agent-bridge/server.js`

### Why it matters

Future changes should prefer canonical helper APIs first, not direct file edits in random modules.

---

## 2. Canonical events + replay/materialization

### What changed

- Canonical event schema is now explicit.
- Message/event replay and projection materialization were implemented and hardened.
- Message edit/delete now use canonical event-backed behavior instead of only projection surgery.
- Replay failure cases are validator-covered.

### Main implementation anchors

- `agent-bridge/events/schema.js`
- `agent-bridge/events/log.js`
- `agent-bridge/events/replay.js`
- `agent-bridge/state/messages.js`
- `agent-bridge/scripts/check-event-schema.js`
- `agent-bridge/scripts/check-message-replay.js`

### Why it matters

Canonical events are now real runtime infrastructure, not just a design idea.

---

## 3. Branches as full execution contexts

### What changed

- Branches now isolate far more than message/history.
- Branch-local scope now includes:
  - messages/history
  - delivery/read state
  - conversation control
  - non-general channels
  - tasks/workflows
  - workspaces
  - governance/collaboration surfaces
  - sessions
  - evidence
- Fork-time snapshot behavior was expanded to include newly branch-local surfaces.

### Main implementation anchors

- `docs/architecture/branch-semantics.md`
- `agent-bridge/state/canonical.js`
- `agent-bridge/state/tasks-workflows.js`
- `agent-bridge/server.js`
- `agent-bridge/scripts/check-branch-isolation.js`
- `agent-bridge/scripts/check-branch-fork-snapshot.js`

### Important current shipped branch-local governance surfaces

These are now branch-local in shipped behavior, not just in docs:

- decisions
- KB
- reviews
- dependencies
- votes
- rules
- progress

---

## 4. Sessions and evidence-backed completion

### What changed

- Sessions became first-class branch-scoped records.
- A runtime-global discovery index exists, but branch-local session manifests are the authority.
- Completion/advancement now records evidence by reference.
- `get_briefing()` and `get_work()` became more session/evidence-aware.

### Main implementation anchors

- `agent-bridge/state/sessions.js`
- `agent-bridge/state/evidence.js`
- `agent-bridge/state/canonical.js`
- `agent-bridge/server.js`
- `agent-bridge/scripts/check-session-lifecycle.js`
- `agent-bridge/scripts/check-evidence-completion.js`
- `agent-bridge/scripts/check-session-aware-context.js`

### Why it matters

Serious completion is no longer “a message that says done.” It has runtime shape now.

---

## 5. Explicit provider/runtime descriptor model

### What changed

- Provider/runtime identity is now represented explicitly with a shared descriptor model.
- API agents were upgraded first.
- Compatibility fields still exist, but they are projections/fallbacks rather than the preferred model.

### Descriptor fields

- `runtime_type`
- `provider_id`
- `model_id`
- `capabilities`

### Main implementation anchors

- `agent-bridge/runtime-descriptor.js`
- `agent-bridge/api-agents.js`
- `agent-bridge/providers/`
- `agent-bridge/dashboard.js`
- `agent-bridge/office/agents.js`
- `agent-bridge/scripts/check-provider-capabilities.js`
- `agent-bridge/scripts/check-api-agent-parity.js`

### Why it matters

Mixed-provider coordination is much less heuristic now.

---

## 6. Lifecycle hooks and advisory contracts

### What changed

- Hooks are now a derived post-commit layer over canonical events.
- Contracts/archetypes/skills are explicit enough to influence guidance and work selection.
- Advisory-first rollout landed before broader enforcement.
- Managed/team flows now consume shared contract/hook helpers instead of duplicating policy logic.

### Main implementation anchors

- `agent-bridge/events/hooks.js`
- `agent-bridge/agent-contracts.js`
- `agent-bridge/managed-team-integration.js`
- `agent-bridge/server.js`
- `agent-bridge/scripts/check-lifecycle-hooks.js`
- `agent-bridge/scripts/check-agent-contract-advisory.js`
- `agent-bridge/scripts/check-managed-team-integration.js`

### Why it matters

The system can now express “what kind of agent is this?” and “what should it be doing?” more clearly.

---

## 7. Autonomy-v2

### What changed

- `get_work` is no longer just a heuristic pile; it now uses stronger context:
  - canonical state
  - sessions
  - evidence
  - provider capabilities
  - contract metadata
- Watchdog/retry/escalation became explicit policy.
- Bounded ownership changes are possible and validator-covered.

### Main implementation anchors

- `agent-bridge/autonomy/decision-v2.js`
- `agent-bridge/autonomy/watchdog-policy.js`
- `agent-bridge/server.js`
- `agent-bridge/scripts/check-autonomy-v2-decision.js`
- `agent-bridge/scripts/check-autonomy-v2-watchdog.js`
- `agent-bridge/scripts/check-autonomy-v2-execution.js`

### Why it matters

Autonomy is now much more deliberate, and much less accidental.

---

## 8. Dashboard control-plane refactor

### What changed

- Dashboard mutator routes were progressively pushed behind canonical helpers.
- Dashboard query logic was extracted into shared helpers.
- Branch-aware reads/search/export/control behavior was tightened.
- Known semantic gaps (like canonical message edit/delete support) were turned into real implementations rather than expected-failure placeholders.

### Main implementation anchors

- `agent-bridge/dashboard.js`
- `agent-bridge/state/dashboard-queries.js`
- `agent-bridge/state/canonical.js`
- `agent-bridge/scripts/check-dashboard-control-plane.js`

### Important runtime behavior upgrades

- Add Project now really initializes a folder, not just registers it.
- Respawn prompt flow is branch-aware end to end.
- Clear Messages and task/workflow routes are consistent with the current canonical model.

---

## 9. Dashboard UX upgrades

### What changed

- Browser-persisted workspaces/layouts were added.
- Omnibox/command-palette behavior was added on top of the search bar.
- Typed agent metadata drawer was added.
- An optional Graph view was added as a secondary operator visualization.

### Main implementation anchors

- `agent-bridge/dashboard.html`

### Design intent

- Browser-first persisted UX
- low churn
- graph is secondary, not primary navigation

---

## 10. Office / 3D environment improvements

### What changed

- Office-side API scoping was cleaned up.
- stale/removed agent rendering bugs were fixed
- duplicate placement restore bugs were fixed
- builder undo/redo identity drift was fixed
- drone/free-fly floor jitter was fixed by flattening forward thrust to the horizontal plane

### Main implementation anchors

- `agent-bridge/office/index.js`
- `agent-bridge/office/agents.js`
- `agent-bridge/office/builder.js`
- `agent-bridge/office/world-save.js`
- `agent-bridge/office/spectator-camera.js`

---

## 11. Markdown workspace export

### What changed

- One-way markdown export now exists.
- It is explicitly non-authoritative.
- Export structure and safety are both validator-backed.
- The packaged `agent-bridge` tarball now ships the architecture docs and usage docs it references.

### Main implementation anchors

- `docs/architecture/markdown-workspace.md`
- `agent-bridge/state/markdown-workspace.js`
- `agent-bridge/scripts/export-markdown-workspace.js`
- `agent-bridge/scripts/check-markdown-workspace-export.js`
- `agent-bridge/scripts/check-markdown-workspace-safety.js`
- `agent-bridge/scripts/sync-packaged-docs.js`
- `agent-bridge/package.json`

### Important rule

Markdown is **export/output**, not canonical runtime input.

---

## 12. Verification surface

### What changed

This repo now has a serious grouped verification surface.

### Main commands

From repo root:

```bash
npm test
npm --prefix agent-bridge run verify
npm --prefix agent-bridge run verify:contracts
npm --prefix agent-bridge run verify:replay
npm --prefix agent-bridge run verify:invariants
npm --prefix agent-bridge run verify:smoke
npm --prefix agent-bridge run verify:docs-onboarding
```

### What it covers

- runtime contract
- event schema
- branch semantics
- markdown workspace contract/export/safety
- replay (+ negative scenarios)
- authority routing
- dashboard control plane
- performance/indexing
- provider capabilities + API-agent parity
- sessions/evidence/session-aware context
- autonomy-v2
- contracts/hooks/managed-team integration
- docs onboarding

---

## 13. Local dev/runtime data-dir fix

### What changed

The local development runtime now correctly uses repo-root `.agent-bridge` instead of accidentally defaulting to `agent-bridge/.agent-bridge` when running from the package subtree.

### Main implementation anchors

- `agent-bridge/data-dir.js`
- `agent-bridge/server.js`
- `agent-bridge/dashboard.js`
- `agent-bridge/cli.js`

### Why it matters

This prevents local personal/runtime state from leaking into the publishable package subtree.

---

## 14. Add Project initialization flow

### What changed

Adding a project from the dashboard now performs real initialization for the target folder instead of only registering the path.

That means the target folder now gets:

- `.agent-bridge/launch.js`
- `.mcp.json`
- `.gemini/settings.json`
- `.codex/config.toml`
- `.gitignore`

### Main implementation anchors

- `agent-bridge/dashboard.js`
- `agent-bridge/dashboard.html`
- `agent-bridge/cli.js`

### Important operational note

For a newly added folder, the dashboard can now make it actually launchable, not just visible.

---

## 15. Package/publish realism

### What changed

The `agent-bridge` package `files` whitelist was updated so the tarball actually includes the runtime modules, scripts, docs, and usage files its help/docs point to.

### Main implementation anchors

- `agent-bridge/package.json`

### Why it matters

Published package users now receive the actual local docs/runtime surface they are told to use.

---

## Day-to-day operator model now

## Best modern agent loop

For agents/terminals, the expected happy path is now:

1. `register`
2. `get_briefing()`
3. `get_guide()` when guidance/rules are needed
4. `listen()` or `listen_group()`
5. `get_work()` for structured/autonomous work selection
6. evidence-backed completion / workflow advancement when finishing real work

`listen()` and `listen_group()` still matter, but they are now sitting on top of a much stronger runtime substrate.

## Best operator loop

- launch project
- use dashboard as control plane
- use branches as real work contexts
- use markdown workspace as export/browsing, not truth
- run grouped verification regularly

---

## Important caveats for future agents

- Prefer canonical helpers over direct file edits.
- Prefer branch-aware reads/writes everywhere in collaboration state.
- Prefer validator-backed slices over “just changing one thing quickly.”
- Prefer explicit runtime truth over convenience projections.
- If you change docs, keep them aligned with:
  - runtime contract
  - branch semantics
  - markdown workspace contract
  - package command surface

---

## What this upgrade does NOT mean

- It does **not** mean markdown is authoritative.
- It does **not** mean the dashboard should become a second broker.
- It does **not** mean every future feature should bypass the canonical layer.
- It does **not** mean browser/UI automation coverage exists for everything.
- It does **not** mean you should publish immediately without your own approval.

---

## Suggested next read order for future agents

1. `docs/architecture/runtime-contract.md`
2. `docs/architecture/branch-semantics.md`
3. `docs/architecture/canonical-event-schema.md`
4. `docs/architecture/markdown-workspace.md`
5. `docs/architecture/runtime-migration-hardening.md`
6. this file

Then inspect:

1. `agent-bridge/state/canonical.js`
2. `agent-bridge/server.js`
3. `agent-bridge/dashboard.js`
4. `agent-bridge/dashboard.html`
5. `agent-bridge/package.json`

---

## Bottom line

LetThemTalk is no longer just a shared-file chat bridge with a dashboard.

It is now a much more structured local collaboration runtime with:

- canonical runtime authority
- event-backed projections
- real branch execution contexts
- sessions and evidence
- provider/runtime capabilities
- lifecycle hooks and contracts
- autonomy-v2
- stronger operator UX
- non-authoritative markdown export
- grouped deterministic verification

Future agents should build on that model, not on the older “many files, many writers, best effort coordination” mental model.
