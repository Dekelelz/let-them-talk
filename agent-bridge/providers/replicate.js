// Replicate provider adapter (Phase 5 — placeholder for Flux, Wan, SD)
const https = require('https');

class ReplicateProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'stability-ai/sdxl';
    this.name = 'replicate';
    this.color = '#8b5cf6'; // purple
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error('Replicate API key not configured');

    const body = JSON.stringify({
      version: this._getVersion(),
      input: { prompt: prompt, ...options },
    });

    // Create prediction
    const prediction = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.replicate.com',
        path: '/v1/predictions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Token ${this.apiKey}`,
        },
        timeout: 30000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Failed to parse Replicate response'));
          }
        });
      });
      req.on('error', (e) => reject(new Error('Replicate connection failed: ' + e.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Replicate request timed out')); });
      req.write(body);
      req.end();
    });

    if (prediction.error) throw new Error(prediction.error.detail || 'Replicate error');

    // Poll for completion
    const result = await this._pollResult(prediction.urls.get);
    if (result.output && result.output.length > 0) {
      return {
        type: 'image',
        data: result.output[0], // URL
        format: 'url',
        model: this.model,
        prompt: prompt,
      };
    }
    throw new Error('No output from Replicate');
  }

  async _pollResult(url, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const result = await new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = https.request({
          hostname: parsedUrl.hostname,
          path: parsedUrl.pathname,
          method: 'GET',
          headers: { 'Authorization': `Token ${this.apiKey}` },
          timeout: 10000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { reject(new Error('Parse error')); }
          });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Poll timeout')); });
        req.end();
      });
      if (result.status === 'succeeded') return result;
      if (result.status === 'failed' || result.status === 'canceled') {
        throw new Error('Replicate prediction ' + result.status);
      }
    }
    throw new Error('Replicate prediction timed out');
  }

  _getVersion() {
    const versions = {
      'stability-ai/sdxl': '39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b',
      'black-forest-labs/flux': 'latest',
    };
    return versions[this.model] || 'latest';
  }

  async checkHealth() {
    return !!this.apiKey;
  }

  async listModels() {
    return [
      { name: 'stability-ai/sdxl', size: 'cloud' },
      { name: 'black-forest-labs/flux-schnell', size: 'cloud' },
      { name: 'black-forest-labs/flux-dev', size: 'cloud' },
    ];
  }
}

module.exports = { ReplicateProvider };
