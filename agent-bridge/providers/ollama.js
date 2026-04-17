// Ollama provider adapter for local AI model inference
// Supports text-to-image models (SDXL, Flux, etc.) and vision models

const http = require('http');
const https = require('https');

class OllamaProvider {
  constructor(options = {}) {
    this.endpoint = options.endpoint || 'http://localhost:11434';
    this.model = options.model || 'sdxl';
    this.name = 'ollama';
    this.color = '#0ea5e9'; // blue
  }

  async generate(prompt, options = {}) {
    const url = new URL(this.endpoint);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    // Try image generation first (for models that support it)
    const imageResult = await this._tryImageGeneration(transport, url, prompt, options);
    if (imageResult) return imageResult;

    // Fallback: use chat completion with image description
    return this._textGeneration(transport, url, prompt, options);
  }

  async _tryImageGeneration(transport, url, prompt, options) {
    // Ollama doesn't have a native image generation API yet,
    // but some setups expose it via compatible endpoints.
    // Try the /api/generate endpoint with image-capable models
    const body = JSON.stringify({
      model: this.model,
      prompt: prompt,
      stream: false,
      options: {
        num_predict: options.maxTokens || 4096,
      }
    });

    return new Promise((resolve) => {
      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 11434),
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            // Check if response contains base64 image data
            if (result.images && result.images.length > 0) {
              resolve({
                type: 'image',
                data: result.images[0], // base64
                format: 'png',
                model: this.model,
                prompt: prompt,
              });
            } else if (result.response) {
              // Text-only response — model doesn't generate images
              resolve({
                type: 'text',
                data: result.response,
                model: this.model,
                prompt: prompt,
              });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.write(body);
      req.end();
    });
  }

  async _textGeneration(transport, url, prompt, options) {
    const body = JSON.stringify({
      model: this.model,
      prompt: `Generate a detailed visual description for: ${prompt}`,
      stream: false,
    });

    return new Promise((resolve, reject) => {
      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 11434),
        path: '/api/generate',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 120000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve({
              type: 'text',
              data: result.response || 'No response from model',
              model: this.model,
              prompt: prompt,
            });
          } catch (e) {
            reject(new Error('Failed to parse Ollama response: ' + e.message));
          }
        });
      });
      req.on('error', (e) => reject(new Error('Ollama connection failed: ' + e.message)));
      req.on('timeout', () => { req.destroy(); reject(new Error('Ollama request timed out')); });
      req.write(body);
      req.end();
    });
  }

  async listModels() {
    const url = new URL(this.endpoint);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise((resolve) => {
      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 11434),
        path: '/api/tags',
        method: 'GET',
        timeout: 10000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve((result.models || []).map(m => ({
              name: m.name,
              size: m.size,
              modified: m.modified_at,
            })));
          } catch {
            resolve([]);
          }
        });
      });
      req.on('error', () => resolve([]));
      req.on('timeout', () => { req.destroy(); resolve([]); });
      req.end();
    });
  }

  async checkHealth() {
    const url = new URL(this.endpoint);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;

    return new Promise((resolve) => {
      const req = transport.request({
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 11434),
        path: '/',
        method: 'GET',
        timeout: 5000,
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(res.statusCode === 200));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }
}

module.exports = { OllamaProvider };
