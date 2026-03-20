/**
 * Day/Night Cycle & Persistent Behavior Tests — Phase 4 AI City
 *
 * Tests lighting transitions, agent behavior state changes, and time system.
 * Pure logic tests (no WebGL required).
 *
 * Usage: node test/test-daynight.js
 */

'use strict';

var passed = 0;
var failed = 0;
var failedTests = [];

function log(msg) { console.log(msg); }
function pass(name) { passed++; log('  \x1b[32m✓\x1b[0m ' + name); }
function fail(name, reason) {
  failed++;
  var msg = name + (reason ? ' — ' + reason : '');
  failedTests.push(msg);
  log('  \x1b[31m✗\x1b[0m ' + msg);
}

// ==========================================
// Game Time System
// ==========================================

log('\n\x1b[1mGame Time System\x1b[0m');

var GAME_SPEED = 60; // 1 real second = 60 game seconds (1 game day = 24 real minutes)
var DAY_LENGTH = 24 * 60 * 60; // 86400 game seconds in a day

function getGameTime(realElapsedMs, speed) {
  var gameSeconds = (realElapsedMs / 1000) * (speed || GAME_SPEED);
  return gameSeconds % DAY_LENGTH;
}

function getHour(gameSeconds) {
  return Math.floor(gameSeconds / 3600) % 24;
}

function getTimeOfDay(hour) {
  if (hour >= 6 && hour < 10) return 'dawn';
  if (hour >= 10 && hour < 17) return 'day';
  if (hour >= 17 && hour < 20) return 'dusk';
  return 'night'; // 20-6
}

// Test: Game time at 0
if (getGameTime(0) === 0) pass('game time starts at 0');
else fail('game time start');

// Test: 1 real second = 60 game seconds
if (getGameTime(1000) === 60) pass('1 real second = 60 game seconds');
else fail('1 second', 'got ' + getGameTime(1000));

// Test: 24 real minutes = 1 game day (wraps to 0)
var oneDayMs = 24 * 60 * 1000; // 24 real minutes
var gameTime = getGameTime(oneDayMs);
if (gameTime === 0) pass('24 real minutes = 1 game day (wraps to 0)');
else fail('day wrap', 'got ' + gameTime);

// Test: Hour calculation
if (getHour(0) === 0) pass('hour 0 at midnight');
else fail('midnight hour');

if (getHour(6 * 3600) === 6) pass('hour 6 at dawn');
else fail('dawn hour');

if (getHour(12 * 3600) === 12) pass('hour 12 at noon');
else fail('noon hour');

if (getHour(23 * 3600) === 23) pass('hour 23 at late night');
else fail('late night hour');

// Test: Time of day periods
if (getTimeOfDay(3) === 'night') pass('3:00 = night');
else fail('3am period');

if (getTimeOfDay(7) === 'dawn') pass('7:00 = dawn');
else fail('7am period');

if (getTimeOfDay(12) === 'day') pass('12:00 = day');
else fail('noon period');

if (getTimeOfDay(18) === 'dusk') pass('18:00 = dusk');
else fail('6pm period');

if (getTimeOfDay(22) === 'night') pass('22:00 = night');
else fail('10pm period');

// ==========================================
// Sky Color Transitions
// ==========================================

log('\n\x1b[1mSky Color Transitions\x1b[0m');

var SKY_COLORS = {
  night: { r: 0.05, g: 0.05, b: 0.15 },
  dawn:  { r: 0.8,  g: 0.5,  b: 0.3  },
  day:   { r: 0.5,  g: 0.7,  b: 1.0  },
  dusk:  { r: 0.8,  g: 0.4,  b: 0.2  }
};

function lerpColor(a, b, t) {
  t = Math.max(0, Math.min(1, t));
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
}

function getSkyColor(hour) {
  if (hour >= 6 && hour < 10) return lerpColor(SKY_COLORS.night, SKY_COLORS.day, (hour - 6) / 4);
  if (hour >= 10 && hour < 17) return SKY_COLORS.day;
  if (hour >= 17 && hour < 20) return lerpColor(SKY_COLORS.day, SKY_COLORS.night, (hour - 17) / 3);
  return SKY_COLORS.night;
}

// Test: Night sky is dark
var nightSky = getSkyColor(2);
if (nightSky.r < 0.1 && nightSky.b < 0.2) pass('night sky is dark (r<0.1, b<0.2)');
else fail('night sky', 'r=' + nightSky.r + ' b=' + nightSky.b);

// Test: Day sky is blue
var daySky = getSkyColor(12);
if (daySky.b > 0.8 && daySky.r < 0.6) pass('day sky is blue (b>0.8, r<0.6)');
else fail('day sky', 'r=' + daySky.r + ' b=' + daySky.b);

// Test: Dawn is transitioning (not fully dark, not fully bright)
var dawnSky = getSkyColor(8);
if (dawnSky.r > 0.1 && dawnSky.r < 0.9 && dawnSky.b > 0.1) pass('dawn sky is transitional');
else fail('dawn sky', 'r=' + dawnSky.r + ' b=' + dawnSky.b);

// Test: Lerp at t=0 returns start color
var lerp0 = lerpColor({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 0);
if (lerp0.r === 0 && lerp0.g === 0 && lerp0.b === 0) pass('lerp t=0 returns start color');
else fail('lerp t=0');

// Test: Lerp at t=1 returns end color
var lerp1 = lerpColor({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 1);
if (lerp1.r === 1 && lerp1.g === 1 && lerp1.b === 1) pass('lerp t=1 returns end color');
else fail('lerp t=1');

// Test: Lerp clamped (t>1 doesn't overshoot)
var lerpOver = lerpColor({ r: 0, g: 0, b: 0 }, { r: 1, g: 1, b: 1 }, 2);
if (lerpOver.r === 1) pass('lerp t=2 clamped to 1');
else fail('lerp clamp', 'r=' + lerpOver.r);

// ==========================================
// Sun Position
// ==========================================

log('\n\x1b[1mSun Position\x1b[0m');

function getSunAngle(hour) {
  // Sun rises at 6:00, sets at 18:00
  // Angle: 0 = horizon (rise), PI/2 = zenith (noon), PI = horizon (set)
  if (hour < 6 || hour >= 18) return -1; // below horizon
  return ((hour - 6) / 12) * Math.PI;
}

function getSunY(hour) {
  var angle = getSunAngle(hour);
  if (angle < 0) return -1; // below horizon
  return Math.sin(angle);
}

// Test: Sun below horizon at night
if (getSunAngle(3) === -1) pass('sun below horizon at 3:00');
else fail('night sun');

// Test: Sun at horizon at 6:00
var sunRise = getSunAngle(6);
if (Math.abs(sunRise) < 0.01) pass('sun at horizon at 6:00 (angle ≈ 0)');
else fail('sunrise angle', 'got ' + sunRise);

// Test: Sun at zenith at noon
var sunNoon = getSunAngle(12);
if (Math.abs(sunNoon - Math.PI / 2) < 0.01) pass('sun at zenith at 12:00 (angle ≈ PI/2)');
else fail('noon angle', 'got ' + sunNoon);

// Test: Sun Y at noon is maximum
var yNoon = getSunY(12);
if (Math.abs(yNoon - 1) < 0.01) pass('sun Y at noon ≈ 1 (maximum)');
else fail('noon Y', 'got ' + yNoon);

// Test: Sun below horizon at 20:00
if (getSunAngle(20) === -1) pass('sun below horizon at 20:00');
else fail('evening sun');

// ==========================================
// Street Light Logic
// ==========================================

log('\n\x1b[1mStreet Lights\x1b[0m');

function shouldLightsBeOn(hour) {
  return hour < 6 || hour >= 18;
}

if (shouldLightsBeOn(3)) pass('lights on at 3:00 (night)');
else fail('night lights');

if (!shouldLightsBeOn(12)) pass('lights off at 12:00 (day)');
else fail('day lights');

if (shouldLightsBeOn(18)) pass('lights on at 18:00 (sunset)');
else fail('sunset lights');

if (!shouldLightsBeOn(6)) pass('lights off at 6:00 (sunrise)');
else fail('sunrise lights');

// ==========================================
// Agent Behavior State Transitions
// ==========================================

log('\n\x1b[1mAgent Behavior Transitions\x1b[0m');

var IDLE_TO_CAFE_MS = 5 * 60 * 1000;      // 5 minutes
var IDLE_TO_RESIDENTIAL_MS = 15 * 60 * 1000; // 15 minutes

function getAgentBehavior(agentState, idleMs, hour) {
  if (!agentState.alive) return 'dead';
  if (agentState.hasActiveTasks) return 'working';
  if (agentState.listening) return 'listening';

  // Idle behaviors based on idle duration
  if (idleMs >= IDLE_TO_RESIDENTIAL_MS) return 'sleeping';
  if (idleMs >= IDLE_TO_CAFE_MS) return 'off_duty';

  return 'idle';
}

// Test: Active agent is working
var working = getAgentBehavior({ alive: true, hasActiveTasks: true, listening: false }, 0, 12);
if (working === 'working') pass('agent with tasks = working');
else fail('working state', 'got ' + working);

// Test: Listening agent
var listening = getAgentBehavior({ alive: true, hasActiveTasks: false, listening: true }, 0, 12);
if (listening === 'listening') pass('agent in listen mode = listening');
else fail('listening state', 'got ' + listening);

// Test: Idle <5min = idle
var idle = getAgentBehavior({ alive: true, hasActiveTasks: false, listening: false }, 2 * 60 * 1000, 12);
if (idle === 'idle') pass('idle 2min = idle');
else fail('idle state', 'got ' + idle);

// Test: Idle 5min → off_duty (cafe)
var cafe = getAgentBehavior({ alive: true, hasActiveTasks: false, listening: false }, 5 * 60 * 1000, 14);
if (cafe === 'off_duty') pass('idle 5min = off_duty (cafe)');
else fail('cafe state', 'got ' + cafe);

// Test: Idle 15min → sleeping (residential)
var sleeping = getAgentBehavior({ alive: true, hasActiveTasks: false, listening: false }, 15 * 60 * 1000, 22);
if (sleeping === 'sleeping') pass('idle 15min = sleeping (residential)');
else fail('sleeping state', 'got ' + sleeping);

// Test: Dead agent
var dead = getAgentBehavior({ alive: false, hasActiveTasks: false, listening: false }, 0, 12);
if (dead === 'dead') pass('dead agent = dead');
else fail('dead state', 'got ' + dead);

// Test: Working overrides idle time
var workingOverride = getAgentBehavior({ alive: true, hasActiveTasks: true, listening: false }, 20 * 60 * 1000, 12);
if (workingOverride === 'working') pass('working overrides idle time (20min idle but has tasks)');
else fail('working override', 'got ' + workingOverride);

// ==========================================
// Window Emissive Logic
// ==========================================

log('\n\x1b[1mWindow Emissive\x1b[0m');

function getWindowEmissive(hour, hasAgentInside) {
  var isNight = hour < 6 || hour >= 18;
  if (!isNight) return 0; // no glow during day
  if (!hasAgentInside) return 0.1; // dim glow for empty buildings at night
  return 0.8; // bright glow for occupied buildings at night
}

if (getWindowEmissive(12, true) === 0) pass('no window glow during day');
else fail('day glow');

if (getWindowEmissive(22, false) === 0.1) pass('dim glow for empty building at night');
else fail('empty night glow');

if (getWindowEmissive(22, true) === 0.8) pass('bright glow for occupied building at night');
else fail('occupied night glow');

if (getWindowEmissive(5, true) === 0.8) pass('bright glow at 5am (still night)');
else fail('early morning glow');

// ==========================================
// Results
// ==========================================

log('\n\x1b[1m━━━ Day/Night Test Results ━━━\x1b[0m');
log('  \x1b[32m' + passed + ' passed\x1b[0m');
if (failed > 0) {
  log('  \x1b[31m' + failed + ' failed:\x1b[0m');
  failedTests.forEach(function(t) { log('    \x1b[31m✗\x1b[0m ' + t); });
}

process.exit(failed > 0 ? 1 : 0);
