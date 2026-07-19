// Wiring: subscribes the views to gameState and translates DOM input into
// state intents. Combat event batches replay through combatView's dramatic
// queue; world refreshes and end-of-combat overlays wait for the replay.

import * as game from './state/gameState.js';
import { renderMap, bindMapClicks } from './render/mapView.js';
import { drawHoard } from './render/hoardView.js';
import { presentCombat } from './render/combatView.js';
import * as ui from './render/ui.js';
import { DRAGON_TIERS, tierByName } from '../data/dragonProgression.js';
import { COMPANIONS, companionById } from '../data/party.js';
import { itemById } from '../data/items.js';
import { familiarById } from '../data/familiars.js';
import { spellById } from '../data/spells.js';
import { SPRITES } from './assets-manifest.js';

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
    body: `You escaped ${game.state.run?.dungeon.zone ? game.state.run.dungeon.zone.sub : `depth ${ev.depth}`} with ${ev.banked} gold (${ev.bonus} bonus for reaching the exit). Your hoard is now ${ev.hoard.toLocaleString()} gold.`,
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
      ui.logExplore(
        ev.zone
          ? `You enter ${ev.zone.name} — ${ev.zone.sub}. Find the way down!`
          : `You slink into labyrinth depth ${ev.depth}. Find the exit!`
      );
    }
    if (ev.type === 'resumed') ui.logExplore(`Back to the hunt at depth ${ev.depth}.`);
    if (ev.type === 'loot') ui.logExplore(`You found ${ev.label} — ${ev.gold} gold!`, 'log-hit');
    if (ev.type === 'tome') {
      ui.logExplore(
        ev.spell
          ? `A dusty spell tome! The dragon devours it and learns ${ev.spell}!`
          : `A spell tome — but the dragon knows it all. Sold for ${ev.gold} gold.`,
        'log-start'
      );
    }
    if (ev.type === 'familiar-found') ui.logExplore(`Something stirs in the den… a familiar joins you: ${ev.name} — ${ev.blurb}!`, 'log-start');
    if (ev.type === 'item-found') ui.logExplore(`Inside the cache: ${ev.name} — ${ev.blurb}. Equip it from a character sheet!`, 'log-start');
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
    onSheet: (id) => openSheet(id),
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

// ------------------------------------------------------------------ sheets
function sheetSubject(id) {
  if (id === 'dragon' || id?.startsWith?.('dragon-')) {
    const tier = tierByName(game.state.meta.tier);
    const runHp = game.state.run?.dragon.hp;
    return {
      name: `Red Dragon (${tier.label})`,
      blurb: `Hoard: ${game.state.meta.hoardGold.toLocaleString()} gold. The labyrinth's rightful owner.`,
      sprite: SPRITES['dragon-fly'],
      frames: 4,
      flip: true,
      ac: tier.ac,
      hp: runHp ? `${runHp.current} / ${runHp.max}` : `${tier.hpMax}`,
      abilities: tier.abilities,
      attacks: tier.attacks,
      breath: tier.breath,
      spells: game.state.meta.tomeSpells.map((sid) => spellById(sid)).filter(Boolean),
      familiar: familiarById(game.state.meta.familiar),
      equip: equipInfo('dragon'),
    };
  }
  const c = companionById(id) ?? game.state.meta.customCharacters.find((h) => h.id === id);
  if (!c) return null;
  const slot = game.state.run?.party.find((pm) => pm.id === id);
  return {
    name: c.name,
    blurb: c.imported
      ? 'A hero of the portal, drawn into the labyrinth.'
      : c.spells.length ? 'Blade in one hand, spellbook in the other.' : 'Steel, songs, and stubbornness.',
    sprite: SPRITES[c.anim.idle],
    frames: 2,
    flip: true,
    ac: c.ac,
    hp: slot ? `${slot.hp.current} / ${slot.hp.max}` : `${c.hpMax}`,
    abilities: c.abilities,
    attacks: c.attacks,
    spells: c.spells.map((sid) => spellById(sid)).filter(Boolean),
    equip: equipInfo(id),
  };
}

function equipInfo(charKey) {
  const taken = {};
  for (const [key, slots] of Object.entries(game.state.meta.equipment ?? {})) {
    for (const id of Object.values(slots)) taken[id] = key;
  }
  return {
    charKey,
    slots: game.state.meta.equipment?.[charKey] ?? {},
    inventory: game.state.meta.inventory ?? [],
    taken,
  };
}

let openSheetId = null;
function openSheet(id) {
  const subject = sheetSubject(id);
  if (subject) {
    openSheetId = id;
    ui.showCharacterSheet(subject);
  }
}

// equipment dropdowns inside the sheet
ui.el('sheet-body').addEventListener('change', (ev) => {
  const sel = ev.target.closest('.equip-select');
  if (!sel) return;
  game.equip(sel.dataset.char, sel.dataset.slot, sel.value || null);
  if (openSheetId) openSheet(openSheetId);
});

for (const btn of document.querySelectorAll('.sheet-btn')) {
  btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
}
ui.el('sheet-close').addEventListener('click', () => ui.showOverlay('sheet-overlay', false));
ui.el('sheet-overlay').addEventListener('click', (ev) => {
  if (ev.target === ui.el('sheet-overlay')) ui.showOverlay('sheet-overlay', false);
});
ui.el('hud-tier').addEventListener('click', () => openSheet('dragon'));
ui.el('hud-tier').style.cursor = 'pointer';

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

// Party selection on the title screen (delegated: imported heroes render late).
document.addEventListener('change', (ev) => {
  if (!ev.target.matches('.party-opt input')) return;
  const ids = [...document.querySelectorAll('.party-opt input:checked')].map((b) => b.dataset.cid);
  game.setParty(ids);
});

// Import heroes from the portal's exported JSON.
ui.el('btn-import').addEventListener('click', () => ui.el('import-file').click());
ui.el('import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const count = game.importHeroes(JSON.parse(await file.text()));
    ui.logExplore(`Imported ${count} hero${count === 1 ? '' : 'es'}.`);
  } catch {
    ui.logExplore('That file did not look like a hero export.', 'log-hurt');
  }
});

// Familiar picker on the title screen (dynamic buttons; found-only).
ui.el('familiar-buttons').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.familiar-btn');
  if (btn && !btn.disabled) game.setFamiliar(btn.dataset.fam || null);
});

// Zone picker on the title screen. Scoped to its container: .zone-btn is
// reused as a visual style by sheet/import/familiar buttons.
for (const btn of document.querySelectorAll('#zone-buttons .zone-btn')) {
  btn.addEventListener('click', () => game.setZone(btn.dataset.zone || null));
}
ui.el('zone-sub').addEventListener('change', (ev) => {
  const pick = game.state.meta.zone;
  if (pick) game.setZone(pick.zoneId, Number(ev.target.value));
});

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
