const PROVIDER_COLORS = Object.freeze({
  ollama: '#0ea5e9',
  dalle: '#10b981',
  replicate: '#8b5cf6',
  gemini: '#4285f4',
  comfyui: '#ff6b35',
  zai: '#4f46e5',
});

const VALID_RUNTIME_TYPES = Object.freeze(['api', 'cli']);
const VALID_CAPABILITIES = Object.freeze([
  'chat',
  'vision',
  'image_generation',
  'video_generation',
  'texture_generation',
]);

const LEGACY_TO_CAPABILITY = Object.freeze({
  chat: 'chat',
  vision: 'vision',
  image_gen: 'image_generation',
  video_gen: 'video_generation',
  texture_gen: 'texture_generation',
});

const CAPABILITY_TO_LEGACY = Object.freeze({
  chat: 'chat',
  vision: 'vision',
  image_generation: 'image_gen',
  video_generation: 'video_gen',
  texture_generation: 'texture_gen',
});

const PRIMARY_CAPABILITY_ORDER = Object.freeze([
  'video_generation',
  'texture_generation',
  'image_generation',
  'vision',
  'chat',
]);

const VALID_RUNTIME_TYPE_SET = new Set(VALID_RUNTIME_TYPES);
const VALID_CAPABILITY_SET = new Set(VALID_CAPABILITIES);

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeProviderId(value) {
  const text = normalizeText(value);
  return text ? text.toLowerCase() : null;
}

function normalizeRuntimeType(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  return VALID_RUNTIME_TYPE_SET.has(normalized) ? normalized : null;
}

function normalizeCapabilityToken(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = text.toLowerCase();
  return VALID_CAPABILITY_SET.has(normalized) ? normalized : null;
}

function normalizeCapabilities(value) {
  const entries = Array.isArray(value)
    ? value
    : (value == null ? [] : [value]);
  const normalized = [];
  const seen = new Set();

  for (const entry of entries) {
    const token = normalizeCapabilityToken(entry);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function normalizeLegacyCapability(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return LEGACY_TO_CAPABILITY[text.toLowerCase()] || null;
}

function projectLegacyCapability(capability) {
  const token = normalizeCapabilityToken(capability);
  return token ? CAPABILITY_TO_LEGACY[token] : null;
}

function getPrimaryCapability(capabilities) {
  const normalized = normalizeCapabilities(capabilities);
  for (const token of PRIMARY_CAPABILITY_ORDER) {
    if (normalized.includes(token)) return token;
  }
  return normalized[0] || null;
}

function getProviderColor(providerId) {
  const normalizedProviderId = normalizeProviderId(providerId);
  return normalizedProviderId ? (PROVIDER_COLORS[normalizedProviderId] || null) : null;
}

function inferApiAgentCapabilities(params = {}) {
  const providerId = normalizeProviderId(params.provider_id || params.provider);
  const modelHint = [
    normalizeText(params.model_id || params.model),
    normalizeText(params.name),
  ].filter(Boolean).join(' ').toLowerCase();

  if (!providerId) return [];

  if (providerId === 'gemini' || providerId === 'dalle' || providerId === 'replicate') {
    if (modelHint.indexOf('video') !== -1 || modelHint.indexOf('runway') !== -1 || modelHint.indexOf('kling') !== -1) {
      return ['video_generation'];
    }
    if (modelHint.indexOf('texture') !== -1 || modelHint.indexOf('material') !== -1) {
      return ['texture_generation'];
    }
    return ['image_generation'];
  }

  if (providerId === 'comfyui') {
    if (modelHint.indexOf('video') !== -1 || modelHint.indexOf('wan') !== -1 || modelHint.indexOf('i2v') !== -1) {
      return ['video_generation'];
    }
    if (modelHint.indexOf('3d') !== -1 || modelHint.indexOf('mesh') !== -1 || modelHint.indexOf('texture') !== -1) {
      return ['texture_generation'];
    }
    return ['image_generation'];
  }

  if (providerId === 'zai') {
    if (modelHint.indexOf('image') !== -1 || modelHint === 'glm-image') {
      return ['image_generation'];
    }
    if (modelHint.indexOf('video') !== -1 || modelHint.indexOf('cogvideo') !== -1) {
      return ['video_generation'];
    }
    if (modelHint.indexOf('4.6v') !== -1 || modelHint.indexOf('vision') !== -1) {
      return ['vision', 'chat'];
    }
    return ['chat'];
  }

  if (providerId === 'ollama') {
    if (modelHint.indexOf('vision') !== -1 || modelHint.indexOf('llava') !== -1) {
      return ['vision', 'chat'];
    }
    if (modelHint.indexOf('sdxl') !== -1 || modelHint.indexOf('flux') !== -1 || modelHint.indexOf('stable') !== -1) {
      return ['image_generation'];
    }
    return ['chat'];
  }

  return ['chat'];
}

function createApiAgentRuntimeDescriptor(params = {}) {
  return {
    runtime_type: 'api',
    provider_id: normalizeProviderId(params.provider_id || params.provider),
    model_id: normalizeText(params.model_id || params.model),
    capabilities: normalizeCapabilities(params.capabilities).length > 0
      ? normalizeCapabilities(params.capabilities)
      : inferApiAgentCapabilities(params),
  };
}

function collectInvalidCapabilityTokens(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) return ['<non-array>'];

  const invalid = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text) {
      invalid.push(String(entry));
      continue;
    }
    if (!VALID_CAPABILITY_SET.has(text.toLowerCase())) invalid.push(text);
  }
  return invalid;
}

function validateExplicitRuntimeDescriptor(descriptor = {}) {
  const normalized = {
    runtime_type: normalizeRuntimeType(descriptor.runtime_type),
    provider_id: normalizeProviderId(descriptor.provider_id),
    model_id: normalizeText(descriptor.model_id),
    capabilities: normalizeCapabilities(descriptor.capabilities),
  };
  const errors = [];

  if (!normalized.runtime_type) {
    errors.push(`runtime_type must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`);
  }
  if (!normalized.provider_id) errors.push('provider_id is required');
  if (!normalized.model_id) errors.push('model_id is required');
  if (!Array.isArray(descriptor.capabilities)) errors.push('capabilities must be an array');

  const invalidCapabilityTokens = collectInvalidCapabilityTokens(descriptor.capabilities);
  if (invalidCapabilityTokens.length > 0) {
    errors.push(`capabilities contains unsupported token(s): ${invalidCapabilityTokens.join(', ')}`);
  }
  if (normalized.capabilities.length === 0) {
    errors.push(`capabilities must include at least one supported token: ${VALID_CAPABILITIES.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

function resolveAgentRuntimeMetadata(params = {}) {
  const runtimeType = normalizeRuntimeType(params.runtime_type) || (params.is_api_agent ? 'api' : null);
  const providerId = normalizeProviderId(params.provider_id || params.provider);
  const modelId = normalizeText(params.model_id || params.model);

  let capabilities = normalizeCapabilities(params.capabilities);
  if (capabilities.length === 0) {
    const legacyCapability = normalizeLegacyCapability(params.bot_capability);
    if (legacyCapability) capabilities = [legacyCapability];
  }
  if (capabilities.length === 0 && (runtimeType === 'api' || params.is_api_agent)) {
    capabilities = inferApiAgentCapabilities({
      provider_id: providerId,
      model_id: modelId,
      name: params.name,
    });
  }

  const primaryCapability = getPrimaryCapability(capabilities);
  const projectedProvider = providerId || normalizeProviderId(params.provider) || normalizeText(params.provider);

  return {
    runtime_type: runtimeType,
    provider_id: providerId,
    model_id: modelId,
    capabilities,
    provider: projectedProvider || null,
    provider_color: getProviderColor(projectedProvider) || params.provider_color || null,
    bot_capability: primaryCapability
      ? projectLegacyCapability(primaryCapability)
      : (normalizeText(params.bot_capability) || null),
  };
}

module.exports = {
  PROVIDER_COLORS,
  VALID_RUNTIME_TYPES,
  VALID_CAPABILITIES,
  createApiAgentRuntimeDescriptor,
  inferApiAgentCapabilities,
  getPrimaryCapability,
  getProviderColor,
  projectLegacyCapability,
  resolveAgentRuntimeMetadata,
  validateExplicitRuntimeDescriptor,
};
