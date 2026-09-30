import { clamp, deadZone, framePosition, frameBlend, neutralSince, tiltGesture, chooseAxis, relativeTilt, containRect } from './motion.js?v=3';

const $ = id => document.getElementById(id);
const canvas = $('catCanvas'), ctx = canvas.getContext('2d', { alpha: false });
const extensionCtx = $('screenExtension').getContext('2d', { alpha: false });
let extensionRect;
function drawExtension() {
  if (!extensionRect) return;
  const { x, y, width, height } = extensionRect;
  const w = extensionCtx.canvas.width, h = extensionCtx.canvas.height;
  extensionCtx.drawImage(canvas, x, y, width, height);
  if (x > 0) {
    extensionCtx.drawImage(canvas, 0, 0, 1, 1280, 0, y, x + 1, height);
    extensionCtx.drawImage(canvas, 719, 0, 1, 1280, x + width - 1, y, w - x - width + 1, height);
  }
  if (y > 0) {
    extensionCtx.drawImage(canvas, 0, 0, 720, 1, x, 0, width, y + 1);
    extensionCtx.drawImage(canvas, 0, 1279, 720, 1, x, y + height - 1, width, h - y - height + 1);
  }
}
function resizeExtension() {
  const stage = document.querySelector('.companion');
  const w = Math.min(720, stage.clientWidth), h = Math.round(w * stage.clientHeight / stage.clientWidth);
  extensionCtx.canvas.width = w; extensionCtx.canvas.height = h;
  extensionRect = containRect(w, h);
  drawExtension();
}
new ResizeObserver(resizeExtension).observe(document.querySelector('.companion'));
const surface = $('touchSurface'), dialog = $('settings');
const bridge = document.createElement('canvas');
bridge.width = canvas.width; bridge.height = canvas.height;
const bridgeCtx = bridge.getContext('2d');
const poster = document.querySelector('.poster');
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
const atlasConfig = {
  yaw: { count: 48, columns: 8, center: 24 },
  pitch: { count: 36, columns: 6, center: 30 },
};
const videos = {}, atlasImages = {}, atlasPromises = {};
const state = {
  mode: 'poster', paused: false, reduced: reducedQuery.matches, ready: false,
  x: 0, y: 0, targetX: 0, targetY: 0, axis: 'yaw',
  source: 'touch', dragging: false, motion: false,
  lastInteraction: performance.now(), operation: 0, frame: -1,
};
let fadeStart = -1000, fadeDuration = 180, previousTime = performance.now();
let lastDraw = '', lastVideoTime = -1, lastInput = 0, sensorBaseline = null, sensorSample = null;
let sensorTimer, motionRequest = 0, sensorPending = false, pointer = null, keyTimer;
let neutralAt = null, candidateAxis = null, candidateSince = 0, pendingClip = null;
let gestureGate = { armed: true, since: null };
$('reduceMotion').checked = state.reduced;

function message(text) {
  $('hint').textContent = text;
  $('settingsStatus').textContent = text;
}
function mood(text) { if ($('mood').textContent !== text) $('mood').textContent = text; }
function noteInteraction() { state.lastInteraction = performance.now(); }
function sourceLabel() {
  $('inputLabel').textContent = state.motion ? '手机倾斜 · 已校准' : '触摸互动';
  document.querySelector('.companion').classList.toggle('sensing', state.motion && !!sensorBaseline);
}
function snapshot(duration = 180) {
  bridgeCtx.drawImage(canvas, 0, 0);
  fadeStart = performance.now(); fadeDuration = state.reduced ? 0 : duration;
  lastDraw = '';
}
function stopVideos() { Object.values(videos).forEach(video => video.pause()); }
function setMode(mode) {
  state.mode = mode; canvas.dataset.mode = mode;
  $('petButton').classList.toggle('active', mode === 'pet');
  $('sleepButton').classList.toggle('active', mode === 'sleep');
}
function waitMedia(video, event, predicate, timeout = 15000) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clean = () => { clearTimeout(timer); video.removeEventListener(event, okay); video.removeEventListener('error', fail); };
    const okay = () => { if (!predicate()) return; clean(); resolve(); };
    const fail = () => { clean(); reject(new Error('素材加载失败，请刷新后重试。')); };
    const timer = setTimeout(() => { clean(); reject(new Error('素材加载较慢，请检查网络后重试。')); }, timeout);
    video.addEventListener(event, okay); video.addEventListener('error', fail);
  });
}
function getVideo(name) {
  if (videos[name]) return videos[name];
  const video = document.createElement('video');
  video.muted = true; video.defaultMuted = true; video.playsInline = true;
  video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
  video.preload = name === 'idle' ? 'auto' : 'metadata';
  video.src = './assets/video/' + name + '.mp4';
  video.addEventListener('error', () => {
    if (state.mode === name) { message('视频加载失败。可刷新页面重试。'); $('startButton').hidden = false; }
  });
  $('mediaBank').append(video); videos[name] = video;
  return video;
}
async function playClip(name, { automatic = false } = {}) {
  if (!state.ready || state.paused || document.hidden) return;
  if (automatic && state.reduced) return showPoster();
  if (pendingClip?.name === name && pendingClip.operation === state.operation) return;
  const operation = ++state.operation;
  pendingClip = { name, operation };
  try {
    const video = getVideo(name);
    video.preload = 'auto';
    await waitMedia(video, 'loadeddata', () => video.readyState >= 2);
    if (operation !== state.operation || state.paused || document.hidden) return;
    video.pause();
    video.currentTime = 0;
    await waitMedia(video, 'seeked', () => !video.seeking && video.readyState >= 2);
    if (operation !== state.operation || state.paused || document.hidden) return;
    stopVideos(); snapshot(name === 'idle' ? 280 : 180); setMode(name);
    mood({ idle: '安静地陪着你', pet: '嗯，再摸一下', sleep: '眯一会儿…' }[name]);
    if (!automatic) noteInteraction();
    await video.play();
    if (operation !== state.operation) { if (state.mode !== name) video.pause(); return; }
    $('startButton').hidden = true;
  } catch (error) {
    if (operation !== state.operation) return;
    if (error.name === 'NotAllowedError') {
      $('startButton').hidden = false; mood('等你轻轻点一下');
    } else message(error.message);
  } finally { if (pendingClip?.operation === operation) pendingClip = null; }
}
function showPoster() {
  ++state.operation; stopVideos(); snapshot(); setMode('poster');
  mood(state.paused ? '陪伴暂停中' : '安静地看着你');
}
function returnIdle() {
  state.targetX = state.targetY = 0;
  if (state.reduced) showPoster(); else void playClip('idle', { automatic: true });
}
async function loadAtlas(axis) {
  if (atlasImages[axis]) return atlasImages[axis];
  if (!atlasPromises[axis]) {
    atlasPromises[axis] = (async () => {
      const image = new Image();
      image.src = './assets/video/' + axis + '-atlas.webp';
      await image.decode();
      atlasImages[axis] = image;
      return image;
    })().catch(error => { delete atlasPromises[axis]; throw error; });
  }
  return atlasPromises[axis];
}
async function steer(x, y, source = 'touch') {
  if (!state.ready || state.paused || document.hidden || dialog.open) return;
  if ((state.mode === 'pet' || state.mode === 'sleep') && source !== 'touch') return;
  x = deadZone(clamp(x)); y = deadZone(clamp(y));
  state.targetX = x; state.targetY = y; state.source = source;
  lastInput = performance.now();
  if (Math.max(Math.abs(x), Math.abs(y)) > .05) noteInteraction();
  const axis = chooseAxis(x, y, state.axis);
  if (Math.max(Math.abs(x), Math.abs(y)) < .025) return;
  if (state.mode === axis && state.axis === axis) {
    if (pendingClip) { ++state.operation; pendingClip = null; }
    candidateAxis = null; return;
  }
  // A deliberate change must persist; diagonal sensor noise must not swap clips.
  if (source === 'motion' && (state.mode === 'yaw' || state.mode === 'pitch')) {
    if (candidateAxis !== axis) { candidateAxis = axis; candidateSince = performance.now(); return; }
    if (performance.now() - candidateSince < 180) return;
  }
  const operation = ++state.operation;
  try {
    await loadAtlas(axis);
    if (operation !== state.operation || state.paused || document.hidden) return;
    stopVideos(); snapshot(220); state.axis = axis; candidateAxis = null; neutralAt = null; setMode(axis);
    mood(axis === 'yaw' ? '你往哪儿，我就看哪儿' : '抬头，低头，跟着你');
  } catch { if (operation === state.operation) message('转头素材未加载成功。请再拖动一次，或先摸摸它。'); }
}
function drawSource() {
  if (state.mode === 'yaw' || state.mode === 'pitch') {
    const a = atlasConfig[state.mode], image = atlasImages[state.mode];
    const value = state.mode === 'yaw' ? state.x : state.y;
    const position = framePosition(value, a.center, a.count);
    const { first, second, mix } = frameBlend(position, a.count);
    state.frame = position; canvas.dataset.frame = position.toFixed(3);
    // Exclude encoded padding and neighboring atlas tiles, preserving the 9:16 aspect.
    const inset = state.mode === 'pitch' ? 3 : .5, insetY = inset * 16 / 9;
    const drawFrame = frame => ctx.drawImage(image, frame % a.columns * 360 + inset, Math.floor(frame / a.columns) * 640 + insetY, 360 - 2 * inset, 640 - 2 * insetY, 0, 0, 720, 1280);
    drawFrame(first);
    if (mix > .001) {
      ctx.globalAlpha = mix;
      drawFrame(second);
      ctx.globalAlpha = 1;
    }
  } else if (videos[state.mode]?.readyState >= 2) {
    const inset = state.mode === 'sleep' ? 6 : 0, insetY = inset * 16 / 9;
    ctx.drawImage(videos[state.mode], inset, insetY, 720 - 2 * inset, 1280 - 2 * insetY, 0, 0, 720, 1280);
  } else if (poster.complete && poster.naturalWidth) ctx.drawImage(poster, 0, 0, 720, 1280);
}
function render(now) {
  requestAnimationFrame(render);
  const dt = Math.min((now - previousTime) / 1000, .06); previousTime = now;
  if (document.hidden) return;
  const smoothing = state.reduced ? 1 : 1 - Math.exp(-dt * 14);
  if (!state.paused) {
    state.x += (state.targetX - state.x) * smoothing;
    state.y += (state.targetY - state.y) * smoothing;
  }
  const pose = state.mode === 'yaw' || state.mode === 'pitch';
  const video = videos[state.mode];
  const frame = pose ? framePosition(state.mode === 'yaw' ? state.x : state.y, atlasConfig[state.mode].center, atlasConfig[state.mode].count).toFixed(3) : -1;
  const key = state.mode + ':' + frame;
  const fading = !state.paused && now - fadeStart < fadeDuration;
  if (lastDraw !== key || fading || (!state.paused && video && video.currentTime !== lastVideoTime)) {
    drawSource();
    if (fading) { ctx.globalAlpha = 1 - clamp((now - fadeStart) / fadeDuration, 0, 1); ctx.drawImage(bridge, 0, 0); ctx.globalAlpha = 1; }
    drawExtension();
    lastDraw = key; lastVideoTime = video?.currentTime ?? -1;
  }
  if (state.paused || !state.ready || dialog.open) return;
  neutralAt = neutralSince(state.targetX, state.targetY, neutralAt, now);
  if (pose && !state.dragging && neutralAt !== null && now - neutralAt > 700 && Math.abs(state.x) + Math.abs(state.y) < .04) returnIdle();
  else if (pose && !state.dragging && state.source !== 'motion' && now - lastInput > 1500) { state.targetX = state.targetY = 0; }
  if (video && !video.paused && (video.ended || (state.mode === 'idle' && video.currentTime > 3.85))) {
    video.pause(); returnIdle();
  } else if (video?.ended) returnIdle();
  if (state.mode === 'idle' && !state.reduced && $('autoSleep').checked && now - state.lastInteraction > 30000) {
    noteInteraction(); void playClip('sleep', { automatic: true });
  }
}

surface.addEventListener('pointerdown', event => {
  if (state.paused) return;
  noteInteraction(); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
  surface.setPointerCapture(event.pointerId);
});
surface.addEventListener('pointermove', event => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
  if (Math.hypot(dx, dy) > 7) pointer.moved = state.dragging = true;
  if (pointer.moved) void steer(dx / 100, dy / 85);
});
function releasePointer(event, cancelled = false) {
  if (!pointer || event.pointerId !== pointer.id) return;
  const wasMoved = pointer.moved; pointer = null; state.dragging = false;
  if (surface.hasPointerCapture(event.pointerId)) surface.releasePointerCapture(event.pointerId);
  if (!wasMoved && !cancelled) void playClip('pet');
  else { state.targetX = state.targetY = 0; }
}
surface.addEventListener('pointerup', event => releasePointer(event));
surface.addEventListener('pointercancel', event => releasePointer(event, true));
surface.addEventListener('lostpointercapture', event => releasePointer(event, true));
surface.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault(); noteInteraction();
  if (event.key === 'Enter' || event.key === ' ') return void playClip('pet');
  if (event.key === 'Home') return returnIdle();
  const x = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const y = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  void steer(x, y); clearTimeout(keyTimer);
  keyTimer = setTimeout(() => { state.targetX = state.targetY = 0; }, 1400);
});
$('petButton').addEventListener('click', () => { dialog.close(); void playClip('pet'); });
$('sleepButton').addEventListener('click', () => { dialog.close(); void playClip('sleep'); });
$('startButton').addEventListener('click', () => void playClip('idle'));
$('pauseButton').addEventListener('click', () => {
  state.paused = !state.paused; ++state.operation; noteInteraction();
  $('pauseButton').textContent = state.paused ? '继续' : '暂停';
  $('pauseButton').setAttribute('aria-pressed', String(state.paused));
  if (state.paused) { stopVideos(); stopMotion(); mood('陪伴暂停中'); }
  else returnIdle();
});
$('settingsButton').addEventListener('click', () => dialog.showModal());
dialog.addEventListener('click', event => {
  const r = dialog.getBoundingClientRect();
  if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)) dialog.close();
});
dialog.addEventListener('close', () => noteInteraction());
$('reduceMotion').addEventListener('change', () => {
  state.reduced = $('reduceMotion').checked; noteInteraction();
  if (state.reduced) showPoster(); else returnIdle();
});
reducedQuery.addEventListener('change', event => {
  state.reduced = event.matches; $('reduceMotion').checked = event.matches;
  if (event.matches) showPoster();
});

function stopMotion() {
  ++motionRequest; sensorPending = false; state.motion = false; sensorBaseline = null;
  gestureGate = { armed: true, since: null };
  clearTimeout(sensorTimer); window.removeEventListener('deviceorientation', onOrientation);
  $('motionButton').setAttribute('aria-pressed', 'false'); $('motionButton').querySelector('span').textContent = '开启倾斜';
  sourceLabel(); state.targetX = state.targetY = 0;
}
function onOrientation(event) {
  if (!state.motion || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
  sensorSample = { beta: event.beta, gamma: event.gamma };
  if (!sensorBaseline) { sensorBaseline = { ...sensorSample }; message('已校准。轻轻倾斜手机，它会跟着看。'); sourceLabel(); }
  clearTimeout(sensorTimer);
  if (state.dragging) return;
  const value = relativeTilt(sensorSample, sensorBaseline, screen.orientation?.angle ?? window.orientation ?? 0);
  if (!dialog.open && !state.paused && state.mode !== 'pet' && state.mode !== 'sleep') {
    gestureGate = tiltGesture(value.x, value.y, performance.now(), gestureGate);
    if (gestureGate.trigger) {
      state.targetX = state.targetY = 0;
      void playClip('pet'); return;
    }
    if (pendingClip?.name === 'pet') return;
  }
  void steer(value.x, value.y, 'motion');
}
async function toggleMotion() {
  if (state.motion || sensorPending) return stopMotion();
  if (state.paused) return message('先点“继续”，再开启倾斜互动。');
  if (!window.isSecureContext) return message('手机感应需要 HTTPS 地址；现在可以按住小猫拖动。');
  if (!('DeviceOrientationEvent' in window)) return message('此浏览器没有方向感应。请用手机打开，或直接拖动。');
  sensorPending = true; const request = ++motionRequest;
  try {
    if (typeof window.DeviceOrientationEvent.requestPermission === 'function') {
      const result = await window.DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') throw new Error('未允许方向感应；可以继续拖动，或在浏览器设置中允许。');
    }
    if (request !== motionRequest || document.hidden) return;
    sensorBaseline = null; state.motion = true;
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    $('motionButton').setAttribute('aria-pressed', 'true'); $('motionButton').querySelector('span').textContent = '关闭倾斜';
    sourceLabel(); message('保持舒服的握姿，等待感应器校准…');
    sensorTimer = setTimeout(() => { if (!sensorBaseline) { stopMotion(); message('没有收到手机感应数据。请用支持的手机浏览器打开，或继续拖动。'); } }, 5000);
  } catch (error) { if (request === motionRequest) { stopMotion(); message(error.message); } }
  finally { if (request === motionRequest) sensorPending = false; }
}
$('motionButton').addEventListener('click', toggleMotion);
$('calibrateButton').addEventListener('click', () => {
  gestureGate = { armed: true, since: null };
  if (state.motion) { sensorBaseline = null; state.targetX = state.targetY = 0; message('保持当前握姿，正在重新校准。'); }
  else message('先开启倾斜互动，再校准。');
});
screen.orientation?.addEventListener('change', () => { sensorBaseline = null; gestureGate = { armed: true, since: null }; });

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { ++state.operation; stopVideos(); stopMotion(); pointer = null; state.dragging = false; }
  else if (state.ready && !state.paused) { noteInteraction(); returnIdle(); }
});
window.addEventListener('pagehide', () => { stopMotion(); stopVideos(); });

async function init() {
  try {
    await poster.decode(); ctx.drawImage(poster, 0, 0, 720, 1280);
    resizeExtension();
  } catch { ctx.fillStyle = '#b3aba4'; ctx.fillRect(0, 0, 720, 1280); }
  state.ready = true;
  for (const id of ['touchSurface', 'petButton', 'sleepButton']) $(id).disabled = false;
  requestAnimationFrame(render);
  if (state.reduced) showPoster(); else await playClip('idle', { automatic: true });
  // Pose assets are decoded once rather than seeking a video on every sensor event.
  loadAtlas('yaw').catch(() => {});
  setTimeout(() => { if (!document.hidden) loadAtlas('pitch').catch(() => {}); }, 1800);
}
void init();
