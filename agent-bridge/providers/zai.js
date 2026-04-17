// Z.AI (GLM) provider - chat + image generation via Z.AI API
// API docs: https://docs.z.ai/guides/overview/quick-start
// Models: glm-5 (chat), glm-4.6v (vision), glm-image (image gen), cogvideox-3 (video)

const https = require('https');

var API_HOST = 'api.z.ai';

class ZaiProvider {
  constructor(options) {
    options = options || {};
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'glm-5';
    this.name = 'zai';
    this.color = '#4f46e5'; // Z.AI indigo
    // Use coding endpoint if specified, otherwise try coding first (most users have coding plan)
    this.useCodingEndpoint = options.useCodingEndpoint !== false;
    this._apiBase = this.useCodingEndpoint ? '/api/coding/paas/v4' : '/api/paas/v4';
  }

  async generate(prompt, options) {
    options = options || {};
    if (!this.apiKey) throw new Error('Z.AI API key not configured');

    // Route by model type
    if (this.model === 'glm-image' || this.model.indexOf('image') !== -1) {
      return this._generateImage(prompt, options);
    }
    if (this.model === 'cogvideox-3' || this.model.indexOf('video') !== -1) {
      return this._generateText(prompt, options); // video gen returns task ID, treat as text for now
    }

    // Default: chat completion
    return this._generateText(prompt, options);
  }

  async _generateText(prompt, options) {
    var messages = [
      { role: 'system', content: 'You are a helpful AI assistant working in a multi-agent team. Be concise and actionable.' },
      { role: 'user', content: prompt },
    ];

    // If images attached, use vision model format
    if (options.images && options.images.length > 0) {
      var userContent = [{ type: 'text', text: prompt }];
      for (var i = 0; i < options.images.length; i++) {
        userContent.push({
          type: 'image_url',
          image_url: { url: 'data:' + options.images[i].mimeType + ';base64,' + options.images[i].base64 }
        });
      }
      messages = [
        { role: 'system', content: 'You are a helpful AI assistant with vision capabilities.' },
        { role: 'user', content: userContent },
      ];
    }

    var body = JSON.stringify({
      model: this.model,
      messages: messages,
    });

    var self = this;
    return new Promise(function(resolve, reject) {
      var req = https.request({
        hostname: API_HOST,
        path: self._apiBase + '/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US,en',
          'Authorization': 'Bearer ' + self.apiKey,
        },
        timeout: 120000,
      }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var result = JSON.parse(data);
            if (result.error) {
              reject(new Error('Z.AI API error: ' + (result.error.message || JSON.stringify(result.error))));
              return;
            }
            if (result.choices && result.choices[0] && result.choices[0].message) {
              resolve({
                type: 'text',
                data: result.choices[0].message.content,
                model: self.model,
                prompt: prompt,
              });
            } else {
              reject(new Error('Empty response from Z.AI'));
            }
          } catch (e) {
            reject(new Error('Failed to parse Z.AI response: ' + e.message));
          }
        });
      });
      req.on('error', function(e) { reject(new Error('Z.AI connection failed: ' + e.message)); });
      req.on('timeout', function() { req.destroy(); reject(new Error('Z.AI request timed out')); });
      req.write(body);
      req.end();
    });
  }

  async _generateImage(prompt, options) {
    var body = JSON.stringify({
      model: this.model,
      prompt: prompt,
    });

    var self = this;
    return new Promise(function(resolve, reject) {
      var req = https.request({
        hostname: API_HOST,
        path: self._apiBase + '/images/generations',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': 'en-US,en',
          'Authorization': 'Bearer ' + self.apiKey,
        },
        timeout: 120000,
      }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var result = JSON.parse(data);
            if (result.error) {
              reject(new Error('Z.AI image error: ' + (result.error.message || JSON.stringify(result.error))));
              return;
            }
            if (result.data && result.data[0]) {
              var imgData = result.data[0];
              if (imgData.b64_json) {
                resolve({
                  type: 'image',
                  data: imgData.b64_json,
                  format: 'png',
                  model: self.model,
                  prompt: prompt,
                });
              } else if (imgData.url) {
                resolve({
                  type: 'image',
                  data: imgData.url,
                  format: 'url',
                  model: self.model,
                  prompt: prompt,
                });
              }
            } else {
              reject(new Error('No image data from Z.AI'));
            }
          } catch (e) {
            reject(new Error('Failed to parse Z.AI image response: ' + e.message));
          }
        });
      });
      req.on('error', function(e) { reject(new Error('Z.AI connection failed: ' + e.message)); });
      req.on('timeout', function() { req.destroy(); reject(new Error('Z.AI request timed out')); });
      req.write(body);
      req.end();
    });
  }

  async checkHealth() {
    return !!this.apiKey;
  }

  async listModels() {
    return [
      { name: 'glm-5', size: 'cloud', description: 'Flagship chat + agentic model' },
      { name: 'glm-4.6v', size: 'cloud', description: 'Multimodal vision (128K context)' },
      { name: 'glm-image', size: 'cloud', description: 'Text-to-image generation' },
      { name: 'cogvideox-3', size: 'cloud', description: 'Video frame generation' },
    ];
  }
}

module.exports = { ZaiProvider };
