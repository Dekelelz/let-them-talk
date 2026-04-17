# Canonical Event Schema Reference

Status: Task 3A schema-first reference  
Normative source: `docs/architecture/runtime-contract.md`  
Code source: `agent-bridge/events/schema.js`

This page freezes the first explicit canonical event layer for LetThemTalk without introducing replay or projection rebuilding yet.

## Shared event envelope

All canonical events use one shared envelope shape across both streams.

Required envelope fields:

- `event_id`
- `stream`
- `branch_id`
- `seq`
- `type`
- `occurred_at`
- `schema_version`
- `actor_agent`
- `session_id`
- `command_id`
- `causation_id`
- `correlation_id`
- `payload`

Task 3A keeps one envelope for both streams and allows `branch_id` / `session_id` to be present with `null` when they do not apply yet. Unknown fields are allowed so later replay/projection work can preserve forward-compatible data.

## Scope split

The stream split is explicit in code:

- runtime-global exceptions: `agent.*`, `profile.*`, `lock.*`, `branch.*`, `migration.*`
- branch-local default for collaboration state: `session.*`, `conversation.*`, `message.*`, `task.*`, `workflow.*`, `workspace.*`, `decision.*`, `kb.*`, `review.*`, `dependency.*`, `vote.*`, `rule.*`, `progress.*`, `evidence.*`

This mirrors the runtime contract rule that shared local-runtime metadata stays global while collaboration-shaped state is branch-local.

## Branch semantics companion

This schema reference freezes which families belong to which stream. Task 4A freezes the rest of the branch contract in `docs/architecture/branch-semantics.md`: the two-bucket model, fork snapshot inheritance, branch-local read/write resolution, and the rule that derived delivery/read state (consumed offsets, acknowledgements, read receipts, compressed history, and non-general channel projections) follows the branch-local message/conversation namespace even before those surfaces are fully rewired.

## Seed family/type registry

The first registry is intentionally small and grounded in current runtime surfaces:

| Family | Stream | Seed event types | Projection targets |
| --- | --- | --- | --- |
| `agent` | `runtime` | `agent.registered`, `agent.unregistered`, `agent.status_updated`, `agent.heartbeat_recorded`, `agent.branch_assigned`, `agent.listening_updated` | `agents-index`, `sessions-index` |
| `profile` | `runtime` | `profile.updated` | `profiles` |
| `lock` | `runtime` | `lock.acquired`, `lock.released` | `locks` |
| `branch` | `runtime` | `branch.created` | `branch-index` |
| `migration` | `runtime` | `migration.started`, `migration.completed`, `migration.failed` | `manifest` |
| `session` | `branch` | `session.started`, `session.resumed`, `session.interrupted`, `session.completed`, `session.failed`, `session.abandoned` | `sessions`, `sessions-index` |
| `conversation` | `branch` | `conversation.mode_updated`, `conversation.channel_joined`, `conversation.channel_left`, `conversation.manager_claimed`, `conversation.phase_updated`, `conversation.floor_yielded` | `conversation` |
| `message` | `branch` | `message.sent`, `message.corrected`, `message.redacted` | `messages`, `history` |
| `task` | `branch` | `task.created`, `task.updated`, `task.claimed`, `task.completed` | `tasks` |
| `workflow` | `branch` | `workflow.created`, `workflow.step_started`, `workflow.step_completed`, `workflow.step_reassigned`, `workflow.completed`, `workflow.paused`, `workflow.resumed`, `workflow.stopped` | `workflows` |
| `workspace` | `branch` | `workspace.written` | `workspaces` |
| `decision` | `branch` | `decision.logged` | `decisions` |
| `kb` | `branch` | `kb.written` | `kb` |
| `review` | `branch` | `review.requested`, `review.submitted` | `reviews` |
| `dependency` | `branch` | `dependency.declared`, `dependency.resolved` | `dependencies` |
| `vote` | `branch` | `vote.called`, `vote.cast`, `vote.resolved` | `votes` |
| `rule` | `branch` | `rule.added`, `rule.toggled`, `rule.removed` | `rules` |
| `progress` | `branch` | `progress.updated` | `progress` |
| `evidence` | `branch` | `evidence.recorded` | `evidence` |

These types are the Task 3A seed set for later replay/projection work. They are not a full migration of writes yet.

## Validation path

Run the narrow schema check with:

```bash
node agent-bridge/scripts/check-event-schema.js
```

That validator proves:

- the shared envelope fields exist,
- the required family registry exists,
- the runtime-vs-branch split is encoded,
- the Task 3A seed event types are registered,
- sample canonical events validate against the shared envelope.
