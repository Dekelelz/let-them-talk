// API Agent Engine — registration, heartbeat, canonical message polling, provider dispatch
// API agents run inside the dashboard process and poll canonical branch/channel projections for requests

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { OllamaProvider } = require('./providers/ollama');
const { DalleProvider } = require('./providers/dalle');
const { ReplicateProvider } = require('./providers/replicate');
const { GeminiProvider } = require('./providers/gemini');
const { ComfyUIProvider } = require('./providers/comfyui');
const { ZaiProvider } = require('./providers/zai');
const {
  PROVIDER_COLORS,
  createApiAgentRuntimeDescriptor,
  resolveAgentRuntimeMetadata,
  validateExplicitRuntimeDescriptor,
} = require('./runtime-descriptor');
const { createCanonicalState } = require('./state/canonical');

const PROVIDERS = {
  ollama: OllamaProvider,
  dalle: DalleProvider,
  replicate: ReplicateProvider,
  gemini: GeminiProvider,
  comfyui: ComfyUIProvider,
  zai: ZaiProvider,
};

class ApiAgentEngine {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.agents = {}; // name -> { config, provider, pollInterval, running, stats }
    this._configFile = path.join(dataDir, 'api-agents.json');
    this._mediaFile = path.join(dataDir, 'media.jsonl');
    this._mediaDir = path.join(dataDir, 'media');
    this._canonicalState = createCanonicalState({ dataDir, processPid: process.pid });
    this._loadConfigs();
  }

  _loadConfigs() {
    try {
      if (fs.existsSync(this._configFile)) {
        const configs = JSON.parse(fs.readFileSync(this._configFile, 'utf8'));
        for (const cfg of configs) {
          const normalizedConfig = this._normalizeAgentConfig(cfg.name, cfg);
          this.agents[cfg.name] = this._createAgentState(normalizedConfig);
          this._registerInAgentsJson(cfg.name, normalizedConfig.provider);
        }
      }
    } catch {}
  }

  _saveConfigs() {
    const configs = Object.values(this.agents).map(a => a.config);
    fs.writeFileSync(this._configFile, JSON.stringify(configs, null, 2));
  }

  _createProvider(config) {
    const ProviderClass = PROVIDERS[config.provider];
    if (!ProviderClass) return null;
    return new ProviderClass({
      endpoint: config.endpoint,
      model: config.model,
      apiKey: config.apiKey,
      ...config.options,
    });
  }

  _createAgentState(config) {
    return {
      config,
      provider: this._createProvider(config),
      pollInterval: null,
      heartbeatInterval: null,
      running: false,
      stats: { requests: 0, completed: 0, errors: 0, lastActivity: null },
      lastReadOffset: 0,
      seenMessageIds: new Set(),
      branchSessions: {},
      activeBranches: new Set(),
    };
  }

  _normalizeAgentConfig(name, config = {}) {
    const normalized = {
      ...config,
      options: config.options || {},
    };
    const descriptor = createApiAgentRuntimeDescriptor({
      name,
      provider_id: normalized.provider,
      model_id: normalized.model,
      capabilities: normalized.capabilities,
    });
    const validation = validateExplicitRuntimeDescriptor(descriptor);

    if (!validation.valid) return normalized;

    normalized.provider = descriptor.provider_id;
    normalized.model = descriptor.model_id;
    normalized.capabilities = descriptor.capabilities;
    return normalized;
  }

  _getAgentRuntimeMetadata(name) {
    const agent = this.agents[name];
    const config = agent ? this._normalizeAgentConfig(name, agent.config) : null;
    if (agent && config !== agent.config) agent.config = config;

    return resolveAgentRuntimeMetadata({
      name,
      is_api_agent: true,
      runtime_type: 'api',
      provider_id: config ? config.provider : null,
      model_id: config ? config.model : null,
      capabilities: config ? config.capabilities : null,
    });
  }

  // Register a new API agent
  create(name, provider, options = {}) {
    if (!name || !/^[a-zA-Z0-9_-]{1,20}$/.test(name)) {
      return { error: 'Invalid name (1-20 alphanumeric/underscore/dash)' };
    }
    if (this.agents[name]) {
      return { error: 'API agent already exists: ' + name };
    }
    if (!PROVIDERS[provider]) {
      return { error: 'Unknown provider: ' + provider + '. Available: ' + Object.keys(PROVIDERS).join(', ') };
    }

    const config = this._normalizeAgentConfig(name, {
      name,
      provider,
      model: options.model || 'sdxl',
      capabilities: options.capabilities,
      endpoint: options.endpoint || 'http://localhost:11434',
      apiKey: options.apiKey || '',
      options: options.providerOptions || {},
      created: new Date().toISOString(),
    });

    const descriptor = createApiAgentRuntimeDescriptor({
      name,
      provider_id: config.provider,
      model_id: config.model,
      capabilities: config.capabilities,
    });
    const validation = validateExplicitRuntimeDescriptor(descriptor);
    if (!validation.valid) {
      return { error: 'Invalid API agent runtime descriptor: ' + validation.errors.join('; ') };
    }

    this.agents[name] = this._createAgentState(config);

    this._saveConfigs();
    this._registerInAgentsJson(name, provider);
    return { ok: true, name, provider };
  }

  // Register API agent in agents.json so it appears in the dashboard + 3D Hub
  _registerInAgentsJson(name, provider) {
    const runtimeMetadata = this._getAgentRuntimeMetadata(name);
    this._canonicalState.registerApiAgent({
      name,
      agent: {
        pid: process.pid,
        last_activity: new Date().toISOString(),
        status: 'sleeping',
        role: 'api-agent',
        is_api_agent: true,
        runtime_type: runtimeMetadata.runtime_type,
        provider_id: runtimeMetadata.provider_id,
        model_id: runtimeMetadata.model_id,
        capabilities: runtimeMetadata.capabilities,
        provider: runtimeMetadata.provider || provider,
        provider_color: runtimeMetadata.provider_color || PROVIDER_COLORS[provider] || '#666',
        bot_capability: runtimeMetadata.bot_capability,
      },
      profile: {
        display_name: name,
        role: 'api-agent',
        bio: `${provider} API agent — generates media on request`,
        avatar: 'robot',
        is_api_agent: true,
        provider: runtimeMetadata.provider || provider,
      },
      createProfileIfMissing: true,
    });
  }

  // Remove API agent from agents.json
  _unregisterFromAgentsJson(name) {
    this._canonicalState.unregisterApiAgent(name);
  }

  // Delete an API agent
  remove(name) {
    if (!this.agents[name]) return { error: 'API agent not found: ' + name };
    this.stop(name);
    this._unregisterFromAgentsJson(name);
    delete this.agents[name];
    this._saveConfigs();
    return { ok: true };
  }

  // Start polling for messages
  start(name) {
    const agent = this.agents[name];
    if (!agent) return { error: 'API agent not found: ' + name };
    if (agent.running) return { ok: true, message: 'Already running' };

    agent.running = true;
    this._primeSeenMessages(name);
    this._updateAgentStatus(name, 'active');

    // Poll every 2 seconds
    agent.pollInterval = setInterval(() => {
      this._pollMessages(name);
    }, 2000);

    // Heartbeat every 10 seconds
    agent.heartbeatInterval = setInterval(() => {
      this._updateHeartbeat(name);
    }, 10000);

    return { ok: true };
  }

  // Stop polling
  stop(name) {
    const agent = this.agents[name];
    if (!agent) return { error: 'API agent not found: ' + name };

    agent.running = false;
    if (agent.pollInterval) { clearInterval(agent.pollInterval); agent.pollInterval = null; }
    if (agent.heartbeatInterval) { clearInterval(agent.heartbeatInterval); agent.heartbeatInterval = null; }
    this._interruptAgentSessions(name);
    this._updateAgentStatus(name, 'sleeping');
    return { ok: true };
  }

  // List all API agents with status
  list() {
    return Object.values(this.agents).map(a => {
      const runtimeMetadata = this._getAgentRuntimeMetadata(a.config.name);
      return {
        ...runtimeMetadata,
        name: a.config.name,
        provider: a.config.provider,
        model: a.config.model,
        endpoint: a.config.endpoint,
        hasApiKey: !!a.config.apiKey,
        running: a.running,
        stats: a.stats,
        color: runtimeMetadata.provider_color || PROVIDER_COLORS[a.config.provider] || '#666',
        created: a.config.created,
      };
    });
  }

  // Poll branch-scoped conversation history for new messages addressed to this API agent
  _pollMessages(name) {
    const agent = this.agents[name];
    if (!agent || !agent.running) return;

    try {
      const pendingMessages = this._collectPendingMessages(name);
      for (const entry of pendingMessages) {
        Promise.resolve(this._processMessage(name, entry.message, { branch: entry.branch }))
          .then((handled) => {
            if (handled) {
              this._markConsumedMessage(name, entry.branch, entry.message.id);
              return;
            }

            agent.seenMessageIds.delete(entry.message.id);
          })
          .catch(() => {
            agent.seenMessageIds.delete(entry.message.id);
          });
      }
    } catch {}
  }

  _listKnownBranches() {
    try {
      const branches = this._canonicalState.listMarkdownBranches();
      const names = Array.isArray(branches)
        ? branches.map((entry) => entry && entry.branch).filter(Boolean)
        : [];
      return names.length > 0 ? names : ['main'];
    } catch {
      return ['main'];
    }
  }

  _getConversationMessages(branch) {
    try {
      return this._canonicalState.getConversationMessages({ branch });
    } catch {
      return [];
    }
  }

  _primeSeenMessages(name) {
    const agent = this.agents[name];
    if (!agent) return;

    const seenMessageIds = new Set();
    for (const branch of this._listKnownBranches()) {
      const consumedIds = this._canonicalState.readConsumedMessageIds(name, { branch });
      for (const messageId of consumedIds) seenMessageIds.add(messageId);
    }

    agent.seenMessageIds = seenMessageIds;
    agent.lastReadOffset = seenMessageIds.size;
  }

  _readConsumedMessages(name, branch) {
    return this._canonicalState.readConsumedMessageIds(name, { branch });
  }

  _markConsumedMessage(name, branch, messageId) {
    const agent = this.agents[name];
    if (!agent || !messageId) return;

    const consumedIds = this._readConsumedMessages(name, branch);
    consumedIds.add(messageId);
    this._canonicalState.writeConsumedMessageIds(name, consumedIds, { branch });
    this._markSeenMessage(agent, messageId);
  }

  _markSeenMessage(agent, messageId) {
    if (!agent || !messageId) return;
    agent.seenMessageIds.add(messageId);
    agent.lastReadOffset = agent.seenMessageIds.size;
  }

  _collectPendingMessages(name) {
    const agent = this.agents[name];
    if (!agent) return [];

    const pending = [];
    for (const branch of this._listKnownBranches()) {
      const consumedIds = this._readConsumedMessages(name, branch);
      for (const message of this._getConversationMessages(branch)) {
        if (!message || !message.id || agent.seenMessageIds.has(message.id) || consumedIds.has(message.id)) continue;
        if (message.to !== name || !message.content) continue;
        agent.seenMessageIds.add(message.id);
        pending.push({ branch, message });
      }
    }

    pending.sort((left, right) => {
      const leftTime = Date.parse(left.message.timestamp || '') || 0;
      const rightTime = Date.parse(right.message.timestamp || '') || 0;
      if (leftTime !== rightTime) return leftTime - rightTime;
      return String(left.message.id).localeCompare(String(right.message.id));
    });

    return pending;
  }

  _ensureAgentBranchSession(name, branch) {
    const agent = this.agents[name];
    if (!agent) return null;

    try {
      const activation = this._canonicalState.ensureAgentSession({
        agentName: name,
        branchName: branch,
        sessionId: agent.branchSessions[branch] || null,
        provider: agent.config.provider,
        reason: 'api_agent_message',
      });
      const session = activation && activation.session ? activation.session : null;
      if (session && session.session_id) {
        agent.branchSessions[branch] = session.session_id;
        agent.activeBranches.add(branch);
      }
      try { this._canonicalState.updateAgentBranch(name, branch); } catch {}
      return session;
    } catch {
      return null;
    }
  }

  _interruptAgentSessions(name) {
    const agent = this.agents[name];
    if (!agent) return;

    for (const branch of agent.activeBranches) {
      try {
        this._canonicalState.transitionLatestSessionForAgent({
          agentName: name,
          branchName: branch,
          state: 'interrupted',
          reason: 'api_agent_stop',
        });
      } catch {}
    }

    agent.activeBranches = new Set();
    agent.branchSessions = {};
  }

  _buildReplyContext(msg, options = {}) {
    const branch = options.branch || 'main';
    const channel = msg && msg.channel && msg.channel !== 'general' ? msg.channel : null;

    return {
      branch,
      channel,
      replyTo: msg && msg.id ? msg.id : null,
      threadId: msg && (msg.thread_id || msg.id) ? (msg.thread_id || msg.id) : null,
      sessionId: options.sessionId || null,
      commandId: msg && msg.command_id ? msg.command_id : null,
      causationId: msg && msg.id ? msg.id : null,
      correlationId: msg && (msg.correlation_id || msg.command_id || msg.thread_id || msg.id)
        ? (msg.correlation_id || msg.command_id || msg.thread_id || msg.id)
        : null,
    };
  }

  // Process an incoming message
  async _processMessage(name, msg, context = {}) {
    const agent = this.agents[name];
    if (!agent || !agent.provider) return false;

    const branch = context.branch || 'main';
    const session = this._ensureAgentBranchSession(name, branch);
    const replyContext = this._buildReplyContext(msg, {
      branch,
      sessionId: session && session.session_id ? session.session_id : null,
    });

    agent.stats.requests++;
    agent.stats.lastActivity = new Date().toISOString();

    const content = msg.content || '';
    // Extract prompt — support "Generate: <prompt>" or just raw text
    let prompt = content;
    const genMatch = content.match(/^(?:Generate|Create|Make|Draw|Render):\s*(.+)/i);
    if (genMatch) prompt = genMatch[1].trim();

    // Detect media category from prompt keywords
    // texture: seamless patterns, materials, surfaces for 3D/game use
    // video: animations, motion, mp4 requests
    // image: everything else (concept art, photos, illustrations)
    let mediaCategory = 'image';
    const lowerPrompt = prompt.toLowerCase();
    if (/\b(texture|tileable|seamless|material|pbr|normal.?map|roughness.?map|diffuse|bump.?map|2d.?texture|surface.?pattern)\b/.test(lowerPrompt)) {
      mediaCategory = 'texture';
    } else if (/\b(video|animation|animate|mp4|motion|clip|footage)\b/.test(lowerPrompt)) {
      mediaCategory = 'video';
    }

    // Extract image attachments (base64)
    var imageAttachments = [];
    if (msg.attachments && Array.isArray(msg.attachments)) {
      for (const att of msg.attachments) {
        if (att.base64 && att.mimeType && att.mimeType.startsWith('image/')) {
          imageAttachments.push({ mimeType: att.mimeType, base64: att.base64 });
        }
      }
    }

    try {
      // Send "processing" response
      var attachNote = imageAttachments.length > 0 ? ' [+' + imageAttachments.length + ' image(s)]' : '';
      this._sendMessage(
        name,
        msg.from,
        `Processing: "${prompt.substring(0, 60)}${prompt.length > 60 ? '...' : ''}"${attachNote}`,
        msg.id,
        replyContext
      );

      const result = await agent.provider.generate(prompt, { images: imageAttachments });
      agent.stats.completed++;

      if (result.type === 'image' && result.data) {
        // Save media file
        const mediaId = crypto.randomUUID();
        const ext = result.format === 'url' ? 'png' : (result.format || 'png');
        const filename = `${mediaId}.${ext}`;

        // Ensure media directory exists
        if (!fs.existsSync(this._mediaDir)) fs.mkdirSync(this._mediaDir, { recursive: true });

        if (result.format === 'url') {
          // Download from URL
          await this._downloadFile(result.data, path.join(this._mediaDir, filename));
        } else {
          // Save base64 data
          const buffer = Buffer.from(result.data, 'base64');
          fs.writeFileSync(path.join(this._mediaDir, filename), buffer);
        }

        // Also save a named copy to generated-images/ in the project folder
        // so other agents can reference them by readable name
        const projectImgDir = path.join(this.dataDir, '..', 'generated-images');
        try {
          if (!fs.existsSync(projectImgDir)) fs.mkdirSync(projectImgDir, { recursive: true });
          const safeName = prompt.substring(0, 60).replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || 'image';
          const namedFile = safeName + '_' + mediaId.substring(0, 8) + '.' + ext;
          fs.copyFileSync(path.join(this._mediaDir, filename), path.join(projectImgDir, namedFile));
        } catch (e) { /* non-critical — media dir copy is the source of truth */ }

        // Log media metadata
        const mediaEntry = {
          id: mediaId,
          type: mediaCategory,
          prompt: prompt,
          agent: name,
          provider: agent.config.provider,
          model: agent.config.model,
          filename: filename,
          timestamp: new Date().toISOString(),
          requestedBy: msg.from,
        };
        fs.appendFileSync(this._mediaFile, JSON.stringify(mediaEntry) + '\n');

        // Send response with media reference
        this._sendMessage(name, msg.from,
          `Generated image: "${prompt.substring(0, 80)}"\nMedia ID: ${mediaId}\nModel: ${result.model || agent.config.model}${result.revised_prompt ? '\nRevised: ' + result.revised_prompt : ''}`,
          msg.id,
          replyContext
        );
      } else if (result.type === 'text') {
        this._sendMessage(name, msg.from, result.data, msg.id, replyContext);
      }
    } catch (err) {
      agent.stats.errors++;
      this._sendMessage(name, msg.from, `Error: ${err.message}`, msg.id, replyContext);
    }

    return true;
  }

  // Send a message from the API agent
  _sendMessage(from, to, content, replyTo) {
    const context = arguments[4] || {};
    const channel = context.channel && context.channel !== 'general' ? context.channel : null;
    const msg = {
      id: crypto.randomUUID(),
      from,
      to,
      content,
      timestamp: new Date().toISOString(),
      reply_to: replyTo || null,
      system: false,
    };

    if (channel) msg.channel = channel;
    if (context.threadId) msg.thread_id = context.threadId;
    if (context.sessionId) msg.session_id = context.sessionId;
    if (context.commandId) msg.command_id = context.commandId;
    if (context.causationId) msg.causation_id = context.causationId;
    if (context.correlationId) msg.correlation_id = context.correlationId;

    if (!context.branch && !channel && !context.sessionId && !context.commandId && !context.causationId && !context.correlationId) {
      this._canonicalState.appendMessage(msg);
      return msg;
    }

    this._canonicalState.appendScopedMessage(msg, {
      branch: context.branch,
      channel,
      actorAgent: from,
      sessionId: context.sessionId || null,
      commandId: context.commandId || null,
      causationId: context.causationId || null,
      correlationId: context.correlationId || null,
    });
    return msg;
  }

  // Update heartbeat in agents.json
  _updateHeartbeat(name) {
    this._canonicalState.updateAgentHeartbeat(name);
  }

  _updateAgentStatus(name, status) {
    this._canonicalState.updateAgentStatus(name, status);
  }

  _getMessageCount() {
    return Object.values(this.agents).reduce((total, agent) => total + (agent.lastReadOffset || 0), 0);
  }

  _downloadFile(url, dest) {
    const transport = url.startsWith('https') ? require('https') : require('http');
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      transport.get(url, { timeout: 60000 }, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(dest);
          return this._downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', (e) => {
        file.close();
        try { fs.unlinkSync(dest); } catch {}
        reject(e);
      });
    });
  }

  // Get media list (paginated, filterable)
  // Scans generated-images/ folder as the single source of truth
  getMedia(options = {}) {
    let items = [];
    const imageExts = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
    const genImgDir = path.join(this.dataDir, '..', 'generated-images');

    // Build a lookup from media.jsonl for metadata (prompt, agent, provider, model)
    const metaByShortId = {};
    if (fs.existsSync(this._mediaFile)) {
      try {
        const content = fs.readFileSync(this._mediaFile, 'utf8').trim();
        if (content) {
          const parsed = content.split(/\r?\n/).map(line => {
            try { return JSON.parse(line); } catch { return null; }
          }).filter(Boolean);
          for (const item of parsed) {
            // Match by short ID suffix in filename (e.g. "happy_pitbull_40e85ec7.png" matches id starting with "40e85ec7")
            const shortId = (item.id || '').substring(0, 8);
            if (shortId) metaByShortId[shortId] = item;
          }
        }
      } catch {}
    }

    // Scan generated-images/ folder
    if (fs.existsSync(genImgDir)) {
      try {
        const files = fs.readdirSync(genImgDir);
        for (const file of files) {
          const ext = path.extname(file).toLowerCase();
          if (!imageExts.has(ext)) continue;
          const filePath = path.join(genImgDir, file);
          const stat = fs.statSync(filePath);
          const baseName = path.basename(file, ext);
          // Extract short ID from end of filename (e.g. "happy_pitbull_40e85ec7" -> "40e85ec7")
          const idMatch = baseName.match(/_([a-f0-9]{8})$/);
          const shortId = idMatch ? idMatch[1] : null;
          const meta = shortId ? metaByShortId[shortId] : null;
          const name = baseName.replace(/_/g, ' ').replace(/\s+[a-f0-9]{8}$/, '');

          items.push({
            id: meta ? meta.id : ('file:gen:' + file),
            type: meta ? meta.type : 'image',
            prompt: meta ? meta.prompt : name,
            agent: meta ? meta.agent : 'imported',
            provider: meta ? meta.provider : 'file',
            model: meta ? meta.model : '',
            filename: file,
            timestamp: meta ? meta.timestamp : stat.mtime.toISOString(),
            _source: 'generated-images',
          });
        }
      } catch {}
    }

    // Filter by type
    if (options.type) items = items.filter(i => i.type === options.type);
    // Filter by agent
    if (options.agent) items = items.filter(i => i.agent === options.agent);

    // Sort newest first
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate
    const page = options.page || 1;
    const limit = options.limit || 20;
    const start = (page - 1) * limit;
    return items.slice(start, start + limit);
  }

  // Get media file path — serves from generated-images/ first, falls back to .agent-bridge/media/
  getMediaFilePath(id) {
    const genImgDir = path.join(this.dataDir, '..', 'generated-images');

    // Handle virtual file IDs from folder scan
    if (id.startsWith('file:gen:')) {
      const filename = id.slice('file:gen:'.length);
      const filePath = path.join(genImgDir, filename);
      return fs.existsSync(filePath) ? filePath : null;
    }

    // Look up in media.jsonl — find the named copy in generated-images/
    if (!fs.existsSync(this._mediaFile)) return null;
    try {
      const content = fs.readFileSync(this._mediaFile, 'utf8').trim();
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.id === id) {
            const shortId = item.id.substring(0, 8);
            // Look for the named copy in generated-images/
            if (fs.existsSync(genImgDir)) {
              const files = fs.readdirSync(genImgDir);
              const match = files.find(f => f.includes(shortId));
              if (match) return path.join(genImgDir, match);
            }
            // Fallback to .agent-bridge/media/
            const filePath = path.join(this._mediaDir, item.filename);
            return fs.existsSync(filePath) ? filePath : null;
          }
        } catch {}
      }
    } catch {}
    return null;
  }

  // Delete a media item
  deleteMedia(id) {
    if (!fs.existsSync(this._mediaFile)) return { error: 'No media found' };
    try {
      const content = fs.readFileSync(this._mediaFile, 'utf8').trim();
      const lines = content.split(/\r?\n/);
      const remaining = [];
      let found = false;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.id === id) {
            found = true;
            // Delete actual file
            const filePath = path.join(this._mediaDir, item.filename);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          } else {
            remaining.push(line);
          }
        } catch {
          remaining.push(line);
        }
      }
      if (!found) return { error: 'Media not found' };
      fs.writeFileSync(this._mediaFile, remaining.join('\n') + (remaining.length ? '\n' : ''));
      return { ok: true };
    } catch (e) { return { error: e.message }; }
  }

  // Stop all agents (cleanup on shutdown)
  stopAll() {
    for (const name in this.agents) {
      this.stop(name);
    }
  }
}

module.exports = { ApiAgentEngine, PROVIDER_COLORS };
