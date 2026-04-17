// Gemini API provider — text + image generation via Google's REST API
// Supports gemini-2.5-flash-image and gemini-3.1-flash-image-preview models
// Uses raw HTTP (no SDK dependency) for maximum compatibility

const https = require('https');
const fs = require('fs');
const path = require('path');

const API_HOST = 'generativelanguage.googleapis.com';
const API_BASE = '/v1beta/models/';

class GeminiProvider {
  constructor(options = {}) {
    this.apiKey = options.apiKey || '';
    this.model = options.model || 'gemini-3-pro-image-preview';
    this.name = 'gemini';
    this.color = '#4285f4'; // Google blue
  }

  async generate(prompt, options = {}) {
    if (!this.apiKey) throw new Error('Gemini API key not configured');

    var aspectRatio = options.aspectRatio || '16:9';

    // Build request parts — text + optional input images
    var parts = [{ text: prompt }];

    // Add input images if provided (for image-to-image / style reference)
    if (options.images && Array.isArray(options.images)) {
      for (var ii = 0; ii < options.images.length; ii++) {
        var img = options.images[ii];
        if (img.base64 && img.mimeType) {
          parts.push({
            inlineData: {
              mimeType: img.mimeType,
              data: img.base64,
            }
          });
        }
      }
    }

    var body = {
      contents: [{ parts: parts }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: aspectRatio,
        }
      }
    };

    // gemini-3.x models support imageSize — default to highest quality
    if (this.model.indexOf('gemini-3') === 0) {
      body.generationConfig.imageConfig.imageSize = options.imageSize || '4K';
    }

    var bodyStr = JSON.stringify(body);
    var apiPath = API_BASE + this.model + ':generateContent';
    var self = this;

    return new Promise(function(resolve, reject) {
      var req = https.request({
        hostname: API_HOST,
        path: apiPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': self.apiKey,
        },
        timeout: 180000, // 3 min — image gen can be slow
      }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          try {
            var result = JSON.parse(data);

            // Check for API errors
            if (result.error) {
              reject(new Error('Gemini API error: ' + (result.error.message || JSON.stringify(result.error))));
              return;
            }

            // Parse response — look for image parts
            if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
              reject(new Error('No content in Gemini response'));
              return;
            }

            var parts = result.candidates[0].content.parts || [];
            var imageData = null;
            var mimeType = 'image/png';
            var textResponse = '';

            for (var i = 0; i < parts.length; i++) {
              var part = parts[i];
              if (part.inlineData && part.inlineData.data) {
                imageData = part.inlineData.data; // base64
                mimeType = part.inlineData.mimeType || 'image/png';
              } else if (part.text) {
                textResponse += part.text;
              }
            }

            if (imageData) {
              // Determine file extension from mime type
              var ext = 'png';
              if (mimeType.indexOf('jpeg') !== -1 || mimeType.indexOf('jpg') !== -1) ext = 'jpg';
              else if (mimeType.indexOf('webp') !== -1) ext = 'webp';

              resolve({
                type: 'image',
                data: imageData,
                format: ext,
                model: self.model,
                prompt: prompt,
                revised_prompt: textResponse || null,
              });
            } else if (textResponse) {
              // Text-only response (no image generated)
              resolve({
                type: 'text',
                data: textResponse,
                model: self.model,
                prompt: prompt,
              });
            } else {
              reject(new Error('Empty response from Gemini — no image or text returned'));
            }
          } catch (e) {
            reject(new Error('Failed to parse Gemini response: ' + e.message));
          }
        });
      });

      req.on('error', function(e) {
        reject(new Error('Gemini connection failed: ' + e.message));
      });
      req.on('timeout', function() {
        req.destroy();
        reject(new Error('Gemini request timed out (180s)'));
      });
      req.write(bodyStr);
      req.end();
    });
  }

  async checkHealth() {
    if (!this.apiKey) return false;
    // Quick check: list models endpoint
    var self = this;
    return new Promise(function(resolve) {
      var req = https.request({
        hostname: API_HOST,
        path: '/v1beta/models?key=' + self.apiKey,
        method: 'GET',
        timeout: 10000,
      }, function(res) {
        var data = '';
        res.on('data', function(chunk) { data += chunk; });
        res.on('end', function() {
          resolve(res.statusCode === 200);
        });
      });
      req.on('error', function() { resolve(false); });
      req.on('timeout', function() { req.destroy(); resolve(false); });
      req.end();
    });
  }

  async listModels() {
    return [
      { name: 'gemini-3-pro-image-preview', size: 'cloud', description: 'Pro quality, 4K, Nano Banana' },
      { name: 'gemini-3.1-flash-image-preview', size: 'cloud', description: 'Fast, supports 2K + imageSize' },
      { name: 'gemini-2.5-flash-image', size: 'cloud', description: 'Legacy fast image generation' },
    ];
  }
}

module.exports = { GeminiProvider };
