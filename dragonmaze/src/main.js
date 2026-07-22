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
import { spellById, SPELLS as SPELLS_ALL } from '../data/spells.js';
import * as rulesRef from './engine/rules.js';
import { SPRITES } from './assets-manifest.js';

const combatEls = {
  enemies: ui.el('combat-enemies'),
  player: ui.el('combat-player'),
  targetInfo: ui.el('combat-target-info'),
  actions: ui.el('combat-actions'),
  log: ui.el('combat-log'),
  overlay: ui.el('combat-overlay'),
};

const COMBAT_EVENTS = new Set([
  'combat-start', 'initiative', 'round', 'attack', 'breath', 'morale',
  'flee', 'recharge', 'death', 'hero-down', 'victory', 'defeat', 'retreat',
  'spell-cast', 'spell-hit', 'spell-heal', 'spell-wave', 'item-drop',
  'dominated', 'dominate-resisted', 'bane',
  'parley', 'parley-rout', 'parley-peace', 'parley-paid', 'quest-received', 'quest-complete',
]);

function refreshWorld(state) {
  ui.updateHud(state);
  renderMap(ui.el('map'), state);
  const tierIndex = Math.max(0, DRAGON_TIERS.findIndex((t) => t.tier === state.meta.tier));
  // Hide the hoard pile until there's gold to draw — no empty cave box early on.
  const canvas = ui.el('hoard-canvas');
  canvas.hidden = state.meta.hoardGold <= 0;
  if (!canvas.hidden) drawHoard(canvas, state.meta.hoardGold, tierIndex);
  renderRoster(state);
}

/** The explore-screen party roster: each member's HP + a tap to their sheet. */
function renderRoster(state) {
  const box = ui.el('party-roster');
  const run = state.run;
  if (!run) { box.replaceChildren(); return; }
  const members = [];
  if (run.dragon) {
    members.push({ key: 'dragon', name: 'Red Dragon', hp: run.dragon.hp, sprite: SPRITES['dragon-fly'], frames: 4 });
  }
  for (const slot of run.party) {
    const c = companionById(slot.id) ?? game.state.meta.customCharacters.find((h) => h.id === slot.id);
    if (c) members.push({ key: slot.id, name: c.name, hp: slot.hp, sprite: SPRITES[c.anim.idle], frames: 2, pending: game.state.meta.heroGrowth?.[slot.id]?.pending ?? 0 });
  }
  box.replaceChildren(
    ...members.map((m) => {
      const pct = Math.max(0, Math.round((100 * m.hp.current) / m.hp.max));
      const row = document.createElement('button');
      row.className = 'roster-row';
      row.dataset.sheet = m.key;
      // Name lives on the character sheet (tap the row); the roster is just
      // face + HP so it stays compact on a phone.
      row.title = m.name;
      row.setAttribute('aria-label', `${m.name}, ${m.hp.current} of ${m.hp.max} HP`);
      // A compact vertical card: sprite on top, HP (number + bar) below. Cards
      // sit in a horizontal row (see .party-roster).
      row.innerHTML = `
        <span class="roster-face sprite f${m.frames} flip"><img src="${m.sprite}" alt=""></span>
        <span class="roster-hp">${m.hp.current}/${m.hp.max}</span>
        <span class="hp-bar"><span class="hp-fill${pct <= 35 ? ' low' : ''}" style="width:${pct}%"></span></span>
        ${m.pending ? '<span class="roster-levelup">level up!</span>' : ''}`;
      return row;
    })
  );
}

function showBankedOverlay(ev, events) {
  const tierUp = events.find((e) => e.type === 'tier-up');
  // In a bespoke zone the *regions* are the depth (reached through doors), so
  // there is no "delve deeper" into a fresh procedural maze — you surface.
  const inZone = !!game.state.run?.dungeon.zone;
  const actions = inZone
    ? [{ label: 'Return to the surface', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } }]
    : [
        { label: 'Delve deeper', onClick: () => { ui.showOverlay('result-overlay', false); game.nextLabyrinth(); } },
        { label: 'Rest at your lair', onClick: () => { ui.showOverlay('result-overlay', false); game.quitToTitle(); } },
      ];
  ui.showResult({
    title: tierUp ? 'You have GROWN!' : 'Treasure banked!',
    growth: tierUp
      ? {
          img: './assets/dragon-fire.png',
          text: `Your hoard's warmth changes you… you are now a ${tierUp.to.label.toUpperCase()}! ` +
            `${tierUp.to.hpMax} HP, armor ${tierUp.to.ac}, bite ${tierUp.to.attacks[0].damage}, breath ${tierUp.to.breath.damage}.`,
        }
      : null,
    body: `You escaped ${inZone ? game.state.run.dungeon.zone.sub : `depth ${ev.depth}`} with ${ev.banked} gold${ev.bonus > 0 ? ` (${ev.bonus} bonus for reaching the exit)` : ''}. Your hoard is now ${ev.hoard.toLocaleString()} gold.` +
      events.filter((e) => e.type === 'level-up').map((e) => ` ${e.who} reaches level ${e.level}!`).join(''),
    actions,
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
let prevScreen = null;
game.subscribe((state, events) => {
  ui.showScreen(state.screen);

  if (state.screen === 'title') {
    // Arriving at the title (boot or quit) resets to the New/Continue menu;
    // stay put while the player is mid-setup (party/zone toggles re-render here).
    if (prevScreen !== 'title') showSetup(false);
    ui.updateTitle(state);
    prevScreen = 'title';
    return;
  }
  prevScreen = state.screen;

  const combatBatch = events.some((e) => COMBAT_EVENTS.has(e.type));

  for (const ev of events) {
    if (ev.type === 'entered') {
      // A fresh delve dismisses any leftover result overlay (retreat/banked).
      ui.showOverlay('result-overlay', false);
      ui.clearExploreLog();
      ui.logExplore(
        ev.zone
          ? `You enter ${ev.zone.name} — ${ev.zone.sub}. Find the way down!`
          : `You slink into labyrinth depth ${ev.depth}. Find the exit!`
      );
      ui.logExplore('Tap an adjacent tile to move, or use the arrow keys / pad.', 'log-dim');
    }
    if (ev.type === 'resumed') ui.logExplore(`Back to the hunt at depth ${ev.depth}.`);
    if (ev.type === 'traveled') {
      ui.clearExploreLog();
      ui.logExplore(`You pass through into ${ev.zone.sub}…`);
    }
    if (ev.type === 'portal-prompt') {
      ui.showResult({
        title: 'The Sunken Well',
        body: ev.label,
        actions: [
          { label: 'Descend', onClick: () => { ui.showOverlay('result-overlay', false); game.usePortal(ev.to); } },
          { label: 'Not now', onClick: () => ui.showOverlay('result-overlay', false) },
        ],
      });
    }
    if (ev.type === 'parley-offer') {
      const answer = (mode) => () => { ui.showOverlay('result-overlay', false); game.resolveEncounter(mode); };
      ui.showResult({
        title: 'Parley?',
        body: `${ev.names.join(', ')} block your path — they seem ${ev.disposition}. Talk your way past, or draw steel? (CHA check, DC ${ev.dc})`,
        actions: [
          { label: 'Fight!', onClick: answer('fight') },
          { label: 'Threaten', onClick: answer('threaten') },
          { label: 'Persuade', onClick: answer('persuade') },
          ...(ev.canBarter ? [{ label: `Barter (${ev.barterCost} gold)`, onClick: answer('barter') }] : []),
          { label: 'Ask for work', onClick: answer('work') },
        ],
      });
    }
    if (ev.type === 'parley-outcome') {
      const win = { threaten: 'They flinch and scatter before you!', persuade: 'Cooler heads prevail — they let you pass.', barter: 'Coin changes hands; they wave you through.', work: 'You strike a deal — they point you toward bigger prey.' };
      ui.logExplore(ev.success ? (win[ev.mode] ?? 'They let you pass.') : 'The parley fails — steel it is!', ev.success ? 'log-hit' : 'log-hurt');
    }
    if (ev.type === 'parley-paid') ui.logExplore(`You part with ${ev.cost} gold.`, 'log-dim');
    if (ev.type === 'quest-received') ui.logExplore(`A job: bring down ${ev.target} for ${ev.reward} gold.`, 'log-start');
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
    if (ev.type === 'level-up') ui.logExplore(`${ev.who} reaches level ${ev.level}! Open their sheet to choose an advance.`, 'log-start');
    if (ev.type === 'rested') {
      ui.logExplore(
        ev.ambush ? 'You make camp… but something finds you in the dark!' : 'You make camp and bind your wounds. The party recovers.',
        ev.ambush ? 'log-hurt' : 'log-hit'
      );
    }
    if (ev.type === 'heist-start') {
      ui.logExplore('A thief bolts from your camp with your purse in his eye — catch him before he slips out a door!', 'log-hurt');
    }
    if (ev.type === 'robbed') {
      ui.showResult({
        title: 'Robbed!',
        growth: { img: SPRITES['thief-portrait'], text: 'The Thief' },
        body: ev.escaped
          ? `The thief ducks out a door with ${ev.gold} gold — gone into the dark.`
          : `You wake to a lighter purse: a thief lifted ${ev.gold} gold while you slept.`,
        actions: [{ label: 'Blast!', onClick: () => ui.showOverlay('result-overlay', false) }],
      });
    }
    if (ev.type === 'surface-prompt') {
      const close = () => ui.showOverlay('result-overlay', false);
      const actions = ev.carried > 0
        ? [{ label: `Stash ${ev.carried} gold & keep exploring`, onClick: () => { close(); game.stashHoard(); } }]
        : [{ label: 'Keep exploring', onClick: close }];
      actions.push({ label: 'Leave the temple', onClick: () => { close(); game.surfaceExit(); } });
      ui.showResult({
        title: 'The gate to the surface',
        body: ev.carried > 0
          ? `The broken gate opens on the daylit world above. You're carrying ${ev.carried} gold — stash it safe and keep delving, or head home.`
          : 'The broken gate opens on the daylit world above.',
        actions,
      });
    }
    if (ev.type === 'stashed') {
      ui.logExplore(
        ev.stashed > 0
          ? `You stash ${ev.stashed} gold through the gate. Your hoard is now ${ev.hoard.toLocaleString()} gold — safe.`
          : 'Nothing to stash yet.',
        'log-hit'
      );
      const tierUp = events.find((e) => e.type === 'tier-up');
      if (tierUp) {
        ui.showResult({
          title: 'You have GROWN!',
          growth: {
            img: './assets/dragon-fire.png',
            text: `Your hoard's warmth changes you… you are now a ${tierUp.to.label.toUpperCase()}!`,
          },
          actions: [{ label: 'Keep exploring', onClick: () => ui.showOverlay('result-overlay', false) }],
        });
      }
    }
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
    onIntimidate: (targetId) => game.intimidate(targetId),
    onFlee: () => { if (confirm("Flee the fight? You'll escape but drop the gold you're carrying.")) game.flee(); },
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
      castStat: 'cha',
      renown: Object.entries(game.state.meta.reputation ?? {})
        .filter(([, v]) => v !== 0)
        .map(([faction, v]) => `${faction}: ${v > 0 ? '+' : ''}${v} (${rulesRef.dispositionLabel(v)})`),
      equip: equipInfo('dragon'),
    };
  }
  const c = game.heroWithGrowth(id);
  if (!c) return null;
  const slot = game.state.run?.party.find((pm) => pm.id === id);
  const g = game.state.meta.heroGrowth?.[id] ?? { xp: 0, level: 1, pending: 0, choices: [] };
  return {
    name: c.name,
    blurb: c.blurb
      ? c.blurb
      : c.imported
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
    castStat: c.castStat ?? 'cha',
    traits: c.abilityLabel ? [c.abilityLabel] : [],
    growth: {
      level: g.level,
      xp: g.xp,
      pending: g.pending,
      next: nextLevelXp(g.level),
      learnable: learnableSpells(id),
      caster: !!c.castStat,
      hpPerLevel: rulesRef.hpPerLevel(c),
    },
    equip: equipInfo(id),
  };
}

function nextLevelXp(level) {
  const { LEVEL_XP } = rulesRef;
  return level < LEVEL_XP.length ? LEVEL_XP[level] : null;
}

function learnableSpells(id) {
  const known = game.heroWithGrowth(id)?.spells ?? [];
  return SPELLS_ALL.filter((sp) => sp.tome !== false && !known.includes(sp.id));
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

// level-up advance choices inside the sheet
ui.el('sheet-body').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.advance-btn');
  if (!btn || !openSheetId) return;
  game.chooseAdvance(openSheetId, btn.dataset.advance, btn.dataset.spell ?? null);
  openSheet(openSheetId);
});

for (const btn of document.querySelectorAll('.sheet-btn')) {
  btn.addEventListener('click', () => openSheet(btn.dataset.sheet));
}
ui.el('sheet-close').addEventListener('click', () => ui.showOverlay('sheet-overlay', false));

// Party panel: open, close, select cards, view a companion's sheet.
ui.el('btn-party').addEventListener('click', () => ui.showOverlay('party-overlay', true));
ui.el('party-close').addEventListener('click', () => ui.showOverlay('party-overlay', false));
ui.el('party-overlay').addEventListener('click', (ev) => {
  if (ev.target === ui.el('party-overlay')) { ui.showOverlay('party-overlay', false); return; }
  const sheetBtn = ev.target.closest('.party-card-sheet');
  if (sheetBtn) { ev.stopPropagation(); openSheet(sheetBtn.dataset.sheet); return; }
  const card = ev.target.closest('.party-card');
  if (!card) return;
  // The dragon rides in the same list as a togglable member: on = it delves
  // with the party (mode 'dragon'), off = the party goes alone (mode 'party').
  if (card.dataset.dragon) {
    game.setMode(game.state.meta.mode === 'dragon' ? 'party' : 'dragon');
  } else {
    game.toggleCompanion(card.dataset.cid);
  }
});
ui.el('sheet-overlay').addEventListener('click', (ev) => {
  if (ev.target === ui.el('sheet-overlay')) ui.showOverlay('sheet-overlay', false);
});
ui.el('hud-tier').addEventListener('click', () => openSheet('dragon'));
ui.el('hud-tier').style.cursor = 'pointer';

// Party roster: tap any member (out of combat) to open their sheet — manage
// equipment, spend level-ups, read their story.
ui.el('party-roster').addEventListener('click', (ev) => {
  const row = ev.target.closest('.roster-row');
  if (row) openSheet(row.dataset.sheet);
});

// Rest between fights (risky).
ui.el('btn-rest').addEventListener('click', () => game.rest());

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

// The title has two views: the New/Continue menu, then the new-game setup
// (party + dungeon). "New" reveals setup; "Descend" actually starts it.
function showSetup(on) {
  ui.el('title-menu').hidden = on;
  ui.el('new-setup').hidden = !on;
}
ui.el('btn-new').addEventListener('click', () => {
  // Lost Temple is the default hunt; opening a fresh setup selects it (a prior
  // save's remembered zone shouldn't shadow the intended default).
  game.setZone('lost-temple');
  showSetup(true);
});
ui.el('btn-setup-back').addEventListener('click', () => showSetup(false));
ui.el('btn-begin').addEventListener('click', () => game.newGame(seedFromUrl()));
ui.el('btn-continue').addEventListener('click', () => game.continueGame());
ui.el('btn-quit').addEventListener('click', () => game.quitToTitle());

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
