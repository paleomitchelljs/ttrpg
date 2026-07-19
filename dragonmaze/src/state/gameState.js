// Single source of truth plus every state transition. Views subscribe and
// re-render on change; they never mutate state directly. All world
// generation is seeded; all combat dice are live.

import { generateDungeon } from '../world/maze.js';
import { buildZoneDungeon } from '../world/zones.js';
import { zoneById } from '../../data/zones.js';
import { tierByName } from '../../data/dragonProgression.js';
import { monsterById } from '../../data/monsters.js';
import { companionById } from '../../data/party.js';
import { FAMILIARS, familiarById } from '../../data/familiars.js';
import { ITEMS, itemById } from '../../data/items.js';
import { parseHeroExport } from './importHero.js';
import { bumpDamage } from '../engine/rules.js';
import { SPELLS } from '../../data/spells.js';
import { makeCombatant, makeDragonCombatant } from '../engine/entities.js';
import {
  createCombat,
  runMonsterTurns,
  playerAttack,
  playerBreath,
  playerSpell,
  isPlayerTurn,
  heroesOf,
} from '../engine/combat.js';
import { endOfRunBonus, tierAfterBanking } from '../engine/rules.js';
import { liveRNG } from '../engine/rng.js';
import { loadSave, persist, clearSave } from './save.js';

function freshMeta() {
  return {
    hoardGold: 0,
    tier: 'wyrmling',
    runsCompleted: 0,
    party: ['bard', 'dragonkin-swashbuckler'],
    zone: null, // null = procedural labyrinth; else { zoneId, subIndex }
    familiar: null, // the active familiar (must be owned)
    familiarsOwned: [], // familiars are found in the dungeons, never bought
    tomeSpells: [], // spells the dragon has learned from found tomes
    inventory: [], // equippable items found in gleaming caches
    equipment: {}, // charKey -> { weapon, armor, trinket }
    customCharacters: [], // heroes imported from the portal's generator
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
  const spots = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
  if (state.meta.familiar === 'lantern-beetle') {
    spots.push([-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [0, 2], [-2, 0], [2, 0]);
  }
  for (const [dx, dy] of spots) {
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
  if (save) state.meta = normalizeMeta(save.meta);
  emit([{ type: 'booted' }]);
}

/** Fill fields that predate this save's version of the game. */
function normalizeMeta(meta) {
  meta.party ??= ['bard', 'dragonkin-swashbuckler'];
  meta.zone ??= null;
  meta.familiar ??= null;
  meta.familiarsOwned ??= [];
  meta.tomeSpells ??= [];
  meta.inventory ??= [];
  meta.equipment ??= {};
  meta.customCharacters ??= [];
  if (meta.familiar && !meta.familiarsOwned.includes(meta.familiar)) meta.familiar = null;
  return meta;
}

/** Look up a hero template: built-in companion or imported character. */
function heroById(id) {
  return companionById(id) ?? state.meta.customCharacters.find((c) => c.id === id) ?? null;
}

/** Import heroes from the portal's exported JSON. Returns how many landed. */
export function importHeroes(json) {
  const heroes = parseHeroExport(json);
  for (const h of heroes) {
    const at = state.meta.customCharacters.findIndex((c) => c.id === h.id);
    if (at >= 0) state.meta.customCharacters[at] = h;
    else state.meta.customCharacters.push(h);
  }
  persist(state);
  emit([{ type: 'heroes-imported', count: heroes.length }]);
  return heroes.length;
}

/** Items equipped by a character, resolved to data entries. */
function equippedItems(charKey) {
  return Object.values(state.meta.equipment[charKey] ?? {})
    .map(itemById)
    .filter(Boolean);
}

function equipmentMod(charKey, field) {
  return equippedItems(charKey).reduce((sum, item) => sum + (item.mods[field] ?? 0), 0);
}

/** Equip an owned item (or null to clear); an item serves one wearer only. */
export function equip(charKey, slot, itemId) {
  if (itemId) {
    const item = itemById(itemId);
    if (!item || item.slot !== slot || !state.meta.inventory.includes(itemId)) return;
    for (const [key, slots] of Object.entries(state.meta.equipment)) {
      for (const [sl, id] of Object.entries(slots)) {
        if (id === itemId) delete state.meta.equipment[key][sl];
      }
    }
  }
  state.meta.equipment[charKey] ??= {};
  if (itemId) state.meta.equipment[charKey][slot] = itemId;
  else delete state.meta.equipment[charKey][slot];
  persist(state);
  emit([{ type: 'equip-changed' }]);
}

/** Choose the active familiar from those already found (or null for none). */
export function setFamiliar(familiarId) {
  state.meta.familiar =
    familiarById(familiarId) && state.meta.familiarsOwned.includes(familiarId) ? familiarId : null;
  persist(state);
  emit([{ type: 'familiar-changed' }]);
}

/** Choose where to hunt: a written zone (by id) or null for procedural. */
export function setZone(zoneId, subIndex = 0) {
  state.meta.zone = zoneId && zoneById(zoneId) ? { zoneId, subIndex } : null;
  persist(state);
  emit([{ type: 'zone-changed' }]);
}

export function newGame(seed = null) {
  clearSave();
  // A new game resets progress, not the choices just made on the title
  // screen: keep the picked party and hunting ground.
  const { party, zone } = state.meta;
  state.meta = freshMeta();
  if (party) state.meta.party = party;
  state.meta.zone = zone ?? null;
  enterLabyrinth(seed ?? randomSeed());
}

export function continueGame() {
  const save = loadSave();
  if (!save) {
    newGame();
    return;
  }
  state.meta = normalizeMeta(save.meta);
  if (save.run) {
    state.run = save.run;
    state.run.combat = null;
    state.screen = 'game';
    emit([{ type: 'resumed', depth: state.run.dungeon.depth }]);
  } else {
    enterLabyrinth(randomSeed());
  }
}

/** Choose which companions join the next labyrinth. */
export function setParty(companionIds) {
  state.meta.party = companionIds.filter((id) => heroById(id)).slice(0, 3);
  persist(state);
  emit([{ type: 'party-changed' }]);
}

export function enterLabyrinth(seed) {
  const depth = state.meta.runsCompleted + 1;
  const tier = tierByName(state.meta.tier);
  const partyIds = (state.meta.party ?? []).filter((id) => heroById(id));
  const zonePick = state.meta.zone;
  const dungeon = zonePick
    ? buildZoneDungeon(zonePick.zoneId, zonePick.subIndex, seed, 1 + partyIds.length)
    : generateDungeon(seed, depth, 1 + partyIds.length);
  const dragonMax = tier.hpMax + equipmentMod('dragon', 'hpMax');
  state.run = {
    dragon: { tier: tier.tier, hp: { current: dragonMax, max: dragonMax } },
    party: partyIds.map((id) => {
      const c = heroById(id);
      const max = c.hpMax + equipmentMod(id, 'hpMax');
      return { id, hp: { current: max, max } };
    }),
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
  emit([{ type: 'entered', depth: dungeon.depth, seed, zone: dungeon.zone ?? null }]);
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
    if (loot.den) {
      const unowned = FAMILIARS.filter((f) => !state.meta.familiarsOwned.includes(f.id));
      if (unowned.length) {
        const found = unowned[Math.floor(liveRNG() * unowned.length)];
        state.meta.familiarsOwned.push(found.id);
        state.meta.familiar ??= found.id;
        events.push({ type: 'familiar-found', name: found.name, blurb: found.blurb });
      } else {
        run.unbankedGold += 75;
        events.push({ type: 'loot', label: 'an empty den (75 gold under the bedding)', gold: 75 });
      }
    } else if (loot.cache) {
      const unowned = ITEMS.filter((i) => !state.meta.inventory.includes(i.id));
      if (unowned.length) {
        const found = unowned[Math.floor(liveRNG() * unowned.length)];
        state.meta.inventory.push(found.id);
        events.push({ type: 'item-found', name: found.name, blurb: found.blurb });
      } else {
        run.unbankedGold += 90;
        events.push({ type: 'loot', label: 'a cache of coin (90 gold)', gold: 90 });
      }
    } else if (loot.tome) {
      const unknown = SPELLS.filter((sp) => !state.meta.tomeSpells.includes(sp.id));
      if (unknown.length) {
        const learned = unknown[Math.floor(liveRNG() * unknown.length)];
        state.meta.tomeSpells.push(learned.id);
        events.push({ type: 'tome', spell: learned.name });
      } else {
        run.unbankedGold += 100;
        events.push({ type: 'tome', spell: null, gold: 100 });
      }
    } else {
      let gold = loot.gold;
      if (state.meta.familiar === 'pack-rat') gold = Math.round(gold * 1.25);
      run.unbankedGold += gold;
      events.push({ type: 'loot', label: loot.label, icon: loot.icon, gold });
    }
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
  // A written zone advances to its next subregion for the next delve.
  if (state.meta.zone && run.dungeon.zone) {
    const zone = zoneById(state.meta.zone.zoneId);
    state.meta.zone.subIndex = Math.min(state.meta.zone.subIndex + 1, zone.subregions.length - 1);
  }
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
  const dragon = makeDragonCombatant(tier, run.dragon.hp.current, {
    spells: state.meta.tomeSpells,
    familiar: state.meta.familiar,
  });
  dragon.hp.max = run.dragon.hp.max;
  dragon.hp.current = Math.min(run.dragon.hp.current, dragon.hp.max);
  applyEquipment(dragon, 'dragon');
  // Downed companions come along at 0 HP — a Healing Word can revive them.
  const companions = run.party.map((slot) => {
    const c = makeCombatant(heroById(slot.id));
    c.hp.max = slot.hp.max;
    c.hp.current = slot.hp.current;
    applyEquipment(c, slot.id);
    return c;
  });
  const monsters = encounter.monsterIds.map((id) => makeCombatant(monsterById(id)));
  const { combat, events } = createCombat([dragon, ...companions], monsters, liveRNG, encounter.bossName ?? null);
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

export function cast(spellId, targetId = null) {
  resolvePlayerAction((combat) => playerSpell(combat, spellId, targetId, liveRNG));
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

/** Fold a character's equipped item mods into its combatant. */
function applyEquipment(c, charKey) {
  const toHit = equipmentMod(charKey, 'toHit');
  const damage = equipmentMod(charKey, 'damage');
  c.ac += equipmentMod(charKey, 'ac');
  for (const attack of c.attacks) {
    attack.toHit += toHit;
    attack.damage = bumpDamage(attack.damage, damage);
  }
}

function syncDragonHp() {
  const run = state.run;
  const combat = run.combat?.combat;
  if (!combat) return;
  for (const hero of heroesOf(combat)) {
    if (hero.kind === 'dragon') {
      run.dragon.hp.current = hero.hp.current;
    } else {
      const slot = run.party.find((p) => p.id === hero.templateId);
      if (slot) slot.hp.current = hero.hp.current;
    }
  }
}

function finishCombat(events) {
  const run = state.run;
  const combat = run.combat.combat;
  if (combat.winner === 'heroes') {
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
