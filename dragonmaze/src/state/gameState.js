// Single source of truth plus every state transition. Views subscribe and
// re-render on change; they never mutate state directly. All world
// generation is seeded; all combat dice are live.

import { generateDungeon } from '../world/maze.js';
import { tierByName } from '../../data/dragonProgression.js';
import { monsterById } from '../../data/monsters.js';
import { makeCombatant, makeDragonCombatant } from '../engine/entities.js';
import {
  createCombat,
  runMonsterTurns,
  playerAttack,
  playerBreath,
  isPlayerTurn,
} from '../engine/combat.js';
import { endOfRunBonus, tierAfterBanking } from '../engine/rules.js';
import { liveRNG } from '../engine/rng.js';
import { loadSave, persist, clearSave } from './save.js';

function freshMeta() {
  return {
    hoardGold: 0,
    tier: 'wyrmling',
    runsCompleted: 0,
    customCharacters: [],
    settings: { hardcore: false, sound: false },
  };
}

export const state = {
  screen: 'title', // 'title' | 'game'
  meta: freshMeta(),
  run: null,
  hasSave: false,
};

const listeners = [];
export function subscribe(fn) {
  listeners.push(fn);
}
function emit(events = []) {
  for (const fn of listeners) fn(state, events);
}

function randomSeed() {
  return Math.floor(liveRNG() * 0xffffffff).toString(36) + Date.now().toString(36).slice(-4);
}

function key(x, y) {
  return `${x},${y}`;
}

function reveal(run) {
  const { x, y } = run.playerPos;
  for (const [dx, dy] of [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx >= 0 && tx < run.dungeon.width && ty >= 0 && ty < run.dungeon.height) {
      run.explored[key(tx, ty)] = true;
    }
  }
}

// ---------------------------------------------------------------- lifecycle
export function init() {
  const save = loadSave();
  state.hasSave = save != null;
  if (save) state.meta = save.meta;
  emit([{ type: 'booted' }]);
}

export function newGame(seed = null) {
  clearSave();
  state.meta = freshMeta();
  enterLabyrinth(seed ?? randomSeed());
}

export function continueGame() {
  const save = loadSave();
  if (!save) {
    newGame();
    return;
  }
  state.meta = save.meta;
  if (save.run) {
    state.run = save.run;
    state.run.combat = null;
    state.screen = 'game';
    emit([{ type: 'resumed', depth: state.run.dungeon.depth }]);
  } else {
    enterLabyrinth(randomSeed());
  }
}

export function enterLabyrinth(seed) {
  const depth = state.meta.runsCompleted + 1;
  const tier = tierByName(state.meta.tier);
  const dungeon = generateDungeon(seed, depth);
  state.run = {
    dragon: { tier: tier.tier, hp: { current: tier.hpMax, max: tier.hpMax } },
    party: [],
    unbankedGold: 0,
    dungeon,
    playerPos: { ...dungeon.start },
    explored: {},
    phase: 'explore', // 'explore' | 'combat' | 'won' | 'defeat'
    combat: null,
    lastResult: null,
  };
  reveal(state.run);
  state.screen = 'game';
  state.hasSave = true;
  persist(state);
  emit([{ type: 'entered', depth, seed }]);
}

export function quitToTitle() {
  persist(state);
  state.screen = 'title';
  state.hasSave = loadSave() != null;
  if (state.run && state.run.phase !== 'explore') state.run = null;
  emit([{ type: 'quit-to-title' }]);
}

// ---------------------------------------------------------------- exploring
export function move(dx, dy) {
  const run = state.run;
  if (!run || run.phase !== 'explore') return;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  const x = run.playerPos.x + dx;
  const y = run.playerPos.y + dy;
  const d = run.dungeon;
  if (x < 0 || x >= d.width || y < 0 || y >= d.height) return;
  if (d.tiles[y][x] !== 1) return;

  // Bump-to-fight: stepping at a monster tile starts combat; the dragon
  // only occupies the tile after winning.
  const encounter = d.encounters.find((e) => e.x === x && e.y === y);
  if (encounter) {
    beginCombat(encounter);
    return;
  }

  run.playerPos = { x, y };
  reveal(run);
  const events = [{ type: 'moved', x, y }];

  const lootIdx = d.loot.findIndex((l) => l.x === x && l.y === y);
  if (lootIdx >= 0) {
    const [loot] = d.loot.splice(lootIdx, 1);
    run.unbankedGold += loot.gold;
    events.push({ type: 'loot', label: loot.label, icon: loot.icon, gold: loot.gold });
  }

  if (d.exit.x === x && d.exit.y === y) {
    bankAndWin(events);
    return;
  }

  persist(state);
  emit(events);
}

export function moveTo(x, y) {
  const dx = x - state.run?.playerPos.x;
  const dy = y - state.run?.playerPos.y;
  if (Math.abs(dx) + Math.abs(dy) === 1) move(dx, dy);
}

function bankAndWin(events) {
  const run = state.run;
  const bonus = endOfRunBonus(run.dungeon.depth);
  const banked = run.unbankedGold + bonus;
  state.meta.hoardGold += banked;
  state.meta.runsCompleted += 1;
  run.phase = 'won';
  run.lastResult = { banked, bonus, hoard: state.meta.hoardGold, depth: run.dungeon.depth };
  events.push({ type: 'banked', ...run.lastResult });
  checkTierUp(events);
  persist(state);
  emit(events);
}

/** Hoard-gated growth: crossing a threshold at banking time grows the dragon. */
function checkTierUp(events) {
  const gained = tierAfterBanking(state.meta.tier, state.meta.hoardGold);
  if (!gained.length) return;
  const from = state.meta.tier;
  state.meta.tier = gained[gained.length - 1].tier;
  events.push({ type: 'tier-up', from, to: gained[gained.length - 1] });
}

// ---------------------------------------------------------------- combat
function beginCombat(encounter) {
  const run = state.run;
  const tier = tierByName(run.dragon.tier);
  const dragon = makeDragonCombatant(tier, run.dragon.hp.current);
  const monsters = encounter.monsterIds.map((id) => makeCombatant(monsterById(id)));
  const { combat, events } = createCombat(dragon, monsters, liveRNG);
  run.phase = 'combat';
  run.combat = { combat, encounterId: encounter.id };
  const followUp = runMonsterTurns(combat, liveRNG);
  syncDragonHp();
  const all = [...events, ...followUp];
  if (combat.over) {
    finishCombat(all);
    return;
  }
  emit(all);
}

export function attack(targetId) {
  resolvePlayerAction((combat) => playerAttack(combat, targetId, liveRNG));
}

export function breath() {
  resolvePlayerAction((combat) => playerBreath(combat, liveRNG));
}

function resolvePlayerAction(act) {
  const run = state.run;
  if (!run || run.phase !== 'combat' || !run.combat) return;
  const combat = run.combat.combat;
  if (!isPlayerTurn(combat)) return;
  const events = act(combat);
  if (!events.length) return;
  if (!combat.over) events.push(...runMonsterTurns(combat, liveRNG));
  syncDragonHp();
  if (combat.over) {
    finishCombat(events);
    return;
  }
  // Mid-combat state is never persisted; reloading resumes from before the fight.
  emit(events);
}

function syncDragonHp() {
  const run = state.run;
  const dragon = run.combat?.combat.order.find((c) => c.kind === 'dragon');
  if (dragon) run.dragon.hp.current = dragon.hp.current;
}

function finishCombat(events) {
  const run = state.run;
  const combat = run.combat.combat;
  if (combat.winner === 'dragon') {
    // Only defeated monsters drop gold; ones that fled keep theirs.
    const gold = combat.order
      .filter((c) => c.kind !== 'dragon' && c.hp.current <= 0)
      .reduce((sum, m) => sum + (m.goldValue ?? 0), 0);
    run.unbankedGold += gold;
    const idx = run.dungeon.encounters.findIndex((e) => e.id === run.combat.encounterId);
    if (idx >= 0) {
      const enc = run.dungeon.encounters[idx];
      run.dungeon.encounters.splice(idx, 1);
      run.playerPos = { x: enc.x, y: enc.y };
      reveal(run);
    }
    run.phase = 'explore';
    run.combat = null;
    persist(state);
    emit(events);
  } else {
    forcedRetreat(events);
  }
}

/** 0 HP: the dragon flees. Banked hoard is safe; unbanked loot is lost. */
function forcedRetreat(events) {
  const run = state.run;
  const lost = run.unbankedGold;
  run.unbankedGold = 0;
  run.phase = 'defeat';
  run.combat = null;
  run.lastResult = { lost, hoard: state.meta.hoardGold };
  persist(state); // run is not serialized outside 'explore'; meta survives
  events.push({ type: 'retreat', lost, hoard: state.meta.hoardGold });
  emit(events);
}

// ---------------------------------------------------------------- after-run
export function nextLabyrinth() {
  enterLabyrinth(randomSeed());
}
