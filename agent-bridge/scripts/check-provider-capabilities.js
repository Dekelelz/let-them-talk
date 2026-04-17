#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ApiAgentEngine } = require(path.resolve(__dirname, '..', 'api-agents.js'));
const {
  inferApiAgentCapabilities,
  resolveAgentRuntimeMetadata,
  validateExplicitRuntimeDescriptor,
} = require(path.resolve(__dirname, '..', 'runtime-descriptor.js'));

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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getExplicitDescriptor(record = {}) {
  return {
    runtime_type: record.runtime_type,
    provider_id: record.provider_id,
    model_id: record.model_id,
    capabilities: record.capabilities,
  };
}

function routeAgentsByExplicitCapability(agentRecords, requiredCapability) {
  const matched = [];
  const rejected = [];

  for (const record of agentRecords) {
    const validation = validateExplicitRuntimeDescriptor(getExplicitDescriptor(record));
    if (!validation.valid) {
      rejected.push({
        name: record && record.name ? record.name : '<unknown>',
        errors: validation.errors,
      });
      continue;
    }

    if (validation.normalized.capabilities.includes(requiredCapability)) {
      matched.push(record.name);
    }
  }

  matched.sort();
  rejected.sort((left, right) => String(left.name).localeCompare(String(right.name)));
  return { matched, rejected };
}

function createFixtureDataDir() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ltt-provider-capabilities-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  fs.mkdirSync(dataDir, { recursive: true });
  return { tempRoot, dataDir };
}

function removeFixture(tempRoot) {
  try {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } catch {}
}

function main() {
  const problems = [];
  const fixture = createFixtureDataDir();

  try {
    const engine = new ApiAgentEngine(fixture.dataDir);

    const createResults = [
      engine.create('vision_bot', 'zai', { model: 'glm-4.6v' }),
      engine.create('video_bot', 'comfyui', { model: 'wan_i2v' }),
      engine.create('image_bot', 'gemini', { model: 'gemini-3-pro-image-preview' }),
      engine.create('gemini_vid_override', 'gemini', {
        model: 'gemini-3-pro-image-preview',
        capabilities: ['video_generation'],
      }),
      engine.create('ollama_tex_override', 'ollama', {
        model: 'llava:34b',
        capabilities: ['texture_generation'],
      }),
      engine.create('zai_chat_override', 'zai', {
        model: 'glm-image',
        capabilities: ['chat'],
      }),
    ];

    createResults.forEach((result, index) => {
      assert(result && result.ok, `API agent create() should succeed for fixture agent ${index + 1}.`, problems);
    });

    const agentsFile = path.join(fixture.dataDir, 'agents.json');
    const agents = readJson(agentsFile, {});
    const listedAgents = engine.list();

    const expectedAgents = [
      {
        name: 'vision_bot',
        provider_id: 'zai',
        model_id: 'glm-4.6v',
        capabilities: ['vision', 'chat'],
        bot_capability: 'vision',
      },
      {
        name: 'video_bot',
        provider_id: 'comfyui',
        model_id: 'wan_i2v',
        capabilities: ['video_generation'],
        bot_capability: 'video_gen',
      },
      {
        name: 'image_bot',
        provider_id: 'gemini',
        model_id: 'gemini-3-pro-image-preview',
        capabilities: ['image_generation'],
        bot_capability: 'image_gen',
      },
      {
        name: 'gemini_vid_override',
        provider_id: 'gemini',
        model_id: 'gemini-3-pro-image-preview',
        capabilities: ['video_generation'],
        bot_capability: 'video_gen',
      },
      {
        name: 'ollama_tex_override',
        provider_id: 'ollama',
        model_id: 'llava:34b',
        capabilities: ['texture_generation'],
        bot_capability: 'texture_gen',
      },
      {
        name: 'zai_chat_override',
        provider_id: 'zai',
        model_id: 'glm-image',
        capabilities: ['chat'],
        bot_capability: 'chat',
      },
    ];

    for (const expected of expectedAgents) {
      const stored = agents[expected.name] || {};
      const listed = listedAgents.find((entry) => entry.name === expected.name) || {};
      const validation = validateExplicitRuntimeDescriptor({
        runtime_type: stored.runtime_type,
        provider_id: stored.provider_id,
        model_id: stored.model_id,
        capabilities: stored.capabilities,
      });

      assert(validation.valid, `Stored descriptor for ${expected.name} should validate: ${validation.errors.join('; ')}`, problems);
      assert(stored.runtime_type === 'api', `${expected.name} should store runtime_type="api".`, problems);
      assert(stored.provider_id === expected.provider_id, `${expected.name} should store provider_id="${expected.provider_id}".`, problems);
      assert(stored.model_id === expected.model_id, `${expected.name} should store model_id="${expected.model_id}".`, problems);
      assert(JSON.stringify(stored.capabilities || []) === JSON.stringify(expected.capabilities), `${expected.name} should store capabilities ${JSON.stringify(expected.capabilities)}.`, problems);
      assert(stored.provider === expected.provider_id, `${expected.name} should project legacy provider from provider_id.`, problems);
      assert(typeof stored.provider_color === 'string' && stored.provider_color.length > 0, `${expected.name} should project a legacy provider_color.`, problems);
      assert(stored.bot_capability === expected.bot_capability, `${expected.name} should project legacy bot_capability="${expected.bot_capability}".`, problems);

      assert(listed.runtime_type === 'api', `engine.list() should expose runtime_type for ${expected.name}.`, problems);
      assert(listed.provider_id === expected.provider_id, `engine.list() should expose provider_id for ${expected.name}.`, problems);
      assert(listed.model_id === expected.model_id, `engine.list() should expose model_id for ${expected.name}.`, problems);
      assert(JSON.stringify(listed.capabilities || []) === JSON.stringify(expected.capabilities), `engine.list() should expose capabilities for ${expected.name}.`, problems);
      assert(listed.bot_capability === expected.bot_capability, `engine.list() should expose projected bot_capability for ${expected.name}.`, problems);
    }

    const heuristicOverrideFixtures = expectedAgents.filter((expected) => (
      expected.name === 'gemini_vid_override'
      || expected.name === 'ollama_tex_override'
      || expected.name === 'zai_chat_override'
    ));

    for (const expected of heuristicOverrideFixtures) {
      const heuristicCapabilities = inferApiAgentCapabilities({
        name: expected.name,
        provider_id: expected.provider_id,
        model_id: expected.model_id,
      });
      assert(
        !sameJson(heuristicCapabilities, expected.capabilities),
        `${expected.name} fixture should differ from provider/model heuristics so the validator proves explicit capability routing.`,
        problems
      );
    }

    const videoRoute = routeAgentsByExplicitCapability(listedAgents, 'video_generation');
    const textureRoute = routeAgentsByExplicitCapability(listedAgents, 'texture_generation');
    const imageRoute = routeAgentsByExplicitCapability(listedAgents, 'image_generation');
    const chatRoute = routeAgentsByExplicitCapability(listedAgents, 'chat');
    const visionRoute = routeAgentsByExplicitCapability(listedAgents, 'vision');

    assert(sameJson(videoRoute.matched, ['gemini_vid_override', 'video_bot']), 'Explicit video-generation routing should select only the mixed-provider agents whose explicit capabilities include video_generation.', problems);
    assert(sameJson(textureRoute.matched, ['ollama_tex_override']), 'Explicit texture-generation routing should select the capability override even when provider/model heuristics would not.', problems);
    assert(sameJson(imageRoute.matched, ['image_bot']), 'Explicit image-generation routing should exclude agents whose providers/models look image-capable but whose explicit capabilities say otherwise.', problems);
    assert(sameJson(chatRoute.matched, ['vision_bot', 'zai_chat_override']), 'Explicit chat routing should include only agents whose explicit capabilities expose chat.', problems);
    assert(sameJson(visionRoute.matched, ['vision_bot']), 'Explicit vision routing should not silently route to provider/model heuristic matches without explicit vision capability metadata.', problems);
    assert(videoRoute.rejected.length === 0 && textureRoute.rejected.length === 0 && imageRoute.rejected.length === 0 && chatRoute.rejected.length === 0 && visionRoute.rejected.length === 0, 'Valid API-agent rows should not be rejected by strict explicit-capability routing.', problems);

    const explicitPreferred = resolveAgentRuntimeMetadata({
      name: 'explicit_preferred',
      is_api_agent: true,
      runtime_type: 'api',
      provider_id: 'zai',
      model_id: 'glm-image',
      capabilities: ['image_generation'],
      provider: 'legacy-provider-should-not-win',
      bot_capability: 'chat',
    });
    assert(explicitPreferred.provider === 'zai', 'Explicit provider_id should override stale legacy provider projection.', problems);
    assert(explicitPreferred.bot_capability === 'image_gen', 'Explicit capabilities should override stale legacy bot_capability.', problems);

    const legacyFallback = resolveAgentRuntimeMetadata({
      name: 'legacy_wan_worker',
      is_api_agent: true,
      provider: 'comfyui',
    });
    assert(JSON.stringify(legacyFallback.capabilities || []) === JSON.stringify(['video_generation']), 'Legacy API-agent fallback should infer video_generation from provider/name hints.', problems);
    assert(legacyFallback.bot_capability === 'video_gen', 'Legacy API-agent fallback should still project legacy bot_capability.', problems);

    const missingCapabilityMetadata = validateExplicitRuntimeDescriptor({
      runtime_type: 'api',
      provider_id: 'zai',
      model_id: 'glm-image',
    });
    assert(!missingCapabilityMetadata.valid, 'Descriptor validation should fail closed when capabilities metadata is absent entirely.', problems);

    const missingCapabilities = validateExplicitRuntimeDescriptor({
      runtime_type: 'api',
      provider_id: 'zai',
      model_id: 'glm-5',
      capabilities: [],
    });
    assert(!missingCapabilities.valid, 'Descriptor validation should fail closed when capabilities are missing.', problems);

    const invalidCapability = validateExplicitRuntimeDescriptor({
      runtime_type: 'api',
      provider_id: 'zai',
      model_id: 'glm-5',
      capabilities: ['telepathy'],
    });
    assert(!invalidCapability.valid, 'Descriptor validation should reject unsupported capability tokens.', problems);

    const staleCompatibilityFixtures = [
      {
        name: 'missing_caps_fixture',
        runtime_type: 'api',
        provider_id: 'zai',
        model_id: 'glm-image',
        capabilities: null,
        provider: 'zai',
        bot_capability: 'image_gen',
      },
      {
        name: 'invalid_caps_fixture',
        runtime_type: 'api',
        provider_id: 'gemini',
        model_id: 'gemini-3-pro-image-preview',
        capabilities: ['telepathy'],
        provider: 'gemini',
        bot_capability: 'image_gen',
      },
    ];

    for (const fixtureAgent of staleCompatibilityFixtures) {
      const compatibilityProjection = resolveAgentRuntimeMetadata(fixtureAgent);
      assert(
        Array.isArray(compatibilityProjection.capabilities) && compatibilityProjection.capabilities.includes('image_generation'),
        `${fixtureAgent.name} should remain inferable through the compatibility resolver so the strict router proves it is failing closed instead of using fallback heuristics.`,
        problems
      );
    }

    const strictImageRouteWithStaleRows = routeAgentsByExplicitCapability(
      listedAgents.concat(staleCompatibilityFixtures),
      'image_generation'
    );
    assert(sameJson(strictImageRouteWithStaleRows.matched, ['image_bot']), 'Strict explicit-capability routing should still select only explicitly valid image agents when stale fallback-only rows are present.', problems);
    assert(strictImageRouteWithStaleRows.rejected.some((entry) => entry.name === 'missing_caps_fixture'), 'Strict explicit-capability routing should reject rows with missing capability metadata instead of inferring from legacy fields.', problems);
    assert(strictImageRouteWithStaleRows.rejected.some((entry) => entry.name === 'invalid_caps_fixture'), 'Strict explicit-capability routing should reject rows with invalid capability metadata instead of inferring from provider/model hints.', problems);
  } finally {
    removeFixture(fixture.tempRoot);
  }

  if (problems.length > 0) {
    fail([
      'Provider capability validation failed.',
      ...problems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'Provider capability validation passed.',
    '- API agent descriptors are stored explicitly with runtime_type/provider_id/model_id/capabilities.',
    '- Mixed-provider routing fixtures prove explicit capabilities win even when provider/model heuristics disagree.',
    '- Strict explicit-capability routing rejects missing/invalid metadata instead of silently using compatibility fallbacks.',
    '- Legacy provider/provider_color/bot_capability projections still resolve from the shared descriptor helper.',
    '- Older API-agent rows still fall back through the centralized compatibility inference path.',
  ].join('\n'));
}

main();
