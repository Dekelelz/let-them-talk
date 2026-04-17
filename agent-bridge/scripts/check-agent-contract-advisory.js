#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');
const DASHBOARD_FILE = path.resolve(__dirname, '..', 'dashboard.js');
const {
  analyzeContractFit,
  buildGuideContractAdvisory,
  buildRuntimeContractMetadata,
  resolveAgentContract,
  sanitizeContractProfilePatch,
} = require(path.resolve(__dirname, '..', 'agent-contracts.js'));

function fail(lines, exitCode = 1) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function extractBlock(source, startAnchor, endAnchor) {
  const startIndex = source.indexOf(startAnchor);
  if (startIndex === -1) return '';
  const endIndex = endAnchor ? source.indexOf(endAnchor, startIndex + startAnchor.length) : source.length;
  if (endIndex === -1) return source.slice(startIndex);
  return source.slice(startIndex, endIndex);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const dashboardSource = fs.readFileSync(DASHBOARD_FILE, 'utf8');

  const listAgentsBlock = extractBlock(serverSource, 'function toolListAgents() {', 'async function toolSendMessage(content, to = null, reply_to = null, channel = null) {');
  const buildGuideBlock = extractBlock(serverSource, 'function buildGuide(level = \'standard\') {', 'const COMPLETION_EVIDENCE_INPUT_SCHEMA = {');
  const updateProfileBlock = extractBlock(serverSource, 'function toolUpdateProfile(displayName, avatar, bio, role, appearance, archetype, skills, contractMode) {', '// --- Phase 2: Workspace tools ---');
  const suggestTaskBlock = extractBlock(serverSource, 'function toolSuggestTask() {', '// --- Rules system: project-level rules visible in dashboard and injected into agent guides ---');
  const getWorkBlock = extractBlock(serverSource, 'async function toolGetWork(params = {}) {', 'async function toolVerifyAndAdvance(params) {');
  const yieldFloorBlock = extractBlock(serverSource, 'function toolYieldFloor(to, prompt = null) {', 'function toolSetPhase(phase) {');
  const setPhaseBlock = extractBlock(serverSource, 'function toolSetPhase(phase) {', 'function toolRegister(name, provider = null) {');
  const apiAgentsBlock = extractBlock(dashboardSource, 'function apiAgents(query) {', 'function apiStatus(query) {');
  const profilesPostBlock = extractBlock(dashboardSource, "else if (url.pathname === '/api/profiles' && req.method === 'POST') {", "else if (url.pathname === '/api/workspaces' && req.method === 'GET') {");

  assert(serverSource.includes("require('./agent-contracts')"), 'server.js must load the shared advisory contract module.', problems);
  assert(listAgentsBlock.includes('buildRuntimeContractMetadata(contract)'), 'toolListAgents() must expose resolved contract metadata in runtime-facing agent data.', problems);
  assert(buildGuideBlock.includes('buildGuideContractAdvisory(myContract)'), 'buildGuide() must derive contract-aware guide advisory data.', problems);
  assert(buildGuideBlock.includes('contract_advisory'), 'buildGuide() must expose contract_advisory output.', problems);
  assert(updateProfileBlock.includes('sanitizeContractProfilePatch({'), 'toolUpdateProfile() must validate advisory contract metadata through the shared sanitizer.', problems);
  assert(suggestTaskBlock.includes('attachContractAdvisory('), 'toolSuggestTask() must attach contract advisory output instead of only raw task suggestions.', problems);
  assert(getWorkBlock.includes('attachContractAdvisory('), 'toolGetWork() must attach contract advisory output to returned work items.', problems);

  assert(yieldFloorBlock.includes('Only the manager can yield the floor.'), 'Managed-mode manager-only enforcement must remain in toolYieldFloor().', problems);
  assert(setPhaseBlock.includes('Only the manager can set the phase.'), 'Managed-mode manager-only enforcement must remain in toolSetPhase().', problems);
  assert(!getWorkBlock.includes('You must be the manager to yield the floor.'), 'toolGetWork() must not absorb managed-mode manager-only hard gates.', problems);

  assert(apiAgentsBlock.includes('resolveAgentContract(profile)'), '/api/agents must resolve contract metadata from stored profiles.', problems);
  assert(apiAgentsBlock.includes('buildRuntimeContractMetadata(contract)'), '/api/agents must expose contract metadata on dashboard agent payloads.', problems);
  assert(profilesPostBlock.includes('sanitizeContractProfilePatch({'), '/api/profiles POST must validate advisory contract metadata via the shared sanitizer.', problems);

  const validPatch = sanitizeContractProfilePatch({
    archetype: 'Reviewer',
    skills: ['Testing', 'review', 'testing'],
    contract_mode: 'STRICT',
  });
  assert(validPatch.valid, 'sanitizeContractProfilePatch() should accept valid advisory contract metadata.', problems);
  assert(sameJson(validPatch.normalized, { archetype: 'reviewer', skills: ['testing', 'review'], contract_mode: 'strict' }), 'sanitizeContractProfilePatch() should normalize archetype, skills, and contract_mode deterministically.', problems);

  const invalidPatch = sanitizeContractProfilePatch({ contract_mode: 'enforced-now' });
  assert(!invalidPatch.valid, 'sanitizeContractProfilePatch() should reject unsupported contract modes.', problems);

  const legacyContract = resolveAgentContract({ role: 'Quality Lead' });
  assert(legacyContract.role_token === 'quality', 'resolveAgentContract() should preserve legacy role compatibility by normalizing Quality Lead to quality.', problems);
  assert(legacyContract.archetype === 'reviewer', 'resolveAgentContract() should infer the reviewer archetype from the legacy quality role.', problems);
  assert(legacyContract.has_explicit_contract === false, 'resolveAgentContract() should keep legacy role-only profiles compatible without pretending they are explicit contracts.', problems);

  const explicitContract = resolveAgentContract({
    role: 'Backend',
    archetype: 'implementer',
    skills: ['API', 'backend'],
    contract_mode: 'strict',
  });
  assert(explicitContract.declared_archetype === 'implementer', 'resolveAgentContract() should preserve the explicitly declared archetype.', problems);
  assert(explicitContract.role_alignment === 'aligned', 'resolveAgentContract() should mark compatible explicit role/archetype combinations as aligned.', problems);
  assert(explicitContract.effective_skills.includes('api') && explicitContract.effective_skills.includes('backend'), 'resolveAgentContract() should carry normalized explicit skills into effective_skills.', problems);

  const mismatchGuide = buildGuideContractAdvisory(resolveAgentContract({ role: 'advisor', archetype: 'implementer' }));
  assert(mismatchGuide && mismatchGuide.status === 'mismatch', 'buildGuideContractAdvisory() should flag explicit role/archetype mismatches without hard failing.', problems);

  const reviewFit = analyzeContractFit(resolveAgentContract({ role: 'quality', archetype: 'reviewer', skills: ['testing'] }), {
    work_type: 'review',
    title: 'Review API regression fix',
    description: 'Verify tests and review the patch',
  });
  assert(reviewFit && reviewFit.status === 'aligned', 'analyzeContractFit() should mark reviewer-aligned review work as aligned.', problems);

  const assignedMismatch = analyzeContractFit(resolveAgentContract({ archetype: 'advisor', contract_mode: 'strict' }), {
    work_type: 'claimed_task',
    title: 'Implement dashboard drag and drop',
    description: 'Write code for the new dashboard interaction',
    assigned: true,
  });
  assert(assignedMismatch && assignedMismatch.status === 'mismatch', 'analyzeContractFit() should detect weaker-fit assigned implementation work for advisor archetypes.', problems);
  assert(assignedMismatch && assignedMismatch.summary.includes('assigned work still takes precedence'), 'Assigned mismatch guidance must remain advisory by stating that assigned work still takes precedence.', problems);
  assert(assignedMismatch && assignedMismatch.migration_note && assignedMismatch.migration_note.includes('advisory'), 'Strict contract mode must still surface only advisory guidance in Task 11B.', problems);

  const runtimeMetadata = buildRuntimeContractMetadata(explicitContract);
  assert(runtimeMetadata.archetype === 'implementer', 'buildRuntimeContractMetadata() should expose the explicit archetype in runtime-facing metadata.', problems);
  assert(sameJson(runtimeMetadata.skills, ['api', 'backend']), 'buildRuntimeContractMetadata() should expose explicit skills in runtime-facing metadata.', problems);
  assert(runtimeMetadata.contract && runtimeMetadata.contract.role_alignment === 'aligned', 'buildRuntimeContractMetadata() should expose resolved role alignment details for advisory consumers.', problems);

  if (problems.length > 0) {
    fail(['Agent contract advisory validation failed.', ...problems.map((problem) => `- ${problem}`)]);
  }

  console.log([
    'Agent contract advisory validation passed.',
    '- Shared advisory contract metadata normalizes archetype, skills, and contract_mode deterministically.',
    '- Legacy free-form role strings remain compatible through read-time resolution instead of persisted rewrites.',
    '- get_guide, suggest_task, and get_work are wired to surface advisory contract guidance without broad hard blocking.',
    '- Dashboard/runtime-facing agent metadata exposes the resolved contract shape while managed-mode hard gates stay separate.',
  ].join('\n'));
}

main();
