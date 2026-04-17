// ComfyUI provider — queue workflows via REST API, poll for results
// Supports text-to-image, image-to-video, and 3D generation
// Workflow templates have their prompt nodes auto-replaced with user input

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

var DEFAULT_PORT = 8188;

class ComfyUIProvider {
  constructor(options) {
    options = options || {};
    this.endpoint = options.endpoint || 'http://127.0.0.1:8188';
    this.model = options.model || 'default';
    this.name = 'comfyui';
    this.color = '#ff6b35'; // orange
    this.comfyPath = options.comfyPath || 'G:/ComfyUI';
    this.workflowsDir = path.join(this.comfyPath, 'user/default/workflows');
    this._workflows = null;
  }

  // List available workflow files
  listWorkflows() {
    try {
      var files = fs.readdirSync(this.workflowsDir).filter(function(f) { return f.endsWith('.json'); });
      return files.map(function(f) {
        return { name: f.replace('.json', ''), file: f };
      });
    } catch (e) {
      return [];
    }
  }

  // Load a workflow JSON by name
  _loadWorkflow(name) {
    // Try exact match first
    var filePath = path.join(this.workflowsDir, name + '.json');
    if (!fs.existsSync(filePath)) {
      // Try fuzzy match
      var files = this.listWorkflows();
      var match = files.find(function(f) {
        return f.name.toLowerCase().indexOf(name.toLowerCase()) !== -1;
      });
      if (match) filePath = path.join(this.workflowsDir, match.file);
    }
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // Convert UI-format workflow to API-format (what /prompt expects)
  _toApiFormat(workflow) {
    if (!workflow.nodes) return workflow; // already API format

    var api = {};
    var nodes = workflow.nodes;
    var links = workflow.links || [];

    // Build link map: linkId → { fromNode, fromSlot, toNode, toSlot }
    var linkMap = {};
    for (var li = 0; li < links.length; li++) {
      var link = links[li];
      // link format: [linkId, fromNodeId, fromSlotIdx, toNodeId, toSlotIdx, type]
      linkMap[link[0]] = { from: link[1], fromSlot: link[2], to: link[3], toSlot: link[4] };
    }

    for (var ni = 0; ni < nodes.length; ni++) {
      var node = nodes[ni];
      if (!node.type || node.type === 'Note' || node.type === 'MarkdownNote') continue;

      var inputs = {};

      // Get input connections from node.inputs
      if (node.inputs) {
        for (var ii = 0; ii < node.inputs.length; ii++) {
          var inp = node.inputs[ii];
          if (inp.link != null && linkMap[inp.link]) {
            var lk = linkMap[inp.link];
            inputs[inp.name] = [String(lk.from), lk.fromSlot];
          }
        }
      }

      // Get widget values — these are the non-connected inputs
      if (node.widgets_values && node.widgets_values.length > 0) {
        var widgetNames = this._getWidgetNames(node.type);
        for (var wi = 0; wi < node.widgets_values.length && wi < widgetNames.length; wi++) {
          var wName = widgetNames[wi];
          if (!inputs[wName]) {
            inputs[wName] = node.widgets_values[wi];
          }
        }
      }

      api[String(node.id)] = {
        class_type: node.type,
        inputs: inputs,
      };
    }

    return api;
  }

  // Map common node types to their widget parameter names
  _getWidgetNames(classType) {
    var maps = {
      'CLIPTextEncode': ['text'],
      'KSampler': ['seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
      'KSamplerAdvanced': ['add_noise', 'noise_seed', 'control_after_generate', 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],
      'EmptySD3LatentImage': ['width', 'height', 'batch_size'],
      'EmptyLatentImage': ['width', 'height', 'batch_size'],
      'UnetLoaderGGUF': ['unet_name'],
      'UNETLoader': ['unet_name', 'weight_dtype'],
      'DualCLIPLoader': ['clip_name1', 'clip_name2', 'type'],
      'CLIPLoader': ['clip_name', 'type'],
      'VAELoader': ['vae_name'],
      'VAEDecode': [],
      'SaveImage': ['filename_prefix'],
      'SaveVideo': ['output_path', 'filename_prefix'],
      'LoadImage': ['image', 'upload'],
      'ModelSamplingSD3': ['shift'],
      'WanImageToVideo': ['width', 'height', 'length', 'batch_size'],
      'CreateVideo': ['frame_rate'],
      'UpscaleModelLoader': ['model_name'],
      'ImageUpscaleWithModel': [],
      'LoraLoaderModelOnly': ['lora_name', 'strength_model'],
    };
    return maps[classType] || [];
  }

  // Inject prompt text into the workflow (replace CLIPTextEncode positive prompt)
  _injectPrompt(apiWorkflow, prompt, negativePrompt) {
    var positiveFound = false;
    for (var nodeId in apiWorkflow) {
      var node = apiWorkflow[nodeId];
      if (node.class_type === 'CLIPTextEncode' && node.inputs) {
        if (!positiveFound && node.inputs.text) {
          // First CLIPTextEncode = positive prompt (unless it looks negative)
          var existing = (node.inputs.text || '').toLowerCase();
          if (existing.indexOf('blur') !== -1 || existing.indexOf('bad') !== -1 || existing.indexOf('ugly') !== -1 || existing.indexOf('overexposed') !== -1) {
            // This is the negative prompt node — set negative if provided
            if (negativePrompt) node.inputs.text = negativePrompt;
            continue;
          }
          node.inputs.text = prompt;
          positiveFound = true;
        } else if (positiveFound && negativePrompt) {
          // Second CLIPTextEncode after positive = negative
          node.inputs.text = negativePrompt;
        }
      }
    }
    return apiWorkflow;
  }

  async generate(prompt, options) {
    options = options || {};
    var workflowName = options.workflow || this.model || 'flux_text_to_image';

    // Load workflow
    var workflow = this._loadWorkflow(workflowName);
    if (!workflow) {
      throw new Error('Workflow not found: ' + workflowName + '. Available: ' + this.listWorkflows().map(function(w) { return w.name; }).join(', '));
    }

    // Convert to API format and inject prompt
    var apiWorkflow = this._toApiFormat(workflow);
    this._injectPrompt(apiWorkflow, prompt, options.negativePrompt || '');

    // Randomize seed
    for (var nid in apiWorkflow) {
      var n = apiWorkflow[nid];
      if (n.inputs && (n.inputs.seed !== undefined || n.inputs.noise_seed !== undefined)) {
        var seedKey = n.inputs.seed !== undefined ? 'seed' : 'noise_seed';
        n.inputs[seedKey] = Math.floor(Math.random() * 2147483647);
      }
    }

    // Queue the prompt
    var promptId = await this._queuePrompt(apiWorkflow);
    if (!promptId) throw new Error('Failed to queue ComfyUI prompt');

    // Poll for completion
    var result = await this._waitForResult(promptId);
    if (!result) throw new Error('ComfyUI generation timed out');

    // Download the output
    if (result.images && result.images.length > 0) {
      var img = result.images[0];
      var imageData = await this._downloadOutput(img.filename, img.subfolder, img.type);
      return {
        type: 'image',
        data: imageData.toString('base64'),
        format: img.filename.endsWith('.png') ? 'png' : 'jpg',
        model: workflowName,
        prompt: prompt,
      };
    }

    if (result.videos && result.videos.length > 0) {
      var vid = result.videos[0];
      var videoData = await this._downloadOutput(vid.filename, vid.subfolder, vid.type);
      return {
        type: 'image', // treat as image for now (thumbnail)
        data: videoData.toString('base64'),
        format: 'mp4',
        model: workflowName,
        prompt: prompt,
      };
    }

    if (result.gltf && result.gltf.length > 0) {
      return {
        type: 'text',
        data: '3D model generated: ' + result.gltf[0].filename,
        model: workflowName,
        prompt: prompt,
      };
    }

    throw new Error('No output from ComfyUI');
  }

  _queuePrompt(apiWorkflow) {
    var url = new URL(this.endpoint);
    var transport = url.protocol === 'https:' ? https : http;
    var body = JSON.stringify({ prompt: apiWorkflow });
    var self = this;

    return new Promise(function(resolve, reject) {
      var req = transport.request({
        hostname: url.hostname,
        port: url.port || DEFAULT_PORT,
        path: '/prompt',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try {
            var r = JSON.parse(data);
            if (r.error) { reject(new Error('ComfyUI error: ' + (r.error.message || JSON.stringify(r.error)))); return; }
            resolve(r.prompt_id || null);
          } catch (e) { reject(new Error('Invalid ComfyUI response')); }
        });
      });
      req.on('error', function(e) { reject(new Error('ComfyUI connection failed: ' + e.message + '. Is ComfyUI running?')); });
      req.on('timeout', function() { req.destroy(); reject(new Error('ComfyUI queue timeout')); });
      req.write(body);
      req.end();
    });
  }

  _waitForResult(promptId) {
    var self = this;
    var maxWait = 300000; // 5 minutes max
    var pollInterval = 2000;
    var elapsed = 0;

    return new Promise(function(resolve, reject) {
      var timer = setInterval(function() {
        elapsed += pollInterval;
        if (elapsed > maxWait) {
          clearInterval(timer);
          reject(new Error('ComfyUI generation timed out (5 min)'));
          return;
        }

        self._checkHistory(promptId).then(function(result) {
          if (result) {
            clearInterval(timer);
            resolve(result);
          }
        }).catch(function() {
          // ignore polling errors, keep trying
        });
      }, pollInterval);
    });
  }

  _checkHistory(promptId) {
    var url = new URL(this.endpoint);
    var transport = url.protocol === 'https:' ? https : http;

    return new Promise(function(resolve, reject) {
      var req = transport.request({
        hostname: url.hostname,
        port: url.port || DEFAULT_PORT,
        path: '/history/' + promptId,
        method: 'GET',
        timeout: 10000,
      }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() {
          try {
            var history = JSON.parse(data);
            var entry = history[promptId];
            if (!entry || !entry.outputs) { resolve(null); return; }

            // Collect outputs
            var images = [];
            var videos = [];
            var gltf = [];

            for (var nodeId in entry.outputs) {
              var out = entry.outputs[nodeId];
              if (out.images) images = images.concat(out.images);
              if (out.videos) videos = videos.concat(out.videos);
              if (out.gltf) gltf = gltf.concat(out.gltf);
            }

            if (images.length > 0 || videos.length > 0 || gltf.length > 0) {
              resolve({ images: images, videos: videos, gltf: gltf });
            } else {
              resolve(null); // not done yet
            }
          } catch (e) { resolve(null); }
        });
      });
      req.on('error', function() { resolve(null); });
      req.on('timeout', function() { req.destroy(); resolve(null); });
      req.end();
    });
  }

  _downloadOutput(filename, subfolder, type) {
    var url = new URL(this.endpoint);
    var transport = url.protocol === 'https:' ? https : http;
    var queryPath = '/view?filename=' + encodeURIComponent(filename);
    if (subfolder) queryPath += '&subfolder=' + encodeURIComponent(subfolder);
    if (type) queryPath += '&type=' + encodeURIComponent(type);

    return new Promise(function(resolve, reject) {
      var req = transport.request({
        hostname: url.hostname,
        port: url.port || DEFAULT_PORT,
        path: queryPath,
        method: 'GET',
        timeout: 60000,
      }, function(res) {
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() { resolve(Buffer.concat(chunks)); });
      });
      req.on('error', function(e) { reject(new Error('Failed to download ComfyUI output: ' + e.message)); });
      req.on('timeout', function() { req.destroy(); reject(new Error('Download timeout')); });
      req.end();
    });
  }

  async checkHealth() {
    var url = new URL(this.endpoint);
    var transport = url.protocol === 'https:' ? https : http;
    return new Promise(function(resolve) {
      var req = transport.request({
        hostname: url.hostname,
        port: url.port || DEFAULT_PORT,
        path: '/system_stats',
        method: 'GET',
        timeout: 5000,
      }, function(res) {
        var data = '';
        res.on('data', function(c) { data += c; });
        res.on('end', function() { resolve(res.statusCode === 200); });
      });
      req.on('error', function() { resolve(false); });
      req.on('timeout', function() { req.destroy(); resolve(false); });
      req.end();
    });
  }

  async listModels() {
    return this.listWorkflows().map(function(w) {
      return { name: w.name, size: 'local', description: 'ComfyUI workflow' };
    });
  }
}

module.exports = { ComfyUIProvider };
