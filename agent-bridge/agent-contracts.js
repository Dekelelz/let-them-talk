const VALID_AGENT_ARCHETYPES = Object.freeze([
  'generalist',
  'coordinator',
  'implementer',
  'reviewer',
  'advisor',
  'monitor',
]);

const VALID_CONTRACT_MODES = Object.freeze(['advisory', 'strict']);

const ROLE_TOKEN_ALIASES = Object.freeze({
  lead: 'lead',
  manager: 'manager',
  coordinator: 'coordinator',
  architect: 'architect',
  backend: 'backend',
  frontend: 'frontend',
  implementer: 'implementer',
  developer: 'implementer',
  coder: 'implementer',
  quality: 'quality',
  'quality lead': 'quality',
  reviewer: 'reviewer',
  advisor: 'advisor',
  monitor: 'monitor',
});

function freezeArchetype(definition) {
  return Object.freeze({
    label: definition.label,
    summary: definition.summary,
    compatible_roles: Object.freeze([...(definition.compatible_roles || [])]),
    default_skills: Object.freeze([...(definition.default_skills || [])]),
    keywords: Object.freeze([...(definition.keywords || [])]),
    preferred_work_types: Object.freeze([...(definition.preferred_work_types || [])]),
    discouraged_work_types: Object.freeze([...(definition.discouraged_work_types || [])]),
  });
}

const AGENT_ARCHETYPE_REGISTRY = Object.freeze({
  generalist: freezeArchetype({
    label: 'Generalist',
    summary: 'Flexible contributor who can work across planning, implementation, review, and coordination as needed.',
    compatible_roles: ['lead', 'manager', 'coordinator', 'architect', 'backend', 'frontend', 'implementer', 'quality', 'reviewer', 'advisor', 'monitor'],
    default_skills: [],
    keywords: ['general', 'support'],
    preferred_work_types: ['workflow_step', 'claimed_task', 'task', 'review', 'help_teammate', 'unblock', 'prep_work', 'messages', 'team_coordination', 'managed_manager'],
    discouraged_work_types: [],
  }),
  coordinator: freezeArchetype({
    label: 'Coordinator',
    summary: 'Best at planning, triage, delegation, and keeping the team moving.',
    compatible_roles: ['lead', 'manager', 'coordinator'],
    default_skills: ['planning', 'coordination', 'delegation'],
    keywords: ['plan', 'planning', 'coordinate', 'coordination', 'delegate', 'workflow', 'triage'],
    preferred_work_types: ['messages', 'help_teammate', 'unblock', 'prep_work', 'review', 'team_coordination', 'managed_manager'],
    discouraged_work_types: [],
  }),
  implementer: freezeArchetype({
    label: 'Implementer',
    summary: 'Best at building, fixing, and shipping concrete code changes.',
    compatible_roles: ['architect', 'backend', 'frontend', 'implementer'],
    default_skills: ['implementation', 'backend', 'frontend', 'testing'],
    keywords: ['implement', 'implementation', 'build', 'fix', 'code', 'refactor', 'backend', 'frontend', 'api', 'ui', 'bug', 'test'],
    preferred_work_types: ['workflow_step', 'claimed_task', 'task', 'prep_work', 'help_teammate'],
    discouraged_work_types: [],
  }),
  reviewer: freezeArchetype({
    label: 'Reviewer',
    summary: 'Best at review, verification, test emphasis, and defect finding.',
    compatible_roles: ['quality', 'reviewer'],
    default_skills: ['review', 'testing', 'verification'],
    keywords: ['review', 'verify', 'verification', 'test', 'testing', 'qa', 'quality', 'bug', 'security'],
    preferred_work_types: ['review', 'unblock', 'help_teammate'],
    discouraged_work_types: [],
  }),
  advisor: freezeArchetype({
    label: 'Advisor',
    summary: 'Best at analysis, architecture, strategy, and guidance rather than task claiming.',
    compatible_roles: ['advisor'],
    default_skills: ['analysis', 'architecture', 'strategy'],
    keywords: ['analysis', 'architecture', 'strategy', 'design', 'research', 'plan'],
    preferred_work_types: ['messages', 'help_teammate', 'prep_work', 'unblock', 'advisor_context'],
    discouraged_work_types: ['workflow_step', 'claimed_task', 'task', 'team_coordination', 'managed_manager'],
  }),
  monitor: freezeArchetype({
    label: 'Monitor',
    summary: 'Best at health checks, triage, queue balancing, and unblocking the team.',
    compatible_roles: ['monitor'],
    default_skills: ['monitoring', 'triage', 'coordination'],
    keywords: ['monitor', 'health', 'triage', 'stuck', 'queue', 'rebalance', 'intervention'],
    preferred_work_types: ['messages', 'help_teammate', 'unblock', 'idle', 'monitor_report'],
    discouraged_work_types: ['workflow_step', 'claimed_task', 'task', 'team_coordination', 'managed_manager'],
  }),
});

const VALID_ARCHETYPE_SET = new Set(VALID_AGENT_ARCHETYPES);
const VALID_CONTRACT_MODE_SET = new Set(VALID_CONTRACT_MODES);
const KNOWN_ROLE_TOKENS = new Set(Object.values(ROLE_TOKEN_ALIASES));

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeLowerToken(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeRoleToken(value) {
  const normalized = normalizeLowerToken(value);
  if (!normalized) return null;
  if (ROLE_TOKEN_ALIASES[normalized]) return ROLE_TOKEN_ALIASES[normalized];
  if (normalized.indexOf('implementer') === 0) return 'implementer';
  return normalized;
}

function normalizeArchetype(value) {
  const normalized = normalizeLowerToken(value);
  if (!normalized) return null;
  return VALID_ARCHETYPE_SET.has(normalized) ? normalized : null;
}

function normalizeContractMode(value) {
  const normalized = normalizeLowerToken(value);
  if (!normalized) return null;
  return VALID_CONTRACT_MODE_SET.has(normalized) ? normalized : null;
}

function normalizeSkillToken(value) {
  return normalizeLowerToken(value);
}

function normalizeWorkType(value) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeSkills(value) {
  const entries = Array.isArray(value)
    ? value
    : (value == null ? [] : [value]);
  const normalized = [];
  const seen = new Set();

  for (const entry of entries) {
    const token = normalizeSkillToken(entry);
    if (!token || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function mergeSkills() {
  const merged = [];
  const seen = new Set();

  for (const list of arguments) {
    for (const entry of Array.isArray(list) ? list : []) {
      const token = normalizeSkillToken(entry);
      if (!token || seen.has(token)) continue;
      seen.add(token);
      merged.push(token);
    }
  }

  return merged;
}

function inferArchetypeFromRole(roleToken) {
  if (!roleToken) return null;
  const orderedArchetypes = ['coordinator', 'implementer', 'reviewer', 'advisor', 'monitor', 'generalist'];
  for (const archetype of orderedArchetypes) {
    const definition = AGENT_ARCHETYPE_REGISTRY[archetype];
    if (definition.compatible_roles.includes(roleToken)) return archetype;
  }
  return null;
}

function createDefaultContractMetadata() {
  return {
    skills: [],
    contract_mode: 'advisory',
  };
}

function sanitizeContractProfilePatch(input = {}) {
  const errors = [];
  const normalized = {};

  if (Object.prototype.hasOwnProperty.call(input, 'archetype')) {
    if (input.archetype == null || normalizeText(input.archetype) == null) {
      normalized.archetype = null;
    } else {
      const archetype = normalizeArchetype(input.archetype);
      if (!archetype) {
        errors.push(`archetype must be one of: ${VALID_AGENT_ARCHETYPES.join(', ')}`);
      } else {
        normalized.archetype = archetype;
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'skills')) {
    if (input.skills == null) {
      normalized.skills = [];
    } else if (!Array.isArray(input.skills) && typeof input.skills !== 'string') {
      errors.push('skills must be a string or an array of strings');
    } else if (typeof input.skills === 'string' && normalizeText(input.skills) == null) {
      normalized.skills = [];
    } else {
      normalized.skills = normalizeSkills(input.skills);
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'contract_mode')) {
    if (input.contract_mode == null || normalizeText(input.contract_mode) == null) {
      normalized.contract_mode = 'advisory';
    } else {
      const contractMode = normalizeContractMode(input.contract_mode);
      if (!contractMode) {
        errors.push(`contract_mode must be one of: ${VALID_CONTRACT_MODES.join(', ')}`);
      } else {
        normalized.contract_mode = contractMode;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized,
  };
}

function resolveAgentContract(profile = {}) {
  const rawRole = normalizeText(profile.role) || '';
  const roleToken = normalizeRoleToken(profile.role);
  const roleRecognized = roleToken ? KNOWN_ROLE_TOKENS.has(roleToken) : false;
  const declaredArchetype = normalizeArchetype(profile.archetype);
  const resolvedArchetype = declaredArchetype || inferArchetypeFromRole(roleToken);
  const declaredSkills = normalizeSkills(profile.skills);
  const registryEntry = resolvedArchetype ? AGENT_ARCHETYPE_REGISTRY[resolvedArchetype] : null;
  const effectiveSkills = mergeSkills(declaredSkills, registryEntry ? registryEntry.default_skills : []);
  const contractMode = normalizeContractMode(profile.contract_mode) || 'advisory';
  const explicitMode = normalizeContractMode(profile.contract_mode);

  let roleAlignment = 'none';
  if (declaredArchetype && roleToken) {
    if (registryEntry && registryEntry.compatible_roles.includes(roleToken)) {
      roleAlignment = 'aligned';
    } else if (roleRecognized) {
      roleAlignment = 'mismatch';
    } else {
      roleAlignment = 'unknown_role';
    }
  } else if (declaredArchetype) {
    roleAlignment = 'archetype_only';
  } else if (roleToken) {
    roleAlignment = 'legacy_role_only';
  }

  const hasExplicitContract = !!(
    declaredArchetype
    || declaredSkills.length > 0
    || (explicitMode && explicitMode !== 'advisory')
  );

  return {
    role: rawRole,
    role_token: roleToken,
    role_recognized: roleRecognized,
    declared_archetype: declaredArchetype,
    archetype: resolvedArchetype,
    skills: declaredSkills,
    effective_skills: effectiveSkills,
    contract_mode: contractMode,
    role_alignment: roleAlignment,
    has_explicit_contract: hasExplicitContract,
    has_advisory_context: hasExplicitContract || !!roleToken,
    registry_entry: registryEntry,
  };
}

function buildGuideContractAdvisory(contract) {
  if (!contract || !contract.has_advisory_context) return null;

  let status = 'legacy';
  let summary;

  if (contract.declared_archetype && contract.role_alignment === 'aligned') {
    status = 'aligned';
    summary = `Declared archetype "${contract.declared_archetype}" aligns with role "${contract.role || contract.role_token}".`;
  } else if (contract.declared_archetype && contract.role_alignment === 'mismatch') {
    status = 'mismatch';
    summary = `Declared archetype "${contract.declared_archetype}" may be a weaker fit for role "${contract.role || contract.role_token}".`;
  } else if (contract.declared_archetype && contract.role_alignment === 'unknown_role') {
    status = 'legacy';
    summary = `Declared archetype "${contract.declared_archetype}" is active, while role "${contract.role}" remains a compatibility-only free-form label.`;
  } else if (contract.declared_archetype) {
    status = 'aligned';
    summary = `Declared archetype "${contract.declared_archetype}" is active in ${contract.contract_mode} mode.`;
  } else {
    summary = contract.role
      ? `Legacy role "${contract.role}" remains active during contract migration.`
      : `Contract mode is ${contract.contract_mode}.`;
  }

  const recommendation = contract.registry_entry
    ? contract.registry_entry.summary
    : 'Add an archetype and skills[] if you want more explicit advisory guidance.';

  return {
    status,
    summary,
    recommendation,
    migration_note: contract.contract_mode === 'strict'
      ? 'Strict intent is recorded, but this Task 11B slice keeps contract handling advisory outside existing managed-mode and evidence gates.'
      : null,
  };
}

function collectFitKeywords(contract, text) {
  if (!contract || !text) return [];

  const haystack = String(text).toLowerCase();
  const candidates = mergeSkills(
    contract.skills,
    contract.effective_skills,
    contract.registry_entry ? contract.registry_entry.keywords : []
  );

  const matches = [];
  for (const token of candidates) {
    if (token.length < 3) continue;
    if (haystack.includes(token) && !matches.includes(token)) matches.push(token);
    if (matches.length >= 4) break;
  }
  return matches;
}

function analyzeContractFit(contract, target = {}) {
  if (!contract || !contract.has_advisory_context) return null;

  const workType = normalizeWorkType(target.work_type) || 'task';
  const title = normalizeText(target.title) || '';
  const description = normalizeText(target.description) || '';
  const text = `${title} ${description}`.trim();
  const keywordMatches = collectFitKeywords(contract, text);
  const registryEntry = contract.registry_entry;
  const assigned = !!target.assigned;
  let score = 0;

  if (registryEntry && registryEntry.preferred_work_types.includes(workType)) score += 2;
  if (registryEntry && registryEntry.discouraged_work_types.includes(workType)) score -= 2;
  if (keywordMatches.length > 0) score += keywordMatches.length >= 2 ? 2 : 1;

  let status = 'neutral';
  if (score >= 2) status = 'aligned';
  else if (score === 1) status = 'partial';
  else if (score < 0) status = 'mismatch';

  let summary;
  if (status === 'aligned') {
    summary = contract.archetype
      ? `This ${workType.replace(/_/g, ' ')} fits your ${contract.archetype} contract.`
      : 'This work fits your current legacy role guidance.';
  } else if (status === 'partial') {
    summary = contract.archetype
      ? `This ${workType.replace(/_/g, ' ')} partially fits your ${contract.archetype} contract.`
      : 'This work partially fits your current legacy role guidance.';
  } else if (status === 'mismatch' && assigned) {
    summary = contract.archetype
      ? `This assigned work may be a weaker fit for your ${contract.archetype} contract, but assigned work still takes precedence in this advisory slice.`
      : 'This assigned work may be a weaker fit for your current legacy role guidance, but assigned work still takes precedence in this advisory slice.';
  } else if (status === 'mismatch') {
    summary = contract.archetype
      ? `This ${workType.replace(/_/g, ' ')} may be a weaker fit for your ${contract.archetype} contract.`
      : 'This work may be a weaker fit for your current legacy role guidance.';
  } else {
    summary = contract.archetype
      ? `No strong contract fit signal for this ${workType.replace(/_/g, ' ')}.`
      : 'No strong contract fit signal for this work item.';
  }

  return {
    status,
    summary,
    keyword_matches: keywordMatches,
    recommendation: registryEntry ? registryEntry.summary : null,
    migration_note: contract.contract_mode === 'strict' && status !== 'aligned'
      ? 'Strict intent is recorded, but Task 11B surfaces this only as advisory guidance.'
      : null,
  };
}

function buildRuntimeContractMetadata(contract) {
  if (!contract) {
    return {
      archetype: '',
      skills: [],
      contract_mode: 'advisory',
      has_explicit_contract: false,
      contract: null,
    };
  }

  return {
    archetype: contract.declared_archetype || '',
    skills: contract.skills,
    contract_mode: contract.contract_mode,
    has_explicit_contract: contract.has_explicit_contract,
    contract: {
      archetype: contract.archetype || null,
      declared_archetype: contract.declared_archetype || null,
      role_token: contract.role_token || null,
      role_alignment: contract.role_alignment,
      skills: contract.skills,
      effective_skills: contract.effective_skills,
      contract_mode: contract.contract_mode,
      has_explicit_contract: contract.has_explicit_contract,
    },
  };
}

module.exports = {
  AGENT_ARCHETYPE_REGISTRY,
  VALID_AGENT_ARCHETYPES,
  VALID_CONTRACT_MODES,
  analyzeContractFit,
  buildGuideContractAdvisory,
  buildRuntimeContractMetadata,
  createDefaultContractMetadata,
  normalizeArchetype,
  normalizeContractMode,
  normalizeRoleToken,
  normalizeSkills,
  resolveAgentContract,
  sanitizeContractProfilePatch,
};
