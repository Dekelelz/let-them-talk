#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ApiAgentEngine } = require(path.resolve(__dirname, '..', 'api-agents.js'));
const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

function fail(lines, exitCode = 1) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function createFixtureDataDir() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ltt-api-agent-parity-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  fs.mkdirSync(dataDir, { recursive: true });
  return { tempRoot, dataDir };
}

function removeFixture(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs = 2000, intervalMs = 20) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function main() {
  const problems = [];
  const fixture = createFixtureDataDir();
  const featureBranch = 'feature_task10b';
  const channelName = 'ops';
  let engine = null;

  try {
    const canonicalState = createCanonicalState({ dataDir: fixture.dataDir, processPid: 7100 });
    const branchPaths = createBranchPathResolvers(fixture.dataDir);
    engine = new ApiAgentEngine(fixture.dataDir);

    const createResult = engine.create('render_bot', 'zai', {
      model: 'glm-image',
      capabilities: ['image_generation'],
    });
    assert(createResult && createResult.ok, 'API parity fixture should create the render_bot adapter successfully.', problems);

    engine.agents.render_bot.provider = {
      async generate(prompt) {
        return { type: 'text', data: `Rendered: ${prompt}` };
      },
    };

    const requesterSession = canonicalState.ensureAgentSession({
      agentName: 'artist_alpha',
      branchName: featureBranch,
      provider: 'claude',
      reason: 'fixture_request',
    });

    fs.writeFileSync(branchPaths.getChannelsFile(featureBranch), JSON.stringify({
      general: { description: 'General channel', members: ['*'] },
      [channelName]: { description: 'Ops channel', members: ['*'] },
    }, null, 2));

    const startResult = engine.start('render_bot');
    assert(startResult && startResult.ok, 'API parity fixture should start the render_bot adapter successfully.', problems);

    const incomingMessage = {
      id: 'msg_task10b_feature_request',
      from: 'artist_alpha',
      to: 'render_bot',
      content: 'Generate: branch-aware adapter parity art',
      timestamp: '2026-04-16T18:00:00.000Z',
      channel: channelName,
      session_id: requesterSession && requesterSession.session ? requesterSession.session.session_id : null,
      command_id: 'cmd_task10b_feature_request',
      correlation_id: 'corr_task10b_feature_request',
    };

    canonicalState.appendScopedMessage(incomingMessage, {
      branch: featureBranch,
      channel: channelName,
      actorAgent: incomingMessage.from,
      sessionId: incomingMessage.session_id,
      commandId: incomingMessage.command_id,
      correlationId: incomingMessage.correlation_id,
    });

    engine._pollMessages('render_bot');

    const featureChannelHistoryFile = branchPaths.getChannelHistoryFile(channelName, featureBranch);
    const featureChannelMessagesFile = branchPaths.getChannelMessagesFile(channelName, featureBranch);
    const featureBranchHistoryFile = branchPaths.getHistoryFile(featureBranch);
    const featureBranchMessagesFile = branchPaths.getMessagesFile(featureBranch);
    const mainHistoryFile = branchPaths.getHistoryFile('main');
    const mainMessagesFile = branchPaths.getMessagesFile('main');

    const processed = await waitFor(() => readJsonl(featureChannelHistoryFile).filter((message) => message.from === 'render_bot').length >= 2);
    assert(processed, 'API parity fixture should observe two render_bot replies in the feature branch channel history.', problems);

    const featureChannelMessages = readJsonl(featureChannelMessagesFile);
    const featureChannelHistory = readJsonl(featureChannelHistoryFile);
    const featureBranchHistory = readJsonl(featureBranchHistoryFile);
    const featureBranchMessages = readJsonl(featureBranchMessagesFile);
    const mainHistory = readJsonl(mainHistoryFile);
    const mainMessages = readJsonl(mainMessagesFile);
    const agentReplies = featureChannelHistory.filter((message) => message.from === 'render_bot');
    const liveAgentReplies = featureChannelMessages.filter((message) => message.from === 'render_bot');
    const processingReply = agentReplies.find((message) => typeof message.content === 'string' && message.content.startsWith('Processing:'));
    const finalReply = agentReplies.find((message) => message.content === 'Rendered: branch-aware adapter parity art');
    const replySessionId = processingReply && processingReply.session_id ? processingReply.session_id : (finalReply && finalReply.session_id ? finalReply.session_id : null);
    const requesterSessionId = requesterSession && requesterSession.session ? requesterSession.session.session_id : null;

    assert(featureChannelMessages.some((message) => message.id === incomingMessage.id), 'Feature branch channel messages should include the original incoming request.', problems);
    assert(featureChannelHistory.some((message) => message.id === incomingMessage.id), 'Feature branch channel history should include the original incoming request.', problems);
    assert(!!featureChannelMessages.find((message) => typeof message.content === 'string' && message.content.startsWith('Processing:') && message.from === 'render_bot'), 'Feature branch channel messages should include the processing reply.', problems);
    assert(!!featureChannelMessages.find((message) => message.content === 'Rendered: branch-aware adapter parity art' && message.from === 'render_bot'), 'Feature branch channel messages should include the final rendered reply.', problems);
    assert(!!processingReply, 'Feature branch channel history should include the processing reply.', problems);
    assert(!!finalReply, 'Feature branch channel history should include the final rendered reply.', problems);
    assert(featureBranchHistory.length === 0, 'Non-general feature branch replies should not leak into the branch default history file.', problems);
    assert(featureBranchMessages.length === 0, 'Non-general feature branch replies should not leak into the branch default messages file.', problems);
    assert(mainHistory.length === 0, 'Feature branch adapter replies should not leak into main-branch history.', problems);
    assert(mainMessages.length === 0, 'Feature branch adapter replies should not leak into main-branch live messages.', problems);
    assert(sameReplySet(liveAgentReplies, agentReplies), 'Scoped live channel messages should mirror the scoped channel history for adapter replies.', problems);
    assert(replySessionId && replySessionId !== requesterSessionId, 'API adapter replies should use an adapter-owned branch session instead of reusing the requester session.', problems);

    for (const reply of agentReplies) {
      assert(reply.channel === channelName, 'API adapter replies should preserve the original non-general channel.', problems);
      assert(reply.reply_to === incomingMessage.id, 'API adapter replies should preserve reply_to against the triggering message.', problems);
      assert(reply.thread_id === incomingMessage.id, 'API adapter replies should preserve thread_id for branch/channel conversations.', problems);
      assert(reply.command_id === incomingMessage.command_id, 'API adapter replies should propagate command_id when present.', problems);
      assert(reply.causation_id === incomingMessage.id, 'API adapter replies should set causation_id to the triggering message id.', problems);
      assert(reply.correlation_id === incomingMessage.correlation_id, 'API adapter replies should preserve correlation_id when present.', problems);
      assert(reply.session_id === replySessionId && !!reply.session_id, 'API adapter replies should use the adapter branch session id.', problems);
    }

    const activeRenderSession = canonicalState.listBranchSessions(featureBranch)
      .filter((session) => session.agent_name === 'render_bot')
      .pop();
    assert(!!activeRenderSession, 'API parity fixture should create a branch-local session manifest for render_bot.', problems);
    assert(activeRenderSession && activeRenderSession.state === 'active', 'render_bot session should be active while the adapter is running.', problems);
    assert(activeRenderSession && activeRenderSession.provider === 'zai', 'render_bot branch session should retain the adapter provider id.', problems);
    assert(activeRenderSession && activeRenderSession.session_id === replySessionId, 'Reply session metadata should match the canonical branch session manifest id.', problems);

    const renderSessionManifest = replySessionId
      ? readJson(branchPaths.getBranchSessionFile(replySessionId, featureBranch), null)
      : null;
    const sessionsIndex = readJson(branchPaths.getSessionsIndexFile(), null);
    assert(!!renderSessionManifest, 'API parity fixture should persist the adapter branch session manifest file.', problems);
    assert(renderSessionManifest && renderSessionManifest.agent_name === 'render_bot', 'Adapter branch session manifest should record the adapter agent name.', problems);
    assert(renderSessionManifest && renderSessionManifest.branch_id === featureBranch, 'Adapter branch session manifest should stay scoped to the feature branch.', problems);
    assert(renderSessionManifest && renderSessionManifest.provider === 'zai', 'Adapter branch session manifest should retain provider parity metadata.', problems);
    assert(sessionsIndex && sessionsIndex.by_agent && sessionsIndex.by_agent.render_bot && sessionsIndex.by_agent.render_bot.active_session_id === replySessionId, 'Sessions index should expose the adapter active session id for render_bot.', problems);
    assert(sessionsIndex && sessionsIndex.by_agent && sessionsIndex.by_agent.render_bot && sessionsIndex.by_agent.render_bot.active_branch_id === featureBranch, 'Sessions index should expose the adapter active branch for render_bot.', problems);
    assert(sessionsIndex && sessionsIndex.by_branch && sessionsIndex.by_branch[featureBranch] && Array.isArray(sessionsIndex.by_branch[featureBranch].active_session_ids) && sessionsIndex.by_branch[featureBranch].active_session_ids.includes(replySessionId), 'Sessions index should include the adapter active session under the feature branch projection.', problems);

    const agentsFile = path.join(fixture.dataDir, 'agents.json');
    const agents = readJson(agentsFile, {});
    assert(agents.render_bot && agents.render_bot.branch === featureBranch, 'API adapter agent row should track the latest active branch.', problems);
    assert(agents.render_bot && agents.render_bot.runtime_type === 'api', 'API adapter agent row should retain explicit runtime_type metadata.', problems);
    assert(agents.render_bot && agents.render_bot.provider_id === 'zai', 'API adapter agent row should retain explicit provider_id metadata.', problems);

    engine.stop('render_bot');

    const stoppedRenderSession = canonicalState.listBranchSessions(featureBranch)
      .filter((session) => session.agent_name === 'render_bot')
      .pop();
    assert(stoppedRenderSession && stoppedRenderSession.state === 'interrupted', 'Stopping the API adapter should interrupt its active branch session.', problems);

    const stoppedSessionsIndex = readJson(branchPaths.getSessionsIndexFile(), null);
    assert(stoppedSessionsIndex && stoppedSessionsIndex.by_agent && stoppedSessionsIndex.by_agent.render_bot && stoppedSessionsIndex.by_agent.render_bot.active_session_id === null, 'Stopping the API adapter should clear the active session pointer in the sessions index.', problems);
    assert(stoppedSessionsIndex && stoppedSessionsIndex.by_branch && stoppedSessionsIndex.by_branch[featureBranch] && Array.isArray(stoppedSessionsIndex.by_branch[featureBranch].active_session_ids) && !stoppedSessionsIndex.by_branch[featureBranch].active_session_ids.includes(replySessionId), 'Stopping the API adapter should remove the interrupted session from the branch active-session index.', problems);

    const backlogRequest = {
      id: 'msg_task10b_feature_restart_backlog',
      from: 'artist_alpha',
      to: 'render_bot',
      content: 'Generate: restart backlog parity art',
      timestamp: '2026-04-16T18:10:00.000Z',
      channel: channelName,
      session_id: requesterSession && requesterSession.session ? requesterSession.session.session_id : null,
      command_id: 'cmd_task10b_feature_restart_backlog',
      correlation_id: 'corr_task10b_feature_restart_backlog',
    };
    canonicalState.appendScopedMessage(backlogRequest, {
      branch: featureBranch,
      channel: channelName,
      actorAgent: backlogRequest.from,
      sessionId: backlogRequest.session_id,
      commandId: backlogRequest.command_id,
      correlationId: backlogRequest.correlation_id,
    });

    engine = new ApiAgentEngine(fixture.dataDir);
    engine.agents.render_bot.provider = {
      async generate(prompt) {
        return { type: 'text', data: `Rendered: ${prompt}` };
      },
    };

    const restartResult = engine.start('render_bot');
    assert(restartResult && restartResult.ok, 'Restarted API parity fixture should start the render_bot adapter successfully.', problems);

    engine._pollMessages('render_bot');

    const backlogProcessed = await waitFor(() => readJsonl(featureChannelHistoryFile).some((message) => message.reply_to === backlogRequest.id && message.content === 'Rendered: restart backlog parity art'));
    assert(backlogProcessed, 'Restarting the API adapter must preserve and process directed backlog that arrived while the adapter was stopped.', problems);

    const consumedIds = readJson(branchPaths.getConsumedFile('render_bot', featureBranch), []);
    assert(Array.isArray(consumedIds) && consumedIds.includes(backlogRequest.id), 'Processed restart backlog should be persisted in the branch-local consumed state instead of staying only in memory.', problems);
  } finally {
    try { engine && typeof engine.stopAll === 'function' && engine.stopAll(); } catch {}
    removeFixture(fixture.tempRoot);
  }

  if (problems.length > 0) {
    fail([
      'API agent parity validation failed.',
      ...problems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'API agent parity validation passed.',
    '- Non-CLI adapters poll branch-scoped conversation history instead of only main messages.jsonl.',
    '- Replies preserve branch/channel/session/correlation metadata through canonical writes and scoped message/history files.',
    '- API adapters now participate in branch-local session manifests, sessions-index projections, and branch tracking like first-class runtimes.',
    '- Restarted API adapters preserve outstanding directed backlog by reusing persisted consumed-state instead of marking every existing message as seen.',
  ].join('\n'));
}

function sameReplySet(left, right) {
  const leftIds = left.map((message) => message.id).sort();
  const rightIds = right.map((message) => message.id).sort();
  return JSON.stringify(leftIds) === JSON.stringify(rightIds);
}

main().catch((error) => {
  fail([
    'API agent parity validation crashed.',
    `- ${error && error.stack ? error.stack : String(error)}`,
  ]);
});
