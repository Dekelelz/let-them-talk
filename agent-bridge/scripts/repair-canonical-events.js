#!/usr/bin/env node
// Repair a corrupted canonical event log in-place.
//
// Problem this fixes:
//   Pre-v5.5.3 Clear Messages would emit a message.redacted event for every
//   message currently in the projection, even if that message had no
//   corresponding message.sent event in the canonical log (e.g. legacy
//   projection-only messages left over from a partial migration, or an
//   earlier clear cycle). On the next rebuild/replay the redacted event
//   fails with "cannot apply message.redacted because message X does not
//   exist", which blocks further Clear Messages on that branch.
//
//   v5.5.3 fixed the root cause in clearMessages so new redactions are
//   gated on the presence of a message.sent ancestor. This script cleans
//   up the orphan redactions that are already in the event log from
//   previous versions so the branch can replay again.
//
// What it does:
//   - For every branch under .agent-bridge/runtime/branches/<branch>/:
//     - Reads events.jsonl
//     - Collects the set of message IDs that have a message.sent event
//     - Drops message.redacted and message.corrected events whose
//       payload.message_id is not in that set (orphans)
//     - Backs up the original events.jsonl to events.jsonl.pre-repair-<ts>
//     - Writes the cleaned stream back
//   - Deletes the branch's projection files (messages.jsonl, history.jsonl,
//     dashboard-query-projection.json, events.head.json) so the runtime
//     rebuilds them cleanly on the next read.
//
// Usage:
//   node agent-bridge/scripts/repair-canonical-events.js [project-path]
//   node agent-bridge/scripts/repair-canonical-events.js --dry-run [project-path]
//
// project-path defaults to the current working directory.

const fs = require('fs');
const path = require('path');
const { resolveDataDir } = require('../data-dir');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function repairBranch(branchDir, opts) {
  const eventsFile = path.join(branchDir, 'events.jsonl');
  if (!fs.existsSync(eventsFile)) return { skipped: true, reason: 'no events.jsonl' };

  const events = readJsonl(eventsFile);
  if (events.length === 0) return { skipped: true, reason: 'empty events.jsonl' };

  const sentIds = new Set();
  for (const ev of events) {
    if (ev && ev.type === 'message.sent' && ev.payload && ev.payload.message && typeof ev.payload.message.id === 'string') {
      sentIds.add(ev.payload.message.id);
    }
  }

  const kept = [];
  const orphans = [];
  const duplicateRedactions = [];
  const seenRedactedIds = new Set();
  for (const ev of events) {
    if (ev && (ev.type === 'message.redacted' || ev.type === 'message.corrected')) {
      const msgId = ev.payload && ev.payload.message_id;
      // Orphan: no corresponding message.sent ancestor.
      if (msgId && !sentIds.has(msgId)) {
        orphans.push(ev);
        continue;
      }
      // Duplicate redaction: same message_id already redacted earlier in the
      // stream. Keep the first, drop subsequent ones. Pre-v5.5.4 the replay
      // threw on the second redaction; now it tolerates duplicates, but we
      // still want to prune the log so it's clean.
      if (ev.type === 'message.redacted' && msgId) {
        if (seenRedactedIds.has(msgId)) {
          duplicateRedactions.push(ev);
          continue;
        }
        seenRedactedIds.add(msgId);
      }
    }
    kept.push(ev);
  }

  const result = {
    branch: path.basename(branchDir),
    total_events: events.length,
    message_sent_events: sentIds.size,
    orphan_redacted: orphans.filter((o) => o.type === 'message.redacted').length,
    orphan_corrected: orphans.filter((o) => o.type === 'message.corrected').length,
    duplicate_redacted: duplicateRedactions.length,
    kept_events: kept.length,
  };

  if (opts.dryRun) {
    result.dryRun = true;
    return result;
  }

  if (orphans.length === 0 && duplicateRedactions.length === 0) {
    result.skipped = true;
    result.reason = 'no orphan or duplicate events';
    return result;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupFile = path.join(branchDir, `events.jsonl.pre-repair-${stamp}`);
  fs.copyFileSync(eventsFile, backupFile);
  result.backup = backupFile;

  fs.writeFileSync(eventsFile, kept.map((e) => JSON.stringify(e)).join('\n') + '\n');

  // Drop cached projections + head pointer so the runtime rebuilds next read
  for (const name of ['messages.jsonl', 'history.jsonl', 'dashboard-query-projection.json', 'events.head.json']) {
    const p = path.join(branchDir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  result.projections_cleared = true;

  return result;
}

function main(argv) {
  const args = argv.slice(2);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const projectArg = args.filter((a) => !a.startsWith('-'))[0] || process.cwd();

  const dataDir = resolveDataDir({ cwd: projectArg });
  const branchesDir = path.join(dataDir, 'runtime', 'branches');

  console.log('');
  console.log('  Canonical event log repair');
  console.log('  ==========================');
  console.log('  Project: ' + projectArg);
  console.log('  Runtime: ' + branchesDir);
  console.log(dryRun ? '  Mode: DRY RUN (no changes written)' : '  Mode: apply');
  console.log('');

  if (!fs.existsSync(branchesDir)) {
    console.log('  [info] No canonical runtime at this path. Nothing to repair.');
    return;
  }

  const branches = fs.readdirSync(branchesDir).filter((name) => {
    const p = path.join(branchesDir, name);
    return fs.statSync(p).isDirectory();
  });

  if (branches.length === 0) {
    console.log('  [info] No branches present. Nothing to repair.');
    return;
  }

  for (const name of branches) {
    const r = repairBranch(path.join(branchesDir, name), { dryRun });
    console.log(`  Branch "${name}":`);
    if (r.skipped) {
      console.log('    skipped — ' + r.reason);
    } else {
      console.log(`    ${r.total_events} total events, ${r.message_sent_events} sent messages`);
      console.log(`    orphan redactions: ${r.orphan_redacted}, orphan corrections: ${r.orphan_corrected}, duplicate redactions: ${r.duplicate_redacted}`);
      if (!dryRun) {
        console.log('    [ok] rewrote events.jsonl (' + r.kept_events + ' events kept)');
        console.log('    [ok] backup: ' + r.backup);
        console.log('    [ok] projections cleared — will rebuild on next read');
      } else {
        const drops = r.orphan_redacted + r.orphan_corrected + r.duplicate_redacted;
        console.log('    [dry-run] would drop ' + drops + ' bad event(s) and back up the original');
      }
    }
  }

  console.log('');
  if (!dryRun) {
    console.log('  Done. Clear Messages should now work on the repaired branches.');
  } else {
    console.log('  Re-run without --dry-run to apply.');
  }
  console.log('');
}

if (require.main === module) {
  try { main(process.argv); }
  catch (e) { console.error('  [error] ' + (e && e.stack ? e.stack : e)); process.exit(1); }
}

module.exports = { repairBranch };
