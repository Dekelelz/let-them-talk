import * as THREE from 'three';
import { S } from './state.js';

export function updateMonitorScreen(deskIdx, agentName, time) {
  var desk = S.deskMeshes[deskIdx];
  if (!desk || !desk.screen) return;
  var W = 256, H = 160;
  if (!S.monitorCanvases[deskIdx]) {
    var cvs = document.createElement('canvas');
    cvs.width = W; cvs.height = H;
    S.monitorCanvases[deskIdx] = { canvas: cvs, texture: new THREE.CanvasTexture(cvs) };
    S.monitorCanvases[deskIdx].texture.minFilter = THREE.LinearFilter;
    desk.screen.material = new THREE.MeshStandardMaterial({
      map: S.monitorCanvases[deskIdx].texture,
      emissive: 0x58a6ff, emissiveIntensity: 0.3, roughness: 0.2
    });
  }
  var mc = S.monitorCanvases[deskIdx];
  var ctx = mc.canvas.getContext('2d');

  // Terminal background
  ctx.fillStyle = '#0c1021';
  ctx.fillRect(0, 0, W, H);

  // Title bar
  ctx.fillStyle = '#1a1f36';
  ctx.fillRect(0, 0, W, 14);
  ctx.fillStyle = '#ff5f57'; ctx.beginPath(); ctx.arc(8, 7, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffbd2e'; ctx.beginPath(); ctx.arc(18, 7, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#28c840'; ctx.beginPath(); ctx.arc(28, 7, 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#8892b0';
  ctx.font = '9px monospace';
  ctx.fillText(agentName + ' \u2014 terminal', 40, 11);

  // Gather real data
  var history = window.cachedHistory || [];
  var agentInfo = (window.cachedAgents || {})[agentName] || {};
  var lines = [];

  // Prominent warning when agent is NOT listening
  if (agentInfo.status === 'active' && !agentInfo.is_listening) {
    ctx.fillStyle = '#1a0808';
    ctx.fillRect(0, 14, W, 14);
    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 10px monospace';
    ctx.fillText('\u26A0 NOT LISTENING', 6, 25);
  }

  var statusColor = agentInfo.is_listening ? '#28c840' : agentInfo.status === 'active' ? '#ef4444' : '#ffbd2e';
  lines.push({ color: '#546178', text: '$ agent status' });
  lines.push({ color: statusColor, text: '  ' + (agentInfo.status || 'unknown').toUpperCase() + (agentInfo.is_listening ? ' (listening)' : ' (working)') });
  lines.push({ color: '#546178', text: '' });

  var sent = 0, recv = 0;
  for (var i = 0; i < history.length; i++) {
    if (history[i].from === agentName) sent++;
    if (history[i].to === agentName) recv++;
  }
  lines.push({ color: '#546178', text: '$ stats' });
  lines.push({ color: '#79c0ff', text: '  sent: ' + sent + '  recv: ' + recv + '  total: ' + history.length });
  lines.push({ color: '#546178', text: '' });

  lines.push({ color: '#546178', text: '$ tail -f messages.jsonl' });
  var agentMsgs = [];
  for (var j = history.length - 1; j >= 0 && agentMsgs.length < 4; j--) {
    var m = history[j];
    if (m.from === agentName || m.to === agentName) agentMsgs.unshift(m);
  }
  for (var k = 0; k < agentMsgs.length; k++) {
    var msg = agentMsgs[k];
    var isSent = msg.from === agentName;
    var prefix = isSent ? '  > ' : '  < ';
    var peer = isSent ? (msg.to || 'all') : msg.from;
    var snippet = (msg.content || msg.message || '').substring(0, 28);
    if ((msg.content || msg.message || '').length > 28) snippet += '..';
    lines.push({ color: isSent ? '#7ee787' : '#d2a8ff', text: prefix + peer + ': ' + snippet });
  }
  if (agentMsgs.length === 0) {
    lines.push({ color: '#3d4663', text: '  (no messages yet)' });
  }

  var showCursor = Math.floor(time * 2) % 2 === 0;

  ctx.font = '9px monospace';
  var lineY = 24;
  var maxLines = Math.floor((H - 24) / 11);
  var startLine = Math.max(0, lines.length - maxLines);
  for (var r = startLine; r < lines.length; r++) {
    ctx.fillStyle = lines[r].color;
    ctx.fillText(lines[r].text, 4, lineY);
    lineY += 11;
  }
  if (showCursor) {
    ctx.fillStyle = '#58a6ff';
    ctx.fillText('$ _', 4, lineY);
  } else {
    ctx.fillStyle = '#58a6ff';
    ctx.fillText('$', 4, lineY);
  }

  // Scanline effect
  ctx.fillStyle = 'rgba(0,0,0,0.03)';
  for (var sl = 0; sl < H; sl += 2) {
    ctx.fillRect(0, sl, W, 1);
  }

  mc.texture.needsUpdate = true;
}

export function setMonitorDim(deskIdx) {
  var desk = S.deskMeshes[deskIdx];
  if (!desk || !desk.screen) return;
  if (S.monitorCanvases[deskIdx]) {
    S.monitorCanvases[deskIdx].texture.dispose();
    if (desk.screen.material !== desk.screenMat) desk.screen.material.dispose();
    delete S.monitorCanvases[deskIdx];
  }
  desk.screen.material = desk.screenMat;
  desk.screenMat.emissive.setHex(0x1a2744);
  desk.screenMat.emissiveIntensity = 0.15;
  desk.screenMat.color.setHex(0x1a2744);
}
