import './style.css';
import { createStage } from './render/stage';
import { ctx } from './game/ctx';
import { AudioEngine } from './audio/audio';
import { Hud } from './ui/hud';
import { Game } from './game/game';

const gameEl = document.getElementById('game')!;
const uiEl = document.getElementById('ui')!;
const stage = createStage(gameEl);
ctx.stage = stage;
ctx.audio = new AudioEngine();
const hud = new Hud(uiEl);
const game = new Game(stage, hud);

let paused = false;
hud.onStart = () => {
  ctx.audio.unlock();
  game.start();
};
hud.onRetry = () => {
  game.reset();
  ctx.audio.unlock();
  game.start();
};
hud.onPause = (p) => {
  paused = p;
  if (ctx.audio.ac) void (p ? ctx.audio.ac.suspend() : ctx.audio.ac.resume());
};
hud.onMute = () => {
  ctx.audio.setMuted(!ctx.audio.muted);
  return ctx.audio.muted;
};
hud.showTitle();
// iOS needs a touchend/click to really start audio
for (const ev of ['touchend', 'click', 'keydown']) document.addEventListener(ev, () => ctx.audio.unlock(), { passive: true });

function resize() {
  const w = gameEl.clientWidth, h = gameEl.clientHeight;
  stage.renderer.setSize(w, h, false);
  stage.camera.aspect = w / h;
  stage.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(gameEl);
resize();

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.phase === 'play' && !hud.paused) hud.togglePause();
});

// adaptive resolution: keep the frame rate smooth on modest phones
let slowFrames = 0;
let pr = stage.renderer.getPixelRatio();
let last = performance.now();
function loop(now: number) {
  const raw = (now - last) / 1000;
  last = now;
  const dt = Math.max(0, Math.min(0.05, raw));
  if (!paused && !(window as unknown as { __freeze?: boolean }).__freeze) game.update(dt);
  stage.renderer.render(stage.scene, stage.camera);
  if (raw > 0.028) slowFrames++;
  else slowFrames = Math.max(0, slowFrames - 1);
  if (slowFrames > 90 && pr > 1) {
    pr = Math.max(1, pr - 0.25);
    stage.renderer.setPixelRatio(pr);
    resize();
    slowFrames = 0;
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// handy for automated play-testing
(window as unknown as Record<string, unknown>).__game = game;
(window as unknown as Record<string, unknown>).__ctx = ctx;
if (import.meta.env.DEV) void import('three').then((T) => ((window as unknown as Record<string, unknown>).__THREE = T));
