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
    // Eyebrows
    ctx.strokeStyle = '#4a4a5e';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(cx - eyeSpacing - 8, eyeY - 16); ctx.quadraticCurveTo(cx - eyeSpacing, eyeY - 20, cx - eyeSpacing + 8, eyeY - 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + eyeSpacing - 8, eyeY - 16); ctx.quadraticCurveTo(cx + eyeSpacing, eyeY - 20, cx + eyeSpacing + 8, eyeY - 16); ctx.stroke();

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
