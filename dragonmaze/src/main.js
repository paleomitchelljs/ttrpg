// Wiring: subscribes the views to gameState and translates DOM input into
// state intents. No game logic here.

import * as game from './state/gameState.js';
import { renderMap, bindMapClicks } from './render/mapView.js';
import { drawHoard } from './render/hoardView.js';
import { renderCombat, narrateCombatEvents, clearCombatLog } from './render/combatView.js';
import * as ui from './render/ui.js';

const combatEls = {
  enemies: ui.el('combat-enemies'),
  player: ui.el('combat-player'),
  actions: ui.el('combat-actions'),
  log: ui.el('combat-log'),
  die: ui.el('combat-die'),
};

// ------------------------------------------------------------------ render
game.subscribe((state, events) => {
  ui.showScreen(state.screen);

  if (state.screen === 'title') {
    ui.updateTitle(state);
    return;
  }

  ui.updateHud(state);
  renderMap(ui.el('map'), state);
  drawHoard(ui.el('hoard-canvas'), state.meta.hoardGold);

  const phase = state.run?.phase;
  ui.showOverlay('combat-overlay', phase === 'combat');

  for (const ev of events) {
    if (ev.type === 'entered') {
      ui.clearExploreLog();
      ui.logExplore(`You slink into labyrinth depth ${ev.depth}. Find the exit! 🚪`);
    }
    if (ev.type === 'resumed') ui.logExplore(`Back to the hunt at depth ${ev.depth}.`);
    if (ev.type === 'loot') ui.logExplore(`${ev.icon} You found ${ev.label} — ${ev.gold} gold!`, 'log-hit');
    if (ev.type === 'combat-start') clearCombatLog(combatEls);
    if (ev.type === 'banked') {
      ui.showResult({
        title: '🏆 Treasure banked!',
        body: `You escaped depth ${ev.depth} with ${ev.banked} gold (${ev.bonus} bonus for reaching the exit). Your hoard is now ${ev.hoard.toLocaleString()} gold.`,
        actions: [
          { label: '⛏️ Delve deeper', onClick: () => { ui.showOverlay('result-overlay', false); game.nextLabyrinth(); } },
          { label: '🏠 Rest at your lair', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } },
        ],
      });
    }
    if (ev.type === 'retreat') {
      ui.showResult({
        title: '🩹 You flee to your lair!',
        body:
          ev.lost > 0
            ? `You dropped ${ev.lost} unbanked gold as you fled… but your hoard of ${ev.hoard.toLocaleString()} gold is safe.`
            : `Your hoard of ${ev.hoard.toLocaleString()} gold is safe. Rest up and try again!`,
        actions: [
          { label: '🐉 Hunt again', onClick: () => { ui.showOverlay('result-overlay', false); game.nextLabyrinth(); } },
          { label: '🏠 Back to title', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } },
        ],
      });
    }
  }

  if (phase === 'combat') {
    narrateCombatEvents(combatEls, events);
    renderCombat(combatEls, state, (targetId) => game.attack(targetId));
  } else if (events.some((e) => e.type === 'victory')) {
    // final combat events (victory line) still land in the combat log
    narrateCombatEvents(combatEls, events);
  }
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

ui.el('btn-new').addEventListener('click', () => game.newGame(seedFromUrl()));
ui.el('btn-continue').addEventListener('click', () => game.continueGame());
ui.el('btn-quit').addEventListener('click', () => game.quitToTitle());

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
