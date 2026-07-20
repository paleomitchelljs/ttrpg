// Single source of truth plus every state transition. Views subscribe and
// re-render on change; they never mutate state directly. All world
// generation is seeded; all combat dice are live.

import { generateDungeon } from '../world/maze.js';
import { buildZoneDungeon } from '../world/zones.js';
import { rollEncounter } from '../world/encounters.js';
import { zoneById } from '../../data/zones.js';
import { tierByName } from '../../data/dragonProgression.js';
import { monsterById } from '../../data/monsters.js';
import { COMPANIONS, companionById } from '../../data/party.js';
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
  playerParley,
  isPlayerTurn,
  heroesOf,
} from '../engine/combat.js';
import {
  endOfRunBonus,
  tierAfterBanking,
  victoryDropChance,
  levelForXp,
  FACTION_ENEMIES,
  parleyDC,
  dispositionLabel,
} from '../engine/rules.js';
import { liveRNG } from '../engine/rng.js';
import { loadSave, persist, clearSave } from './save.js';

function freshMeta() {
  return {
    hoardGold: 0,
    tier: 'wyrmling',
    runsCompleted: 0,
    party: ['spawnee', 'dragonkin-spellblade'],
    mode: 'dragon', // 'dragon' = dragon + party; 'party' = the party alone
    heroGrowth: {}, // charId -> { xp, level, pending, choices: [{type, spellId?}] }
    reputation: {}, // faction -> renown (kills of their enemies raise it)
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
  meta.party ??= ['spawnee', 'dragonkin-spellblade'];
  meta.mode ??= 'dragon';
  meta.heroGrowth ??= {};
  meta.reputation ??= {};
  meta.zone ??= null;
  meta.familiar ??= null;
  meta.familiarsOwned ??= [];
  meta.tomeSpells ??= [];
  meta.inventory ??= [];
  meta.equipment ??= {};
  meta.customCharacters ??= [];
  if (meta.familiar && !meta.familiarsOwned.includes(meta.familiar)) meta.familiar = null;
  meta.inventory = meta.inventory.filter((id) => itemById(id));
  for (const slots of Object.values(meta.equipment)) {
    for (const [slot, id] of Object.entries(slots)) {
      if (!itemById(id)) delete slots[slot];
    }
  }
  return meta;
}

/** Look up a hero template: built-in companion or imported character. */
function heroById(id) {
  return companionById(id) ?? state.meta.customCharacters.find((c) => c.id === id) ?? null;
}

/** Growth record for a hero (created on demand). */
function growthFor(id) {
  state.meta.heroGrowth[id] ??= { xp: 0, level: 1, pending: 0, choices: [] };
  return state.meta.heroGrowth[id];
}

/** A hero template with every chosen advance folded in. */
export function heroWithGrowth(id) {
  const base = heroById(id);
  if (!base) return null;
  const g = state.meta.heroGrowth[id];
  if (!g || !g.choices.length) return base;
  const hero = {
    ...base,
    abilities: { ...base.abilities },
    attacks: base.attacks.map((a) => ({ ...a })),
    spells: [...base.spells],
  };
  for (const choice of g.choices) {
    if (choice.type === 'hp') hero.hpMax += 2;
    if (choice.type === 'ac') hero.ac += 1;
    if (choice.type === 'attack') hero.attacks.forEach((a) => (a.toHit += 1));
    if (choice.type === 'spell' && choice.spellId && !hero.spells.includes(choice.spellId)) {
      hero.spells.push(choice.spellId);
    }
  }
  return hero;
}

/** Spend a pending level-up on an advance. */
export function chooseAdvance(charId, type, spellId = null) {
  const g = growthFor(charId);
  if (g.pending <= 0) return;
  if (!['hp', 'ac', 'attack', 'spell'].includes(type)) return;
  if (type === 'spell') {
    const spell = SPELLS.find((sp) => sp.id === spellId && sp.tome !== false);
    const known = heroWithGrowth(charId)?.spells ?? [];
    if (!spell || known.includes(spellId)) return;
  }
  g.choices.push(type === 'spell' ? { type, spellId } : { type });
  g.pending -= 1;
  // an HP advance helps immediately if this hero is mid-run
  if (type === 'hp') {
    const slot = state.run?.party.find((pm) => pm.id === charId);
    if (slot) {
      slot.hp.max += 2;
      slot.hp.current += 2;
    }
  }
  persist(state);
  emit([{ type: 'advance-chosen', charId }]);
}

/** Delve as the dragon with its party, or as the party alone. */
export function setMode(mode) {
  state.meta.mode = mode === 'party' ? 'party' : 'dragon';
  persist(state);
  emit([{ type: 'mode-changed' }]);
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
  const { party, zone, mode } = state.meta;
  state.meta = freshMeta();
  if (party) state.meta.party = party;
  state.meta.zone = zone ?? null;
  state.meta.mode = mode ?? 'dragon';
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

/** Most companions that may join the dragon on one delve. */
export const PARTY_CAP = 4;

/** Every recruitable companion: the built-ins plus imported portal heroes. */
export function allCompanions() {
  return [...COMPANIONS, ...state.meta.customCharacters];
}

/** Toggle one companion in/out of the party, honoring the cap. */
export function toggleCompanion(id) {
  if (!heroById(id)) return;
  const party = state.meta.party ?? [];
  if (party.includes(id)) {
    state.meta.party = party.filter((p) => p !== id);
  } else if (party.length < PARTY_CAP) {
    state.meta.party = [...party, id];
  }
  persist(state);
  emit([{ type: 'party-changed' }]);
}

/** Choose which companions join the next labyrinth. */
export function setParty(companionIds) {
  state.meta.party = companionIds.filter((id) => heroById(id)).slice(0, PARTY_CAP);
  persist(state);
  emit([{ type: 'party-changed' }]);
}

export function enterLabyrinth(seed) {
  const depth = state.meta.runsCompleted + 1;
  const tier = tierByName(state.meta.tier);
  const partyIds = (state.meta.party ?? []).filter((id) => heroById(id));
  const zonePick = state.meta.zone;
  const dungeon = zonePick
    ? buildZoneDungeon(zonePick.zoneId, 0, seed, 1 + partyIds.length)
    : generateDungeon(seed, depth, 1 + partyIds.length);
  // The party can delve alone, on the dragon's behalf — but never empty.
  const partyMode = state.meta.mode === 'party' && partyIds.length > 0;
  const dragonMax = tier.hpMax + equipmentMod('dragon', 'hpMax');
  state.run = {
    dragon: partyMode ? null : { tier: tier.tier, hp: { current: dragonMax, max: dragonMax } },
    party: partyIds.map((id) => {
      const c = heroWithGrowth(id);
      const max = c.hpMax + equipmentMod(id, 'hpMax');
      return { id, hp: { current: max, max } };
    }),
    unbankedGold: 0,
    dungeon,
    playerPos: { ...dungeon.start },
    explored: {},
    phase: 'explore', // 'explore' | 'combat' | 'won' | 'defeat'
    combat: null,
    encountersCleared: 0,
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

  // Doors sit ON the wall: walk INTO one to travel or bank — you never stand
  // on it. Checked before the wall block below.
  const door = d.doors?.find((dr) => dr.x === x && dr.y === y);
  if (door) {
    const events = [];
    if (door.to === 'surface') bankAndWin(events);
    else travelThrough(door, events);
    return;
  }

  if (d.tiles[y][x] !== 1) return; // wall

  // Bump-to-fight: stepping at a monster tile starts combat; the party
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
        run.unbankedGold += 15;
        events.push({ type: 'loot', label: 'an empty den (15 gold under the bedding)', gold: 15 });
      }
    } else if (loot.tome) {
      const unknown = SPELLS.filter((sp) => sp.tome !== false && !state.meta.tomeSpells.includes(sp.id));
      if (unknown.length) {
        const learned = unknown[Math.floor(liveRNG() * unknown.length)];
        state.meta.tomeSpells.push(learned.id);
        events.push({ type: 'tome', spell: learned.name });
      } else {
        run.unbankedGold += 25;
        events.push({ type: 'tome', spell: null, gold: 25 });
      }
    } else {
      let gold = loot.gold;
      if (state.meta.familiar === 'pack-rat') gold = Math.round(gold * 1.25);
      run.unbankedGold += gold;
      events.push({ type: 'loot', label: loot.label, icon: loot.icon, gold });
    }
  }

  persist(state);
  emit(events);
}

/** Walk through a door into another subregion of the same zone. The run
 * continues (gold, HP, spent spells carry over). Persistent placement: you
 * arrive at the paired return door's inner tile — entering from the matching
 * edge — or at the region's start if the door is one-way (e.g. a drop). */
function travelThrough(originDoor, events) {
  const run = state.run;
  const zone = zoneById(run.dungeon.zone?.id);
  if (!zone) return;
  const fromSub = run.dungeon.subId;
  const idx = zone.subregions.findIndex((sr) => sr.id === originDoor.to);
  if (idx < 0) return;
  const dungeon = buildZoneDungeon(zone.id, idx, run.dungeon.seed, 1 + run.party.length);
  run.dungeon = dungeon;
  const back = dungeon.doors.find((dd) => dd.to === fromSub);
  run.playerPos = back ? { ...back.entry } : { ...dungeon.start };
  run.explored = {};
  reveal(run);
  persist(state);
  events.push({ type: 'traveled', zone: dungeon.zone });
  emit(events);
}

/** Roll a wandering pack for an ambush at the party's current spot. */
function rollAmbushIds(run) {
  const d = run.dungeon;
  if (d.zone) {
    const zone = zoneById(d.zone.id);
    const sub = zone?.subregions.find((s) => s.id === d.subId);
    const pool = sub?.table ?? [];
    if (pool.length) {
      const total = pool.reduce((a, t) => a + t.weight, 0);
      let r = liveRNG() * total;
      let chosen = pool[pool.length - 1];
      for (const t of pool) {
        r -= t.weight;
        if (r < 0) { chosen = t; break; }
      }
      const n = 1 + Math.floor(liveRNG() * (chosen.packMax ?? 1));
      return Array(Math.min(n, 3)).fill(chosen.id);
    }
  }
  return rollEncounter(d.depth, liveRNG, 1 + run.party.length);
}

/**
 * Make camp between fights. Heroes recover about half their missing HP — but
 * resting in a dungeon is risky (Shadowdark), and a wandering pack may fall on
 * you before the fire burns down. Risk climbs with the depth.
 */
export function rest() {
  const run = state.run;
  if (!run || run.phase !== 'explore') return;
  const mend = (hp) => {
    hp.current = Math.min(hp.max, hp.current + Math.ceil((hp.max - hp.current) / 2) + Math.ceil(hp.max * 0.1));
  };
  if (run.dragon) mend(run.dragon.hp);
  for (const slot of run.party) mend(slot.hp);

  const risk = Math.min(0.55, 0.15 + run.dungeon.depth * 0.06);
  if (liveRNG() < risk) {
    emit([{ type: 'rested', ambush: true }]);
    beginCombat({
      id: 'ambush',
      x: run.playerPos.x,
      y: run.playerPos.y,
      monsterIds: rollAmbushIds(run),
    });
    return;
  }
  persist(state);
  emit([{ type: 'rested', ambush: false }]);
}

export function moveTo(x, y) {
  const dx = x - state.run?.playerPos.x;
  const dy = y - state.run?.playerPos.y;
  if (Math.abs(dx) + Math.abs(dy) === 1) move(dx, dy);
}

function bankAndWin(events) {
  const run = state.run;
  // In zones, the surface door sits by the entrance: no free exit bonus
  // for stepping in and straight back out.
  const earned = !run.dungeon.zone || (run.encountersCleared ?? 0) > 0;
  const bonus = earned ? endOfRunBonus(run.dungeon.depth) : 0;
  const banked = run.unbankedGold + bonus;
  state.meta.hoardGold += banked;
  state.meta.runsCompleted += 1;
  // Gold is XP: everyone on the delve grows by what was banked.
  for (const slot of run.party) {
    const g = growthFor(slot.id);
    g.xp += banked;
    const newLevel = levelForXp(g.xp);
    if (newLevel > g.level) {
      g.pending += newLevel - g.level;
      g.level = newLevel;
      events.push({ type: 'level-up', charId: slot.id, who: heroById(slot.id)?.name ?? slot.id, level: newLevel });
    }
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
  let heroes = [];
  if (run.dragon) {
    const tier = tierByName(run.dragon.tier);
    const dragon = makeDragonCombatant(tier, run.dragon.hp.current, {
      spells: state.meta.tomeSpells,
      familiar: state.meta.familiar,
    });
    dragon.hp.max = run.dragon.hp.max;
    dragon.hp.current = Math.min(run.dragon.hp.current, dragon.hp.max);
    applyEquipment(dragon, 'dragon');
    heroes.push(dragon);
  }
  // Downed companions come along at 0 HP — a Healing Word can revive them.
  for (const slot of run.party) {
    const c = makeCombatant(heroWithGrowth(slot.id));
    c.hp.max = slot.hp.max;
    c.hp.current = slot.hp.current;
    applyEquipment(c, slot.id);
    heroes.push(c);
  }
  const monsters = encounter.monsterIds.map((id) => makeCombatant(monsterById(id)));
  const { combat, events } = createCombat(heroes, monsters, liveRNG, encounter.bossName ?? null);
  // Can this pack be talked to? Mindless things can't; hated parties are
  // refused outright.
  const lead = monsterById(encounter.monsterIds[0]);
  const rep = state.meta.reputation[lead?.faction] ?? 0;
  const willing = lead?.parley && lead.parley !== 'never' && monsters.every((m) => {
    const t = monsterById(m.templateId);
    return t?.parley && t.parley !== 'never';
  });
  combat.parleyInfo = willing && rep > -10
    ? {
        faction: lead.faction,
        disposition: dispositionLabel(rep),
        dc: parleyDC(lead.parley, rep),
        barterCost: Math.ceil(monsters.reduce((sum, m) => sum + (m.goldValue ?? 0), 0) / 2),
      }
    : null;
  if (combat.parleyInfo) combat.parleyInfo.canBarter = run.unbankedGold >= combat.parleyInfo.barterCost;
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

/** Talk instead of fight: 'threaten' | 'persuade' | 'barter' | 'work'. */
export function parley(mode) {
  const run = state.run;
  const combat = run?.combat?.combat;
  const info = combat?.parleyInfo;
  if (!info) return;
  if (mode === 'barter' && run.unbankedGold < info.barterCost) return;
  resolvePlayerAction((c) => {
    const events = playerParley(c, mode, info.dc, liveRNG);
    const succeeded = events.some((e) => e.type === 'parley' && e.success);
    if (succeeded) {
      if (mode === 'barter') {
        run.unbankedGold -= info.barterCost;
        events.push({ type: 'parley-paid', cost: info.barterCost });
      }
      if (mode === 'work') {
        const boss = run.dungeon.encounters.find((e) => e.id.startsWith('boss'));
        if (boss) {
          const reward = 15 + run.dungeon.depth * 10;
          run.quest = { encId: boss.id, name: boss.bossName, reward, from: info.faction };
          events.push({ type: 'quest-received', target: boss.bossName, reward });
        }
      }
      if (mode !== 'threaten') {
        state.meta.reputation[info.faction] = (state.meta.reputation[info.faction] ?? 0) + 1;
      }
    }
    return events;
  });
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
  c.initBonus = equipmentMod(charKey, 'init');
  for (const item of equippedItems(charKey)) {
    if (item.bane) c.bane = item.bane;
  }
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
      if (run.dragon) run.dragon.hp.current = hero.hp.current;
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
    const slain = combat.order.filter((c) => c.kind === 'monster' && c.hp.current <= 0);
    run.unbankedGold += slain.reduce((sum, m) => sum + (m.goldValue ?? 0), 0);
    // Renown: every faction remembers who kills its own — and its enemies.
    for (const m of slain) {
      const t = monsterById(m.templateId);
      if (!t?.faction) continue;
      state.meta.reputation[t.faction] = (state.meta.reputation[t.faction] ?? 0) - 1;
      for (const friend of Object.keys(FACTION_ENEMIES)) {
        if (FACTION_ENEMIES[friend]?.includes(t.faction)) {
          state.meta.reputation[friend] = (state.meta.reputation[friend] ?? 0) + 1;
        }
      }
    }
    const idx = run.dungeon.encounters.findIndex((e) => e.id === run.combat.encounterId);
    let bossName = null;
    let bossDrops = null;
    if (idx >= 0) {
      const enc = run.dungeon.encounters[idx];
      bossName = enc.bossName ?? null;
      bossDrops = enc.bossDrops ?? null;
      run.dungeon.encounters.splice(idx, 1);
      run.playerPos = { x: enc.x, y: enc.y };
      reveal(run);
    }
    // A promised bounty pays out when its target falls.
    if (run.quest && run.quest.encId === run.combat.encounterId) {
      run.unbankedGold += run.quest.reward;
      events.push({ type: 'quest-complete', target: run.quest.name, reward: run.quest.reward, from: run.quest.from });
      state.meta.reputation[run.quest.from] = (state.meta.reputation[run.quest.from] ?? 0) + 2;
      run.quest = null;
    }

    // Magic items come ONLY from named bosses (and quests): first from the
    // boss's own hoard list, then the dungeon's wider treasure pool.
    if (slain.length && bossName) {
      const owned = state.meta.inventory;
      const preferred = (bossDrops ?? []).filter((id) => !owned.includes(id));
      const zoneId = run.dungeon.zone?.id ?? null;
      const pool = preferred.length
        ? preferred.map(itemById).filter(Boolean)
        : ITEMS.filter((i) => i.zone === zoneId && !owned.includes(i.id));
      if (pool.length && liveRNG() < victoryDropChance(true)) {
        const found = pool[Math.floor(liveRNG() * pool.length)];
        state.meta.inventory.push(found.id);
        events.push({ type: 'item-drop', name: found.name, blurb: found.blurb });
      }
    }
    run.encountersCleared = (run.encountersCleared ?? 0) + 1;
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
