<!-- Generated from ../docs/architecture/markdown-workspace.md by scripts/sync-packaged-docs.js for published package consumers. -->

# Markdown Workspace Reference

Status: Task 9A projection-first reference  
Normative parents: `docs/architecture/runtime-contract.md`, `docs/architecture/branch-semantics.md`  
Schema companion: `docs/architecture/canonical-event-schema.md`  
Current code anchors: `state/canonical.js`, `state/dashboard-queries.js`, `dashboard.js`, `dashboard.html`  
Last updated: 2026-04-17

This document freezes the first markdown-workspace contract for LetThemTalk. It is intentionally narrow and implementation-driving for Task 9B: it defines the generated markdown workspace structure, the authority boundary between markdown and runtime state, the current export-source mapping, and the minimum validation markers that must stay true after the branch-local workflow and plan-view export work.

This slice does **not** implement write-back, live sync, watcher loops, or markdown import.

## Non-authoritative authority model

Markdown files are rebuilt from canonical and legacy-compat read models and never treated as runtime inputs.

Authority is frozen as follows:

- Canonical runtime truth remains the broker-owned event/projection model defined in `docs/architecture/runtime-contract.md`.
- Markdown export is one-way by default: runtime -> markdown workspace.
- Every exported markdown file MUST set `authoritative: false` in frontmatter.
- Task 9B MUST NOT implement write-back or live sync loops.
- The dashboard, CLI, or broker MUST NOT watch markdown edits and reinterpret them as canonical updates.
- Any future import must be explicit and broker-mediated.
- Missing, stale, deleted, or manually edited markdown files MUST NOT change runtime behavior.

## Workspace root / layout

Default export root: `<repo>/.agent-bridge-markdown/`

The first safe workspace root lives outside `.agent-bridge/` so runtime storage and markdown projections stay visibly separate.

```text
.agent-bridge-markdown/
  README.md
  branches/
    index.md
    <branch>/
      metadata.md
      conversations/
        index.md
        channels/
          general.md
          <channel>.md
      decisions/
        index.md
      sessions/
        index.md
        <session-id>.md
      evidence/
        index.md
      workspaces/
        index.md
        agents/
          <agent>.md
      plans/
        status.md
        report.md
  project/
    notes/
      project-notes.md
      team-notes.md
```

Required meaning of the first safe structure:

- `README.md` is the generated workspace landing page and repeats the non-authoritative rule.
- `branches/index.md` lists known branches and points at `branches/<branch>/metadata.md`.
- `branches/<branch>/metadata.md` is the first branch metadata page.
- `conversations/` is the conversation export area for that branch.
- `decisions/`, `sessions/`, `evidence/`, `workspaces/`, and `plans/` are exported from branch-local read surfaces for every branch.
- `project/notes/project-notes.md` and `project/notes/team-notes.md` are generated cross-branch summaries built from branch-local governance surfaces, not editable runtime inputs.

## Required generated frontmatter

### Common frontmatter

Every exported markdown file MUST carry this minimum frontmatter contract:

```yaml
ltt_schema: markdown-workspace/v1
doc_kind: <kind>
authoritative: false
branch: <branch-id-or-null>
projection_of: <domain-or-view>
source_surface: <read-surface>
source_scope: <branch_local|runtime_global|compatibility_shared|main_branch_only>
source_sequence: <stream-seq-or-null>
generated_at: <iso-timestamp>
generated_by: let-them-talk-markdown-export
```

The key meanings are frozen:

- `doc_kind` identifies the page role.
- `projection_of` names the runtime domain or export view being projected.
- `source_surface` names the read seam used to build the file.
- `source_scope` states whether the source is already branch-local or still compatibility-shared.
- `source_sequence` records the event-stream or projection sequence the markdown snapshot was generated from when one exists.

### Kind-specific frontmatter

Task 9B MUST add the following kind-specific keys on the first safe pages:

| File kind | Required extra keys |
| --- | --- |
| `branch-metadata` | `branch_parent`, `branch_source` |
| `conversation-index` | `channel_count`, `message_count` |
| `conversation-transcript` | `channel`, `message_count` |
| `decision-index` | `decision_count` |
| `session-index` | `session_count` |
| `session-detail` | `session_id`, `session_state` |
| `evidence-index` | `evidence_count` |
| `workspace-index` | `agent_count` |
| `workspace-agent` | `agent`, `key_count` |
| `plan-status` | `workflow_id`, `workflow_status` |
| `plan-report` | `workflow_id`, `workflow_status` |
| `project-note` | `note_scope` |
| `team-note` | `note_scope` |

For aggregated plan pages that summarize more than one workflow, `workflow_id` and `workflow_status` MAY be `null`.

## Export-source mapping

Task 9B should assemble markdown through `state/canonical.js` and add thin read-only wrappers there for domains that still live in legacy compatibility files today.

| Markdown output | Current source surface | Current scope rule | Task 9B note |
| --- | --- | --- | --- |
| `branches/index.md` | `.agent-bridge/branches.json` plus branch directories under `.agent-bridge/runtime/branches/` | runtime-global branch registry | Build one branch registry page; do not infer hidden branches. |
| `branches/<branch>/metadata.md` | `.agent-bridge/branches.json` plus branch runtime presence | runtime-global branch registry with branch identity | Safe for every known branch. |
| `branches/<branch>/conversations/index.md` and `branches/<branch>/conversations/channels/*.md` | `createCanonicalState().getConversationMessages({ branch })`, `getHistoryView({ branch })`, `getChannelsView({ branch })` | branch-local | Use the selected branch only. |
| `branches/<branch>/decisions/index.md` | `createCanonicalState().listDecisions({ branch })` | branch-local | Export the selected branch decision log only. |
| `branches/<branch>/sessions/index.md` and `branches/<branch>/sessions/<session-id>.md` | `.agent-bridge/runtime/projections/sessions-index.json` and `.agent-bridge/runtime/branches/<branch>/sessions/*.json` | branch-local with runtime-global discovery index | Index pages summarize branch-local sessions; detail pages point at branch session manifests. |
| `branches/<branch>/evidence/index.md` | `createCanonicalState().readEvidence(branch)` plus `projectEvidence(...)` enrichment | branch-local | Export evidence indexes from the branch evidence store only. |
| `branches/<branch>/workspaces/index.md` and `branches/<branch>/workspaces/agents/<agent>.md` | `createCanonicalState().listWorkspaces({ branch })` over `workspaces/<agent>.json` on `main` and `branch-<branch>-workspaces/<agent>.json` elsewhere | branch-local | Export workspace pages for the selected branch only. |
| `branches/<branch>/plans/status.md` | `createCanonicalState().getPlanStatusView({ branch })` | branch-local | Build the plan status page from the selected branch workflow view. Do not treat this surface as `main`-only anymore. |
| `branches/<branch>/plans/report.md` | `createCanonicalState().getPlanReportView({ branch })` | branch-local | Build the plan report page from the selected branch workflow report view. Do not treat this surface as `main`-only anymore. |
| `project/notes/project-notes.md` | `createCanonicalState().listMarkdownBranches()` + `createCanonicalState().getProjectNotesView({ branch })` | runtime-global summary over branch-local sources | Summarize branch-local project guidance across all exported branches without claiming runtime authority. |
| `project/notes/team-notes.md` | `createCanonicalState().listMarkdownBranches()` + `createCanonicalState().getTeamNotesView({ branch })` | runtime-global summary over branch-local sources | Summarize branch-local collaboration governance across all exported branches without inventing shared copies. |

## Branch and compatibility safety rules

Task 9B MUST follow these safety guards when the markdown workspace is generated:

- Branch-local pages MUST be generated from the selected branch only.
- Governance pages and cross-branch note summaries MUST read branch-local governance views; they MUST NOT fall back to shared legacy governance files.
- Branch-local workspace pages MUST read `listWorkspaces({ branch })` for the selected branch. They are no longer part of the compatibility-shared or `main`-only bucket.
- Branch-local plan pages MUST read `getPlanStatusView({ branch })` and `getPlanReportView({ branch })` for the selected branch. They are no longer part of the shared or `main`-only bucket.
- Project and team notes may summarize multiple branch-local surfaces at once, but they MUST keep `authoritative: false` and a truthful `source_scope` value.
- Re-export MAY replace previously generated markdown files. Preservation of manual edits is not part of this contract slice.
- Markdown export failure MUST NOT block canonical runtime writes.

## Task 9B implementation seam

The best low-churn export assembly point is `state/canonical.js`.

The best outward-facing seam is the existing dashboard export family (`/api/export-json`, `/api/export`, and `/api/export-replay`), not a watcher loop.

Task 9B should therefore:

- add read-only markdown-export helpers or wrappers to `createCanonicalState(...)`,
- reuse the existing dashboard export shape conventions for branch/version/exported-at metadata,
- treat the current `dashboard.html` markdown export as conversation-only compatibility behavior rather than the authority model for the workspace,
- avoid introducing a second side channel that bypasses broker-owned read surfaces.

## Validation path

Run the Task 9A checker with:

```bash
node scripts/check-markdown-workspace.js
```

That validator proves the reference still contains:

- the non-authoritative markdown rule,
- the default workspace root and first safe layout,
- the required frontmatter contract,
- the export-source mapping,
- the branch/main-only compatibility safety rules,
- the Task 9B implementation seam.
