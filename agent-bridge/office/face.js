import * as THREE from 'three';

export function buildFaceSprite(eyeStyle, mouthStyle, sleeping) {
  var size = 256;
  var canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  var ctx = canvas.getContext('2d');
  var cx = size / 2, cy = size / 2;
  ctx.clearRect(0, 0, size, size);

  var eyeY = cy - 12;
  var eyeSpacing = 28;

  if (sleeping) {
    ctx.strokeStyle = '#2a2a3e';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 10, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 10, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    ctx.strokeStyle = '#c0846b';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy + 28, 4, 0, Math.PI * 2); ctx.stroke();
  } else {
    // Eyebrows (styles that draw their own: surprised, angry, happy, confident)
    var customBrows = { surprised: 1, angry: 1, happy: 1, confident: 1 };
    if (!customBrows[eyeStyle]) {
      ctx.strokeStyle = '#4a4a5e';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 8, eyeY - 16); ctx.quadraticCurveTo(cx - eyeSpacing, eyeY - 20, cx - eyeSpacing + 8, eyeY - 16); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + eyeSpacing - 8, eyeY - 16); ctx.quadraticCurveTo(cx + eyeSpacing, eyeY - 20, cx + eyeSpacing + 8, eyeY - 16); ctx.stroke();
    }

    // Eyes
    switch (eyeStyle) {
      case 'dots':
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 9, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 1, 6, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 1, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 2, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 2, eyeY - 2, 2.5, 0, Math.PI * 2); ctx.fill();
        break;
      case 'anime':
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY, 11, 13, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#3b82f6';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 1, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 1, 8, 10, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 2, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 2, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 3, eyeY - 4, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 3, eyeY - 4, 3.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx - eyeSpacing - 2, eyeY + 4, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing - 2, eyeY + 4, 2, 0, Math.PI * 2); ctx.fill();
        break;
      case 'glasses':
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 8, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 1, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 1, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 2, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 2, eyeY - 2, 2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 14, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing + 14, eyeY); ctx.lineTo(cx + eyeSpacing - 14, eyeY); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 14, eyeY); ctx.lineTo(cx - eyeSpacing - 20, eyeY - 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + eyeSpacing + 14, eyeY); ctx.lineTo(cx + eyeSpacing + 20, eyeY - 2); ctx.stroke();
        break;
      case 'sleepy':
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 2, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 2, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 3, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 3, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.strokeStyle = '#4a4a5e';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 10, eyeY - 2); ctx.lineTo(cx - eyeSpacing + 10, eyeY); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + eyeSpacing - 10, eyeY); ctx.lineTo(cx + eyeSpacing + 10, eyeY - 2); ctx.stroke();
        break;
      case 'surprised':
        // Wide open round eyes with tiny pupils
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 12, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 3, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 2, eyeY - 3, 2, 0, Math.PI * 2); ctx.fill();
        // Raised eyebrows (override default)
        ctx.strokeStyle = '#4a4a5e'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 10, eyeY - 22); ctx.quadraticCurveTo(cx - eyeSpacing, eyeY - 28, cx - eyeSpacing + 10, eyeY - 22); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + eyeSpacing - 10, eyeY - 22); ctx.quadraticCurveTo(cx + eyeSpacing, eyeY - 28, cx + eyeSpacing + 10, eyeY - 22); ctx.stroke();
        break;
      case 'angry':
        // Angry slanted eyes with V-shaped eyebrows
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY, 10, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 1, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 1, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 2, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 2, eyeY - 2, 2, 0, Math.PI * 2); ctx.fill();
        // Angry V eyebrows
        ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 10, eyeY - 12); ctx.lineTo(cx - eyeSpacing + 6, eyeY - 20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + eyeSpacing + 10, eyeY - 12); ctx.lineTo(cx + eyeSpacing - 6, eyeY - 20); ctx.stroke();
        break;
      case 'happy':
        // Closed happy eyes (upside down U shapes) with sparkle
        ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 3, 8, Math.PI, 2 * Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 3, 8, Math.PI, 2 * Math.PI); ctx.stroke();
        // Sparkle marks
        ctx.strokeStyle = '#ffcc00'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing + 14, eyeY - 8); ctx.lineTo(cx - eyeSpacing + 18, eyeY - 12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing + 16, eyeY - 6); ctx.lineTo(cx - eyeSpacing + 16, eyeY - 14); ctx.stroke();
        break;
      case 'wink':
        // Left eye normal, right eye winking (horizontal line)
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 1, 6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 2, 2.5, 0, Math.PI * 2); ctx.fill();
        // Right eye: wink arc
        ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 2, 8, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
        break;
      case 'confident':
        // Slightly narrowed determined eyes
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 1, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 1, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 2, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 2, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(cx - eyeSpacing + 2, eyeY - 1, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing + 2, eyeY - 1, 2.5, 0, Math.PI * 2); ctx.fill();
        // Flat confident eyebrows
        ctx.strokeStyle = '#3a3a4e'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 9, eyeY - 16); ctx.lineTo(cx - eyeSpacing + 9, eyeY - 17); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx + eyeSpacing - 9, eyeY - 17); ctx.lineTo(cx + eyeSpacing + 9, eyeY - 16); ctx.stroke();
        break;
      case 'tired':
        // Droopy half-lidded eyes with bags
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 3, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 3, 9, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1a1a2e';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY + 4, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY + 4, 5, 3, 0, 0, Math.PI * 2); ctx.fill();
        // Heavy eyelids
        ctx.fillStyle = 'rgba(200, 170, 150, 0.5)';
        ctx.beginPath(); ctx.ellipse(cx - eyeSpacing, eyeY - 1, 10, 6, 0, Math.PI, 2 * Math.PI); ctx.fill();
        ctx.beginPath(); ctx.ellipse(cx + eyeSpacing, eyeY - 1, 10, 6, 0, Math.PI, 2 * Math.PI); ctx.fill();
        // Under-eye bags
        ctx.strokeStyle = 'rgba(150, 120, 120, 0.3)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx - eyeSpacing, eyeY + 12, 8, 0, Math.PI); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx + eyeSpacing, eyeY + 12, 8, 0, Math.PI); ctx.stroke();
        break;
    }

    // Nose
    ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 10, 4, 3, 0, 0, Math.PI * 2); ctx.fill();

    // Blush
    ctx.fillStyle = 'rgba(255, 130, 130, 0.15)';
    ctx.beginPath(); ctx.ellipse(cx - eyeSpacing - 4, eyeY + 16, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + eyeSpacing + 4, eyeY + 16, 10, 6, 0, 0, Math.PI * 2); ctx.fill();

    // Mouth
    switch (mouthStyle) {
      case 'smile':
        ctx.strokeStyle = '#c0846b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy + 24, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        break;
      case 'neutral':
        ctx.strokeStyle = '#c0846b';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 6, cy + 28); ctx.lineTo(cx + 6, cy + 28); ctx.stroke();
        break;
      case 'open':
        ctx.fillStyle = '#8b4c3a';
        ctx.beginPath(); ctx.ellipse(cx, cy + 26, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d4736a';
        ctx.beginPath(); ctx.ellipse(cx, cy + 29, 4, 3, 0, 0, Math.PI); ctx.fill();
        break;
      case 'grin':
        // Wide grin showing teeth
        ctx.fillStyle = '#8b4c3a';
        ctx.beginPath(); ctx.ellipse(cx, cy + 26, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.ellipse(cx, cy + 25, 8, 4, 0, 0, Math.PI); ctx.fill();
        ctx.strokeStyle = '#c0846b'; ctx.lineWidth = 1.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy + 24, 10, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
        break;
      case 'frown':
        // Downturned mouth
        ctx.strokeStyle = '#c0846b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy + 34, 8, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
        break;
      case 'smirk':
        // One-sided smirk
        ctx.strokeStyle = '#c0846b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - 6, cy + 28); ctx.quadraticCurveTo(cx + 2, cy + 28, cx + 8, cy + 24); ctx.stroke();
        break;
      case 'tongue':
        // Playful tongue sticking out
        ctx.strokeStyle = '#c0846b'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(cx, cy + 24, 8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
        ctx.fillStyle = '#e8837c';
        ctx.beginPath(); ctx.ellipse(cx, cy + 33, 4, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#d4736a';
        ctx.beginPath(); ctx.ellipse(cx, cy + 34, 3, 3, 0, 0, Math.PI); ctx.fill();
        break;
      case 'whistle':
        // Small O-shaped mouth
        ctx.fillStyle = '#8b4c3a';
        ctx.beginPath(); ctx.arc(cx, cy + 28, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6b3c2a';
        ctx.beginPath(); ctx.arc(cx, cy + 28, 2.5, 0, Math.PI * 2); ctx.fill();
        break;
    }
  }

  var tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  var faceMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  var faceMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.38), faceMat);
  faceMesh.userData.canvas = canvas;
  faceMesh.userData.texture = tex;
  return faceMesh;
}
