// Wiring: subscribes the views to gameState and translates DOM input into
// state intents. Combat event batches replay through combatView's dramatic
// queue; world refreshes and end-of-combat overlays wait for the replay.

import * as game from './state/gameState.js';
import { renderMap, bindMapClicks } from './render/mapView.js';
import { drawHoard } from './render/hoardView.js';
import { presentCombat } from './render/combatView.js';
import * as ui from './render/ui.js';
import { DRAGON_TIERS } from '../data/dragonProgression.js';

const combatEls = {
  enemies: ui.el('combat-enemies'),
  player: ui.el('combat-player'),
  actions: ui.el('combat-actions'),
  log: ui.el('combat-log'),
  overlay: ui.el('combat-overlay'),
};

const COMBAT_EVENTS = new Set([
  'combat-start', 'initiative', 'round', 'attack', 'breath', 'morale',
  'flee', 'recharge', 'death', 'hero-down', 'victory', 'defeat', 'retreat',
  'spell-cast', 'spell-hit', 'spell-heal', 'spell-wave',
]);

function refreshWorld(state) {
  ui.updateHud(state);
  renderMap(ui.el('map'), state);
  const tierIndex = Math.max(0, DRAGON_TIERS.findIndex((t) => t.tier === state.meta.tier));
  drawHoard(ui.el('hoard-canvas'), state.meta.hoardGold, tierIndex);
}

function showBankedOverlay(ev, events) {
  const tierUp = events.find((e) => e.type === 'tier-up');
  ui.showResult({
    title: tierUp ? 'You have GROWN!' : 'Treasure banked!',
    growth: tierUp
      ? {
          img: './assets/dragon-fire.png',
          text: `Your hoard's warmth changes you… you are now a ${tierUp.to.label.toUpperCase()}! ` +
            `${tierUp.to.hpMax} HP, armor ${tierUp.to.ac}, bite ${tierUp.to.attacks[0].damage}, breath ${tierUp.to.breath.damage}.`,
        }
      : null,
    body: `You escaped depth ${ev.depth} with ${ev.banked} gold (${ev.bonus} bonus for reaching the exit). Your hoard is now ${ev.hoard.toLocaleString()} gold.`,
    actions: [
      { label: 'Delve deeper', onClick: () => { ui.showOverlay('result-overlay', false); game.nextLabyrinth(); } },
      { label: 'Rest at your lair', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } },
    ],
  });
}

function showRetreatOverlay(ev) {
  ui.showResult({
    title: 'You flee to your lair!',
    body:
      ev.lost > 0
        ? `You dropped ${ev.lost} unbanked gold as you fled… but your hoard of ${ev.hoard.toLocaleString()} gold is safe.`
        : `Your hoard of ${ev.hoard.toLocaleString()} gold is safe. Rest up and try again!`,
    actions: [
      { label: 'Hunt again', onClick: () => { ui.showOverlay('result-overlay', false); game.nextLabyrinth(); } },
      { label: 'Back to title', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } },
    ],
  });
}

// ------------------------------------------------------------------ render
game.subscribe((state, events) => {
  ui.showScreen(state.screen);

  if (state.screen === 'title') {
    ui.updateTitle(state);
    return;
  }

  const combatBatch = events.some((e) => COMBAT_EVENTS.has(e.type));

  for (const ev of events) {
    if (ev.type === 'entered') {
      ui.clearExploreLog();
      ui.logExplore(`You slink into labyrinth depth ${ev.depth}. Find the exit!`);
    }
    if (ev.type === 'resumed') ui.logExplore(`Back to the hunt at depth ${ev.depth}.`);
    if (ev.type === 'loot') ui.logExplore(`You found ${ev.label} — ${ev.gold} gold!`, 'log-hit');
    if (ev.type === 'banked') showBankedOverlay(ev, events);
  }

  if (!combatBatch) {
    refreshWorld(state);
    return;
  }

  // Combat: replay dramatically; refresh the world and any end-of-combat
  // overlay only after the dice have finished.
  presentCombat(combatEls, state, events, {
    onAttack: (targetId) => game.attack(targetId),
    onBreath: () => game.breath(),
    onCast: (spellId, targetId) => game.cast(spellId, targetId),
    onBatchDone: (evts) => {
      const retreat = evts.find((e) => e.type === 'retreat');
      if (evts.some((e) => e.type === 'victory')) combatEls.overlay.hidden = true;
      if (retreat) {
        combatEls.overlay.hidden = true;
        showRetreatOverlay(retreat);
      }
      refreshWorld(state);
    },
  });
});

// ------------------------------------------------------------------ input
const KEYS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
  W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
};

document.addEventListener('keydown', (ev) => {
  const dir = KEYS[ev.key];
  if (!dir) return;
  ev.preventDefault();
  game.move(dir[0], dir[1]);
});

bindMapClicks(ui.el('map'), (x, y) => game.moveTo(x, y));

// Touch D-pad: tap to step, hold to keep walking. Shown via CSS on coarse
// pointers, plus a JS fallback for anything with a touchscreen.
let dpadTimer = null;
for (const btn of document.querySelectorAll('.dpad-btn')) {
  const dx = Number(btn.dataset.dx);
  const dy = Number(btn.dataset.dy);
  btn.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    game.move(dx, dy);
    clearInterval(dpadTimer);
    dpadTimer = setInterval(() => game.move(dx, dy), 220);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    btn.addEventListener(type, () => clearInterval(dpadTimer));
  }
}
if ('ontouchstart' in window) document.body.classList.add('show-dpad');

ui.el('btn-new').addEventListener('click', () => game.newGame(seedFromUrl()));
ui.el('btn-continue').addEventListener('click', () => game.continueGame());
ui.el('btn-quit').addEventListener('click', () => game.quitToTitle());

// Party selection on the title screen.
for (const box of document.querySelectorAll('.party-opt input')) {
  box.addEventListener('change', () => {
    const ids = [...document.querySelectorAll('.party-opt input:checked')].map((b) => b.dataset.cid);
    game.setParty(ids);
  });
}

function seedFromUrl() {
  try {
    return new URLSearchParams(location.search).get('seed');
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ boot
game.init();

// Debug hook for the console (and automated tests): window.__game.state etc.
window.__game = game;
