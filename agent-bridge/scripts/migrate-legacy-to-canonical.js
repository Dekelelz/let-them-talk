#!/usr/bin/env node
// Migrate a pre-canonical .agent-bridge/ project to the canonical event-stream model.
//
// Old projects have legacy projection files (messages.jsonl, history.jsonl) under
// .agent-bridge/ but no canonical stream at .agent-bridge/runtime/branches/main/events.jsonl.
// The current canonical layer fail-closes any rebuild on legacy-only state to prevent
// silent data loss, which makes Clear Messages and several other dashboard actions error
// out on those projects.
//
// This script:
//   1. Detects the legacy-only condition.
//   2. Backs up the legacy projections to .agent-bridge/legacy-backup-<timestamp>/.
//   3. Removes the bare projections so the canonical layer is willing to write.
//   4. Replays each legacy message through canonicalState.appendMessage() so the canonical
//      stream is created and projections are rewritten in lockstep.
//
// Usage:
//   node agent-bridge/scripts/migrate-legacy-to-canonical.js [project-path]
//   node agent-bridge/scripts/migrate-legacy-to-canonical.js --dry-run [project-path]
//
// project-path defaults to the current working directory.

const fs = require('fs');
const path = require('path');
const { resolveDataDir } = require('../data-dir');
const { createCanonicalState } = require('../state/canonical');

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

function loadLegacyMessages(dataDir) {
  const history = readJsonl(path.join(dataDir, 'history.jsonl'));
  if (history.length > 0) return history;
  return readJsonl(path.join(dataDir, 'messages.jsonl'));
}

function backupLegacyProjections(dataDir) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDir = path.join(dataDir, 'legacy-backup-' + stamp);
  fs.mkdirSync(backupDir, { recursive: true });
  let copied = 0;
  for (const fileName of ['messages.jsonl', 'history.jsonl']) {
    const src = path.join(dataDir, fileName);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, fileName));
      copied++;
    }
  }
  return { backupDir, copied };
}

function removeLegacyProjections(dataDir) {
  for (const fileName of ['messages.jsonl', 'history.jsonl']) {
    const src = path.join(dataDir, fileName);
    if (fs.existsSync(src)) fs.unlinkSync(src);
  }
}

function migrate(projectArg, opts) {
  const dataDir = resolveDataDir({ cwd: projectArg });
  const eventFile = path.join(dataDir, 'runtime', 'branches', 'main', 'events.jsonl');
  const legacyMessages = path.join(dataDir, 'messages.jsonl');
  const legacyHistory = path.join(dataDir, 'history.jsonl');

  console.log('');
  console.log('  Let Them Talk — Legacy Migration');
  console.log('  ================================');
  console.log('  Project data dir: ' + dataDir);
  console.log('');

  if (!fs.existsSync(dataDir)) {
    console.log('  [info] No .agent-bridge/ directory at this path. Nothing to migrate.');
    return { migrated: 0 };
  }

  const hasLegacy = fs.existsSync(legacyMessages) || fs.existsSync(legacyHistory);
  const hasCanonical = fs.existsSync(eventFile);

  if (!hasLegacy && !hasCanonical) {
    console.log('  [info] No legacy projections and no canonical stream — nothing to do.');
    return { migrated: 0 };
  }

  if (hasCanonical && hasLegacy) {
    console.log('  [info] Both canonical stream and legacy projections exist.');
    console.log('         Canonical stream wins; legacy projection files will be archived to be safe.');
    if (opts.dryRun) {
      console.log('  [dry-run] Would archive legacy projections to .agent-bridge/legacy-backup-<ts>/');
      return { migrated: 0, archived: true };
    }
    const backup = backupLegacyProjections(dataDir);
    if (backup.copied > 0) {
      removeLegacyProjections(dataDir);
      console.log('  [ok] Archived ' + backup.copied + ' legacy projection file(s) to ' + backup.backupDir);
    }
    return { migrated: 0, archived: true };
  }

  if (hasCanonical && !hasLegacy) {
    console.log('  [info] Canonical event stream already exists and no legacy projections present.');
    console.log('         Project is already on the canonical schema.');
    return { migrated: 0 };
  }

  // Legacy-only — the case the canonical layer refuses to operate on.
  const messages = loadLegacyMessages(dataDir);
  console.log('  [info] Legacy-only project detected.');
  console.log('  [info] Found ' + messages.length + ' legacy message(s) to replay onto branch "main".');

  if (opts.dryRun) {
    console.log('');
    console.log('  [dry-run] Would back up legacy projections, then replay messages through the canonical layer.');
    console.log('  [dry-run] Run again without --dry-run to perform the migration.');
    return { migrated: 0, dryRun: true, candidate: messages.length };
  }

  const backup = backupLegacyProjections(dataDir);
  if (backup.copied > 0) {
    console.log('  [ok] Archived ' + backup.copied + ' legacy projection file(s) to ' + backup.backupDir);
  }

  // Remove legacy projections so the canonical layer is willing to (re)build them.
  removeLegacyProjections(dataDir);

  const canonicalState = createCanonicalState({ dataDir });

  let migrated = 0;
  let skipped = 0;
  for (const m of messages) {
    if (!m || typeof m !== 'object') { skipped++; continue; }
    if (typeof m.id !== 'string' || !m.id) { skipped++; continue; }
    try {
      canonicalState.appendMessage(m, { branch: 'main', actorAgent: m.from || 'system' });
      migrated++;
    } catch (e) {
      skipped++;
      console.warn('  [warn] Skipped message ' + m.id + ': ' + (e && e.message ? e.message : e));
    }
  }

  console.log('');
  console.log('  [ok] Migrated ' + migrated + '/' + messages.length + ' message(s) onto the canonical event stream.');
  if (skipped > 0) console.log('  [warn] Skipped ' + skipped + ' message(s) — see warnings above.');
  console.log('  [ok] Canonical event log: ' + eventFile);
  console.log('  [info] Original projections are preserved in: ' + backup.backupDir);
  console.log('');
  console.log('  You can now use Clear Messages and other dashboard actions on this project.');
  console.log('');

  return { migrated, skipped, backupDir: backup.backupDir };
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const opts = { dryRun: false };
  const positional = [];
  for (const a of args) {
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else positional.push(a);
  }
  opts.project = positional[0] || process.cwd();
  return opts;
}

function printUsage() {
  console.log('');
  console.log('  migrate-legacy-to-canonical');
  console.log('  ===========================');
  console.log('  Backfills the canonical event stream from legacy projection files so');
  console.log('  pre-upgrade projects work with the new dashboard control plane.');
  console.log('');
  console.log('  Usage:');
  console.log('    node agent-bridge/scripts/migrate-legacy-to-canonical.js [project-path]');
  console.log('    node agent-bridge/scripts/migrate-legacy-to-canonical.js --dry-run [project-path]');
  console.log('');
  console.log('  project-path defaults to the current working directory.');
  console.log('');
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (opts.help) { printUsage(); process.exit(0); }
  try {
    migrate(opts.project, opts);
  } catch (e) {
    console.error('  [error] ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  }
}

module.exports = { migrate };
