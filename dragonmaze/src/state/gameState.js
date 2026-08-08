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
import { familiarById } from '../../data/familiars.js';
import { ITEMS, itemById } from '../../data/items.js';
import { consumableById } from '../../data/consumables.js';
import { parseHeroExport } from './importHero.js';
import { bumpDamage, resolveParleyCheck, canLearnSpell } from '../engine/rules.js';
import { SPELLS } from '../../data/spells.js';
import { talentById, meetsRequires } from '../../data/talents.js';
import { makeCombatant, makeDragonCombatant } from '../engine/entities.js';
import {
  createCombat,
  runAiTurns,
  playerAttack,
  playerBreath,
  playerSpell,
  playerSweep,
  playerIntimidate,
  playerUseItem,
  spendLuck as luckReroll,
  declineLuck as luckDecline,
  isPlayerTurn,
  heroesOf,
} from '../engine/combat.js';
import {
  endOfRunBonus,
  tierAfterBanking,
  victoryDropChance,
  HARVEST_CHANCE,
  levelForXp,
  hpPerLevel,
  rollHpGain,
  XP_FOR,
  asiEarned,
  talentEarned,
  ABILITY_CAP,
  FACTION_ENEMIES,
  parleyDC,
  dispositionLabel,
  clampRep,
} from '../engine/rules.js';

// Faction standing runs -10..+10; nudge it and clamp.
function bumpRep(faction, delta) {
  if (!faction) return;
  state.meta.reputation[faction] = clampRep((state.meta.reputation[faction] ?? 0) + delta);
}
import { liveRNG } from '../engine/rng.js';
import { loadSave, persist, clearSave, exportJSON, importJSON } from './save.js';

function freshMeta() {
  return {
    hoardGold: 0,
    tier: 'wyrmling',
    runsCompleted: 0,
    party: ['spawnee', 'dragonkin-spellblade'],
    mode: 'dragon', // 'dragon' = dragon joins the party; 'party' = party alone
    heroGrowth: {}, // charId -> { xp, level, pending, choices: [{type, spellId?}] }
    reputation: {}, // faction -> renown (kills of their enemies raise it)
    zone: { zoneId: 'lost-temple', subIndex: 0 }, // default hunt; null = procedural
    tomeSpells: [], // spells the dragon has learned from found tomes
    inventory: [], // equippable items found in gleaming caches
    consumables: ['potion-healing', 'potion-healing', 'vial-poison'], // shared pouch of one-shot combat items
    equipment: {}, // charKey -> { weapon, armor, trinket }
    customCharacters: [], // heroes imported from the portal's generator
    defeatedBosses: [], // stable boss keys (zone:sub:role) that stay dead
    flags: {}, // persistent world-state flags for quest progress
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

// A light source (the lantern-beetle familiar) or a party member with
// darkvision (Spawnee, the Yuan-Ti) widens sight: a full 3x3 lit, plus the ring
// two tiles out glimpsed dimly. Without light it's the bare plus. No light
// *spell* exists yet — add it here when one does.
// True if any hero in the party keeps the given familiar (familiars are per-hero
// now, but some knacks — light, gold-sense — help the whole party).
function partyHasFamiliar(run, familiarId) {
  return (run?.party ?? []).some((s) => heroWithGrowth(s.id)?.familiar === familiarId);
}
function hasLight(run) {
  return partyHasFamiliar(run, 'lantern-beetle')
    || (run.party ?? []).some((s) => companionById(s.id)?.darkvision);
}

function reveal(run) {
  const { x, y } = run.playerPos;
  const { width: W, height: H } = run.dungeon;
  run.dimSeen ??= {};
  const inb = (tx, ty) => tx >= 0 && tx < W && ty >= 0 && ty < H;
  const lit = hasLight(run);
  // Fully lit (permanent): the plus, filled to a 3x3 when a light is up.
  const clear = [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]];
  if (lit) clear.push([-1, -1], [1, -1], [-1, 1], [1, 1]);
  for (const [dx, dy] of clear) if (inb(x + dx, y + dy)) run.explored[key(x + dx, y + dy)] = true;
  // Partially seen: the ring at distance 2, only under light, never overriding
  // a cleared tile.
  if (lit) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
      if (inb(x + dx, y + dy) && !run.explored[key(x + dx, y + dy)]) run.dimSeen[key(x + dx, y + dy)] = true;
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
  delete meta.familiarsOwned; // legacy: familiars are no longer found/owned
  delete meta.familiar; // legacy: familiars are now per-hero (in heroGrowth choices)
  meta.tomeSpells ??= []; // legacy: the dragon's old spellbook (dragons no longer cast)
  meta.heroTomes ??= {}; // charId -> [spellId] spells a caster learned from found tomes
  meta.inventory ??= [];
  meta.consumables ??= [];
  meta.equipment ??= {};
  meta.customCharacters ??= [];
  meta.defeatedBosses ??= [];
  meta.flags ??= {};
  meta.inventory = meta.inventory.filter((id) => itemById(id));
  meta.consumables = meta.consumables.filter((id) => consumableById(id));
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

/**
 * HP a hero has gained from levelling. Every level past the first is a stored
 * roll (see grantTreasureXp); saves that levelled before HP was rolled have no
 * rolls, so those levels fall back to the smooth average and their HP is
 * unchanged by the switch.
 */
function levelHpTotal(g, hero) {
  const rolls = g?.hpRolls ?? [];
  const levels = Math.max(0, (g?.level ?? 1) - 1);
  let total = 0;
  for (let i = 0; i < levels; i++) total += rolls[i] ?? hpPerLevel(hero);
  return total;
}

/** A hero template with every chosen advance folded in. */
export function heroWithGrowth(id) {
  const base = heroById(id);
  if (!base) return null;
  const g = state.meta.heroGrowth[id];
  const level = g?.level ?? 1;
  const tomes = state.meta.heroTomes?.[id] ?? [];
  const choices = g?.choices ?? [];
  // Nothing to fold — a fresh level-1 hero with no learned tomes: hand back the
  // shared base object untouched. A hero who *starts* with talents (Beren's
  // sword line) still has to go through the fold, or their Focus/Master would
  // sit in the list doing nothing until their first level-up.
  if ((!g || (level <= 1 && !choices.length)) && !tomes.length && !base.talents?.length) return base;
  const hero = {
    ...base,
    abilities: { ...base.abilities },
    attacks: base.attacks.map((a) => ({ ...a })),
    spells: [...base.spells],
    talents: [...(base.talents ?? [])],
    spellPower: base.spellPower ?? 0,
  };

  // Ability score increases (even levels), capped at +5 (score 20). STR gives
  // hit + damage, DEX gives hit + AC; CON feeds HP/level; the rest raise
  // abilities the engine already reads (casting, parley, intimidate).
  const asi = {};
  for (const c of choices) if (c.type === 'asi' && c.ability) asi[c.ability] = (asi[c.ability] ?? 0) + 1;
  let strGain = 0;
  let dexGain = 0;
  for (const ab of Object.keys(asi)) {
    const capped = Math.min(ABILITY_CAP, (base.abilities[ab] ?? 0) + asi[ab]);
    const delta = capped - (base.abilities[ab] ?? 0);
    hero.abilities[ab] = capped;
    if (ab === 'str') strGain = delta;
    if (ab === 'dex') dexGain = delta;
  }
  // Shadowdark: a higher STR/DEX sharpens the attack roll, but weapon damage is
  // the die alone — raising a stat never pads damage. Each attack knows which
  // arm swings it (`stat`, set by attackFor — finesse weapons ride DEX), so
  // only that stat's increase counts. Imported heroes predating `stat` take
  // both, as they always did.
  hero.attacks.forEach((a) => {
    a.toHit += a.stat === 'dex' ? dexGain : a.stat === 'str' ? strGain : strGain + dexGain;
  });
  hero.ac += dexGain;

  // Automatic toughness: every level past 1st adds class + (grown) CON HP.
  hero.hpMax += levelHpTotal(g, hero);

  // Talents (odd levels) and learned spells.
  for (const c of choices) {
    if (c.type === 'talent' && c.talentId) {
      if (c.talentId === 'armor') hero.ac += 1; // repeatable defensive pick
      else if (!hero.talents.includes(c.talentId)) hero.talents.push(c.talentId);
    }
    if (c.type === 'spell' && c.spellId && !hero.spells.includes(c.spellId)) hero.spells.push(c.spellId);
    if (c.type === 'familiar' && familiarById(c.familiarId)) hero.familiar = c.familiarId; // this hero's own familiar
    // Legacy picks from earlier systems (no longer offered, kept for old saves).
    if (c.type === 'attack') hero.attacks.forEach((a) => (a.toHit += 1));
    if (c.type === 'damage') hero.attacks.forEach((a) => (a.damage = bumpDamage(a.damage, 1)));
    if (c.type === 'spellpower') hero.spellPower += 1;
    if (c.type === 'hp') hero.hpMax += 2;
    if (c.type === 'ac') hero.ac += 1;
  }
  // Weapon Focus / Weapon Master sharpen only the weapon type they name — the
  // flat, Shadowdark-sized talents the showier ones are gated behind.
  for (const tid of hero.talents) {
    const t = talentById(tid);
    if (!t?.weaponType) continue;
    for (const a of hero.attacks) {
      if (a.type !== t.weaponType) continue;
      if (tid.startsWith('wf-')) a.toHit += 1;
      else if (tid.startsWith('wm-')) a.damage = bumpDamage(a.damage, 1);
    }
  }

  // Spells learned from found tomes (a caster studies them — no talent slot).
  for (const sid of tomes) if (!hero.spells.includes(sid)) hero.spells.push(sid);
  return hero;
}

/** Unspent advances, derived from level and past choices (spells share the
 *  talent slot). */
export function pendingAdvances(id) {
  const g = state.meta.heroGrowth?.[id];
  if (!g) return { asi: 0, talent: 0, total: 0 };
  const asiChosen = g.choices.filter((c) => c.type === 'asi').length;
  const talentChosen = g.choices.filter((c) => c.type === 'talent' || c.type === 'spell' || c.type === 'familiar').length;
  const asi = Math.max(0, asiEarned(g.level) - asiChosen);
  const talent = Math.max(0, talentEarned(g.level) - talentChosen);
  return { asi, talent, total: asi + talent };
}

/** Spend a pending advance. `arg` is the ability (ASI), talentId, or spellId. */
export function chooseAdvance(charId, type, arg = null) {
  const g = growthFor(charId);
  const pend = pendingAdvances(charId);
  if (type === 'asi') {
    if (pend.asi <= 0) return;
    if (!['str', 'dex', 'con', 'int', 'wis', 'cha'].includes(arg)) return;
    if ((heroWithGrowth(charId)?.abilities?.[arg] ?? 0) >= ABILITY_CAP) return; // 20 cap
    g.choices.push({ type: 'asi', ability: arg });
  } else if (type === 'talent') {
    if (pend.talent <= 0) return;
    const t = talentById(arg);
    if (!t) return;
    if (t.caster && !heroById(charId)?.castStat) return;
    // Talents a hero started with count as taken, both ways: they can't be
    // picked a second time, and they satisfy the prerequisites of what sits
    // above them in the tree.
    const taken = [
      ...(heroById(charId)?.talents ?? []),
      ...g.choices.filter((c) => c.type === 'talent').map((c) => c.talentId),
    ];
    if (!t.repeatable && taken.includes(arg)) return;
    // The showy talents sit behind a short tree (see data/talents.js).
    if (!meetsRequires(t, taken)) return;
    g.choices.push({ type: 'talent', talentId: arg });
  } else if (type === 'spell') {
    if (pend.talent <= 0) return; // learning a spell spends a talent slot
    const spell = SPELLS.find((sp) => sp.id === arg && sp.tome !== false);
    if (!spell || (heroWithGrowth(charId)?.spells ?? []).includes(arg)) return;
    if (!canLearnSpell(g.level, spell)) return; // a tier this caster hasn't reached
    g.choices.push({ type: 'spell', spellId: arg });
  } else if (type === 'familiar') {
    if (pend.talent <= 0) return; // taking a familiar spends a talent slot
    if (!familiarById(arg)) return;
    if (g.choices.some((c) => c.type === 'familiar')) return; // one familiar per hero
    g.choices.push({ type: 'familiar', familiarId: arg }); // this hero's own familiar
  } else {
    return;
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

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

/** Max-HP an item grants: hpMax outright, plus what its CON bonus is worth. */
function equipmentHp(charKey) {
  return equipmentMod(charKey, 'hpMax') + equipmentMod(charKey, 'con');
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

/** The whole save as a portable string (persistent meta + an in-progress
 *  delve). Paste it back via importSave to move a game between devices. */
export function exportSave() {
  return exportJSON(state);
}

/** Load a pasted/exported save string. Returns true on success. */
export function importSave(raw) {
  let data = null;
  try { data = importJSON(raw); } catch { return false; }
  if (!data || !data.meta || typeof data.meta.hoardGold !== 'number') return false;
  state.meta = normalizeMeta(data.meta);
  state.run = data.run && data.run.phase === 'explore' ? { ...data.run, combat: null } : null;
  state.hasSave = true;
  state.screen = 'title';
  persist(state);
  emit([{ type: 'imported' }]);
  return true;
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

// Bosses already beaten stay beaten: strip their encounters from a freshly
// built dungeon (keyed by the stable bossKey). Procedural mazes have no keys,
// so this is a no-op there.
function pruneDefeated(dungeon) {
  const dead = new Set(state.meta.defeatedBosses ?? []);
  if (dead.size) dungeon.encounters = dungeon.encounters.filter((e) => !(e.bossKey && dead.has(e.bossKey)));
  return dungeon;
}

// ---------------------------------------------------------------- world flags
// Persistent, exported-with-the-save booleans/values for quest progress. Set
// them from quest completion or scripted events; read them anywhere to change
// the world.
export function getFlag(name) {
  return state.meta.flags?.[name];
}
export function setFlag(name, value = true) {
  state.meta.flags ??= {};
  state.meta.flags[name] = value;
  persist(state);
  emit([{ type: 'flag-set', name, value }]);
}

// EXTENSION POINT: quest flags can weaken a specific boss right before its fight
// (called from beginCombat with the boss's freshly-built combatants + its
// encounter, whose `bossKey` identifies it). No rules are wired yet — add them
// here, e.g.:
//   if (encounter.bossKey === 'lost-temple:summoning-chamber:boss'
//       && getFlag('sealed-the-rift')) {
//     for (const m of monsters) { m.hp.max = Math.round(m.hp.max * 0.7); m.hp.current = m.hp.max; m.ability = null; }
//   }
function applyWorldFlags(monsters, encounter) {
  void monsters; void encounter; // no world rules wired yet
}

export function enterLabyrinth(seed) {
  const depth = state.meta.runsCompleted + 1;
  const tier = tierByName(state.meta.tier);
  const partyIds = (state.meta.party ?? []).filter((id) => heroById(id));
  const zonePick = state.meta.zone;
  const dungeon = pruneDefeated(zonePick
    ? buildZoneDungeon(zonePick.zoneId, 0, seed, 1 + partyIds.length)
    : generateDungeon(seed, depth, 1 + partyIds.length));
  // The party can delve alone, on the dragon's behalf — but never empty.
  const partyMode = state.meta.mode === 'party' && partyIds.length > 0;
  const dragonMax = tier.hpMax + equipmentHp('dragon');
  state.run = {
    dragon: partyMode ? null : { tier: tier.tier, hp: { current: dragonMax, max: dragonMax } },
    party: partyIds.map((id) => {
      const c = heroWithGrowth(id);
      const max = c.hpMax + equipmentHp(id);
      return { id, hp: { current: max, max } };
    }),
    unbankedGold: 0,
    dungeon,
    playerPos: { ...dungeon.start },
    explored: {},
    dimSeen: {},
    phase: 'explore', // 'explore' | 'combat' | 'won' | 'defeat'
    combat: null,
    encountersCleared: 0,
    lastResult: null,
    burnedSpells: {}, // casterKey -> [spellId] fizzled spells, lost until camp (Shadowdark)
    luck: Object.fromEntries(partyIds.map((id) => [id, 1])), // 1 luck token/day per hero (not the dragon)
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

// ---------------------------------------------------------------- enemy AI
// Patrollers (the golems) pace a short beat around their post and give chase
// when the party strays within sight — one tile per player step.
const DETECT_RADIUS = 3;
const PATROL_LEASH = 3;

const isFloor = (d, x, y) => x >= 0 && x < d.width && y >= 0 && y < d.height && d.tiles[y][x] === 1 && !d.blocked?.has(`${x},${y}`);
const occupiedBy = (d, x, y, self) => d.encounters.some((e) => e !== self && e.x === x && e.y === y);
const openLen = (d, enc, sx, sy) => {
  let n = 0, x = enc.x + sx, y = enc.y + sy;
  while (isFloor(d, x, y) && n < PATROL_LEASH) { n++; x += sx; y += sy; }
  return n;
};

// Clear line of sight: every tile the ray crosses (bar the endpoints) is floor.
function lineOfSight(d, x0, y0, x1, y1) {
  const adx = Math.abs(x1 - x0), ady = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = adx - ady, x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    const e2 = 2 * err;
    if (e2 > -ady) { err -= ady; x += sx; }
    if (e2 < adx) { err += adx; y += sy; }
    if ((x !== x1 || y !== y1) && !isFloor(d, x, y)) return false;
  }
  return true;
}

// One greedy step toward (tx,ty), preferring the longer axis.
function stepToward(enc, tx, ty, d) {
  const dx = Math.sign(tx - enc.x), dy = Math.sign(ty - enc.y);
  const tries = Math.abs(tx - enc.x) >= Math.abs(ty - enc.y) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  for (const [sx, sy] of tries) {
    if (!sx && !sy) continue;
    const nx = enc.x + sx, ny = enc.y + sy;
    if (isFloor(d, nx, ny) && !occupiedBy(d, nx, ny, enc)) { enc.x = nx; enc.y = ny; return; }
  }
}

// Pace back and forth along the roomier axis, within a short leash of home.
function patrolPace(enc, d) {
  if (!enc.patrolAxis) {
    enc.patrolAxis = openLen(d, enc, 1, 0) + openLen(d, enc, -1, 0) >= openLen(d, enc, 0, 1) + openLen(d, enc, 0, -1) ? 'x' : 'y';
    enc.patrolDir = 1;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const [sx, sy] = enc.patrolAxis === 'x' ? [enc.patrolDir, 0] : [0, enc.patrolDir];
    const nx = enc.x + sx, ny = enc.y + sy;
    const leashed = Math.abs(nx - enc.home.x) <= PATROL_LEASH && Math.abs(ny - enc.home.y) <= PATROL_LEASH;
    if (leashed && isFloor(d, nx, ny) && !occupiedBy(d, nx, ny, enc)) { enc.x = nx; enc.y = ny; return; }
    enc.patrolDir *= -1; // hit a wall or the leash — turn around
  }
}

// Move every patroller/fleer one step. Returns an encounter that needs to fight
// the party (a golem that reached them, or the thief cornered), or null. Pushes
// a 'robbed' event if the fleeing thief made it to a door.
function tickEnemies(run, events) {
  const d = run.dungeon;
  const { x: px, y: py } = run.playerPos;
  // A cornered thief (party on or beside him) is caught before he can bolt —
  // parley, then a fight if it fails.
  const thief = d.encounters.find((e) => e.flee);
  if (thief && Math.max(Math.abs(thief.x - px), Math.abs(thief.y - py)) <= 1) {
    thief.flee = false;
    return thief;
  }
  // Everyone else steps: patrollers chase or pace, the thief runs for his door.
  for (const enc of d.encounters) {
    if (enc.flee) { stepToward(enc, enc.target.x, enc.target.y, d); continue; }
    if (!enc.patrol) continue;
    enc.home ??= { x: enc.x, y: enc.y };
    const cheb = Math.max(Math.abs(enc.x - px), Math.abs(enc.y - py));
    if (cheb > 0 && cheb <= DETECT_RADIUS && lineOfSight(d, enc.x, enc.y, px, py)) stepToward(enc, px, py, d);
    else patrolPace(enc, d);
  }
  // A thief who reached his door is gone with the cut.
  if (thief && thief.x === thief.target.x && thief.y === thief.target.y) {
    run.unbankedGold = Math.max(0, run.unbankedGold - thief.steal);
    d.encounters.splice(d.encounters.indexOf(thief), 1);
    events.push({ type: 'robbed', gold: thief.steal, escaped: true });
  }
  return d.encounters.find((e) => e.patrol && e.x === px && e.y === py) ?? null;
}

// ------------------------------------------------ the camp thief
const bestPartyWis = (run) =>
  (run.party ?? []).reduce((best, s) => Math.max(best, heroWithGrowth(s.id)?.abilities?.wis ?? 0), 0);

// A floor tile a few steps off the party, clear of other encounters.
function pickHeistSpawn(run) {
  const d = run.dungeon, { x: px, y: py } = run.playerPos, cands = [];
  for (let r = 2; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const x = px + dx, y = py + dy;
    if (isFloor(d, x, y) && !occupiedBy(d, x, y, null)) cands.push({ x, y });
  }
  return cands.length ? cands[Math.floor(liveRNG() * cands.length)] : null;
}

const nearestDoorEntry = (run, from) => {
  let best = null, bd = Infinity;
  for (const dr of run.dungeon.doors ?? []) {
    if (!dr.entry) continue;
    const dist = Math.abs(dr.entry.x - from.x) + Math.abs(dr.entry.y - from.y);
    if (dist < bd) { bd = dist; best = { ...dr.entry }; }
  }
  return best;
};

// On camp, a gold-scaled chance a thief tries your purse. Spotted (best WIS +
// d20 vs 12) he bolts for a door to give chase; unseen he lifts a cut clean.
// Returns { kind: 'chase'|'silent', cut } or null.
function maybeThiefHeist(run) {
  if (run.unbankedGold < 20) return null;
  if (liveRNG() >= Math.min(0.4, 0.1 + run.unbankedGold / 2000)) return null;
  const cut = Math.max(1, Math.round(run.unbankedGold * 0.2));
  const spotted = 1 + Math.floor(liveRNG() * 20) + bestPartyWis(run) >= 12;
  if (spotted) {
    const spawn = pickHeistSpawn(run);
    const door = spawn && nearestDoorEntry(run, spawn);
    if (spawn && door) {
      run.dungeon.encounters.push({
        id: 'thief-heist', x: spawn.x, y: spawn.y,
        monsterIds: ['thief'], flee: true, target: door, steal: cut,
      });
      return { kind: 'chase', cut };
    }
  }
  run.unbankedGold = Math.max(0, run.unbankedGold - cut);
  return { kind: 'silent', cut };
}

// ---------------------------------------------------------------- exploring
export function move(dx, dy) {
  const run = state.run;
  if (!run || run.phase !== 'explore') return;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return;
  const x = run.playerPos.x + dx;
  const y = run.playerPos.y + dy;
  const d = run.dungeon;
  if (x < 0 || x >= d.width || y < 0 || y >= d.height) {
    // Walked off the map edge: if this subregion links that edge to a
    // neighbour, cross into it (arriving at the opposite edge, same lane).
    const dir = dx > 0 ? 'e' : dx < 0 ? 'w' : dy > 0 ? 's' : 'n';
    const dest = d.edges?.[dir];
    if (dest) {
      const events = [];
      travelEdge(dir, dest, dx !== 0 ? run.playerPos.y : run.playerPos.x, events);
    }
    return;
  }

  // Doors sit ON the wall: walk INTO one to travel or bank — you never stand
  // on it. Checked before the wall block below.
  const door = d.doors?.find((dr) => dr.x === x && dr.y === y);
  if (door) {
    if (door.to === 'surface') {
      // In a zone the exit is the entrance gate — don't end the delve outright.
      // Let the player stash what they carry and keep exploring, or leave.
      if (run.dungeon.zone) { emit([{ type: 'surface-prompt', carried: run.unbankedGold }]); return; }
      bankAndWin([]);
      return;
    }
    const events = [];
    travelThrough(door, events);
    return;
  }

  // A portal (the well): walking into it asks before it whisks you away.
  const portal = d.portals?.find((p) => p.x === x && p.y === y);
  if (portal) {
    emit([{ type: 'portal-prompt', to: portal.to, title: portal.title, label: portal.label }]);
    return;
  }

  if (d.tiles[y][x] !== 1 || d.blocked?.has(`${x},${y}`)) return; // wall (or an invisible wall)

  // Bump-to-fight: stepping at a monster tile starts combat; the party
  // only occupies the tile after winning.
  const encounter = d.encounters.find((e) => e.x === x && e.y === y);
  if (encounter) {
    engage(encounter);
    return;
  }

  run.playerPos = { x, y };
  reveal(run);
  const events = [{ type: 'moved', x, y }];
  // Regenerating gear (Rubicite) knits a point back with every step walked, the
  // out-of-combat half of what it does each turn in a fight.
  for (const slot of run.party) {
    const r = equipmentMod(slot.id, 'regen');
    if (r > 0 && slot.hp.current > 0 && slot.hp.current < slot.hp.max) {
      slot.hp.current = Math.min(slot.hp.max, slot.hp.current + r);
    }
  }
  if (run.dragon) {
    const r = equipmentMod('dragon', 'regen');
    if (r > 0 && run.dragon.hp.current > 0) {
      run.dragon.hp.current = Math.min(run.dragon.hp.max, run.dragon.hp.current + r);
    }
  }

  const lootIdx = d.loot.findIndex((l) => l.x === x && l.y === y);
  if (lootIdx >= 0) {
    const [loot] = d.loot.splice(lootIdx, 1);
    // Finding the hoard is the XP, not what it turned out to be worth — a bag
    // of 30 gold and a chest of 200 both pay the same 1 XP, right now.
    grantTreasureXp('normal', events);
    if (loot.tome) {
      // A caster among the party studies the tome — dragons are beasts, not
      // bookworms. Pick a caster hero who has an unknown tome spell to learn,
      // and only one within reach of their tier (a 1st-level arcanist can't
      // read Fireball off the page). Nobody eligible → the tome is sold.
      const casters = (run.party ?? [])
        .map((s) => heroWithGrowth(s.id))
        .filter((h) => h?.castStat)
        .map((h) => ({
          id: h.id,
          name: h.name,
          unknown: SPELLS.filter(
            (sp) =>
              sp.tome !== false &&
              !h.spells.includes(sp.id) &&
              canLearnSpell(state.meta.heroGrowth?.[h.id]?.level ?? 1, sp)
          ),
        }))
        .filter((h) => h.unknown.length);
      if (casters.length) {
        const learner = casters[Math.floor(liveRNG() * casters.length)];
        const learned = learner.unknown[Math.floor(liveRNG() * learner.unknown.length)];
        (state.meta.heroTomes[learner.id] ??= []).push(learned.id);
        events.push({ type: 'tome', spell: learned.name, who: learner.name });
      } else {
        run.unbankedGold += 25;
        events.push({ type: 'tome', spell: null, gold: 25 });
      }
    } else if (loot.item) {
      // A hand-placed cache pinned to a specific magic item (see the editor).
      const it = itemById(loot.item);
      if (it && !state.meta.inventory.includes(it.id)) {
        state.meta.inventory.push(it.id);
        events.push({ type: 'item-drop', name: it.name, blurb: it.blurb });
        grantTreasureXp(itemXpTier(it), events);
      } else {
        run.unbankedGold += 20;
        events.push({ type: 'loot', label: 'a picked-clean cache', gold: 20 });
      }
    } else if (loot.consumable) {
      state.meta.consumables.push(loot.consumable);
      events.push({ type: 'loot', label: `${consumableById(loot.consumable)?.name ?? 'a flask'} into your pouch`, gold: 0 });
    } else {
      let gold = loot.gold;
      if (partyHasFamiliar(run, 'pack-rat')) gold = Math.round(gold * 1.25);
      run.unbankedGold += gold;
      events.push({ type: 'loot', label: loot.label, icon: loot.icon, gold });
    }
  }

  // The party has taken its step — now the patrollers (and any fleeing thief)
  // take theirs.
  const caught = tickEnemies(run, events);
  persist(state);
  emit(events);
  if (caught) engage(caught);
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
  const dungeon = pruneDefeated(buildZoneDungeon(zone.id, idx, run.dungeon.seed, 1 + run.party.length));
  run.dungeon = dungeon;
  const back = dungeon.doors.find((dd) => dd.to === fromSub);
  run.playerPos = back ? { ...back.entry } : { ...dungeon.start };
  run.explored = {};
  run.dimSeen = {};
  reveal(run);
  persist(state);
  events.push({ type: 'traveled', zone: dungeon.zone });
  emit(events);
}

/** Descend/enter a portal (e.g. climb down the well) after the player confirms.
 * Like travelThrough but with no origin door: arrive at the paired return door
 * if the destination has one, else at its start. */
export function usePortal(to) {
  const run = state.run;
  if (!run || run.phase !== 'explore') return;
  const zone = zoneById(run.dungeon.zone?.id);
  if (!zone) return;
  const fromSub = run.dungeon.subId;
  const idx = zone.subregions.findIndex((sr) => sr.id === to);
  if (idx < 0) return;
  const dungeon = pruneDefeated(buildZoneDungeon(zone.id, idx, run.dungeon.seed, 1 + run.party.length));
  run.dungeon = dungeon;
  const back = dungeon.doors.find((dd) => dd.to === fromSub);
  run.playerPos = back ? { ...back.entry } : { ...dungeon.start };
  run.explored = {};
  run.dimSeen = {};
  reveal(run);
  persist(state);
  emit([{ type: 'traveled', zone: dungeon.zone }]);
}

/** The first walkable tile scanning in from the edge opposite `dir`, in the
 * player's lane, so crossing an edge feels continuous. Falls back to start. */
function arrivalTile(dungeon, dir, lane) {
  const { width, height, tiles } = dungeon;
  const floor = (x, y) => x >= 0 && x < width && y >= 0 && y < height && tiles[y][x] === 1;
  if (dir === 'e') for (let x = 0; x < width; x++) { if (floor(x, lane)) return { x, y: lane }; }
  else if (dir === 'w') for (let x = width - 1; x >= 0; x--) { if (floor(x, lane)) return { x, y: lane }; }
  else if (dir === 's') for (let y = 0; y < height; y++) { if (floor(lane, y)) return { x: lane, y }; }
  else if (dir === 'n') for (let y = height - 1; y >= 0; y--) { if (floor(lane, y)) return { x: lane, y }; }
  return { ...dungeon.start };
}

/** Walk off an edge into the neighbouring sub-area of the same region. Like
 * travelThrough, but triggered by the map boundary rather than a door; you
 * arrive at the matching spot on the opposite edge. */
function travelEdge(dir, destSubId, lane, events) {
  const run = state.run;
  const zone = zoneById(run.dungeon.zone?.id);
  if (!zone) return;
  const idx = zone.subregions.findIndex((sr) => sr.id === destSubId);
  if (idx < 0) return;
  const dungeon = pruneDefeated(buildZoneDungeon(zone.id, idx, run.dungeon.seed, 1 + run.party.length));
  run.dungeon = dungeon;
  run.playerPos = arrivalTile(dungeon, dir, lane);
  run.explored = {};
  run.dimSeen = {};
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
  run.burnedSpells = {}; // a night's rest restores every fizzled spell (Shadowdark)
  run.luck = Object.fromEntries(run.party.map((p) => [p.id, 1])); // and refreshes each hero's luck token

  // A camp thief may try your purse — his own event, before any wandering pack.
  const heist = maybeThiefHeist(run);
  if (heist?.kind === 'chase') {
    persist(state);
    emit([{ type: 'heist-start', gold: heist.cut }]);
    return;
  }
  if (heist?.kind === 'silent') {
    persist(state);
    emit([{ type: 'rested', ambush: false }, { type: 'robbed', gold: heist.cut, escaped: false }]);
    return;
  }

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

/**
 * Treasure is XP (Shadowdark). Everyone on the delve is paid the **whole**
 * award the moment it's found — nothing is divided, and nothing waits for the
 * exit, so a party wiped on the way out still keeps what it learned. `tier` is
 * 'normal' (a ground pile), 'fabulous' (a magic item), or 'legendary'.
 * Returns the level-up events to fold into the caller's batch.
 */
function grantTreasureXp(tier, events = []) {
  // An unlisted tier (a harvested trophy's 'none') is worth nothing — a feather
  // is not a hoard.
  const amount = XP_FOR[tier] ?? 0;
  if (!amount || !state.run?.party?.length) return events;
  events.push({ type: 'xp', amount, tier });
  for (const slot of state.run.party) {
    const g = growthFor(slot.id);
    g.xp += amount;
    let newLevel = levelForXp(g.xp);
    while (newLevel > g.level) {
      g.level += 1;
      // Shadowdark: every level past the first ROLLS the hit die + CON. The
      // roll is kept per level in the growth record so it never re-rolls and
      // a hero's HP can't wobble between renders.
      g.hpRolls ??= [];
      const hp = rollHpGain(heroWithGrowth(slot.id), liveRNG);
      g.hpRolls.push(hp);
      slot.hp.max += hp;
      slot.hp.current += hp;
      events.push({
        type: 'level-up', charId: slot.id, who: heroById(slot.id)?.name ?? slot.id,
        level: g.level, hp,
      });
    }
  }
  return events;
}

/** The XP tier a found item pays out at. Magic items are 'fabulous' by default. */
function itemXpTier(item) {
  return item?.xp ?? 'fabulous';
}

function bankAndWin(events) {
  const run = state.run;
  // Zones exit through their entrance gate, so there's no "reached the exit"
  // bonus — only procedural depths reward the climb back out.
  const bonus = run.dungeon.zone ? 0 : endOfRunBonus(run.dungeon.depth);
  const banked = run.unbankedGold + bonus;
  state.meta.hoardGold += banked;
  state.meta.runsCompleted += 1;
  // Banked gold feeds the dragon's hoard only — heroes were paid in XP when
  // they picked the treasure up (grantTreasureXp).
  run.phase = 'won';
  run.lastResult = { banked, bonus, hoard: state.meta.hoardGold, depth: run.dungeon.depth };
  events.push({ type: 'banked', ...run.lastResult });
  checkTierUp(events);
  persist(state);
  emit(events);
}

/** Stash carried gold into the safe hoard but keep delving (zone exit gate). */
export function stashHoard() {
  const run = state.run;
  if (!run || run.phase !== 'explore') return;
  const stashed = run.unbankedGold;
  run.unbankedGold = 0;
  state.meta.hoardGold += stashed;
  const events = grantBankingXp(stashed);
  checkTierUp(events);
  events.push({ type: 'stashed', stashed, hoard: state.meta.hoardGold });
  persist(state);
  emit(events);
}

/** Leave through the zone gate: bank everything and end the delve. */
export function surfaceExit() {
  if (state.run?.phase === 'explore') bankAndWin([]);
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
// ----------------------------------------------------- parley (before a fight)
// The best talker the party can field.
function bestFace(run) {
  let face = { abilities: { cha: run.dragon ? 2 : 0 }, talents: [] };
  for (const slot of run.party) {
    const h = heroWithGrowth(slot.id);
    if ((h?.abilities?.cha ?? -99) > (face.abilities.cha ?? -99)) face = h;
  }
  return face;
}

// Will this pack talk? Undead never do. Animals (wild) won't either, unless a
// party member has the Animal Friend feat (Beren starts with it). Other packs
// need a non-'never' disposition. Standing rides on the roll now, not the offer.
function parleyOffer(run, encounter) {
  const lead = monsterById(encounter.monsterIds[0]);
  if (!lead) return null;
  if (lead.undead || lead.faction === 'undead') return null;
  if (lead.faction === 'wild') {
    if (!(run.party ?? []).some((s) => heroWithGrowth(s.id)?.traits?.includes('animal-friend'))) return null;
  } else if (!lead.parley || lead.parley === 'never') {
    return null;
  }
  const rep = state.meta.reputation[lead.faction] ?? 0;
  return { faction: lead.faction, disposition: dispositionLabel(rep), dc: parleyDC(lead.parley), rep };
}

// Bump into a pack: offer parley once, up front, if they'll talk — else straight
// to the fight. Not persisted, so a reload just replays the bump.
function engage(encounter) {
  const run = state.run;
  const offer = parleyOffer(run, encounter);
  if (!offer) { beginCombat(encounter); return; }
  run.pendingEncounter = encounter;
  run.pendingParley = offer;
  run.phase = 'parley'; // blocks movement until the player answers
  emit([{ type: 'parley-offer', names: encounter.monsterIds.map((id) => monsterById(id)?.name ?? id), ...offer }]);
}

// Two-step parley. The top menu is 'fight' or 'talk'; Talk opens the approach
// menu — 'persuade' (leave in peace), 'threaten'/intimidate (drive them off),
// 'work' (take a bounty). Each rolls its own CHA check when chosen, with standing
// swinging it (+faction to persuade, -faction to intimidate). Not persisted, so a
// reload just replays the bump.
export function resolveEncounter(mode) {
  const run = state.run;
  if (!run || run.phase !== 'parley' || !run.pendingEncounter) return;
  const encounter = run.pendingEncounter;
  const offer = run.pendingParley;
  const clear = () => { run.pendingEncounter = null; run.pendingParley = null; run.parleyWon = false; };

  if (mode === 'fight' || !mode) { clear(); run.phase = 'explore'; beginCombat(encounter); return; }

  // Talk just opens the approach menu; the CHA roll happens when you pick one.
  if (mode === 'talk') { emit([{ type: 'talk-open' }]); return; }

  // persuade / threaten (intimidate) / work — each rolls when chosen. Standing
  // helps persuasion (+faction); a fearsome, hated standing helps intimidation
  // (-faction), so a villain reads as scarier.
  const face = bestFace(run);
  const rep = state.meta.reputation[offer.faction] ?? 0;
  const mod = mode === 'threaten' ? -rep : rep;
  const check = resolveParleyCheck(face, offer.dc, liveRNG, { advantage: face.talents?.includes('silver-tongue'), mod });
  const events = [{ type: 'parley-outcome', mode, success: check.success, total: check.total, dc: offer.dc }];
  if (!check.success) { clear(); run.phase = 'explore'; emit(events); beginCombat(encounter); return; }
  clear(); run.phase = 'explore';
  if (mode === 'work') {
    const boss = run.dungeon.encounters.find((e) => e.id.startsWith('boss'));
    if (boss) {
      const reward = 15 + run.dungeon.depth * 10;
      run.quest = { encId: boss.id, name: boss.bossName, reward, from: offer.faction };
      events.push({ type: 'quest-received', target: boss.bossName, reward });
    }
  }
  if (mode !== 'threaten') bumpRep(offer.faction, 1);
  const idx = run.dungeon.encounters.indexOf(encounter);
  if (idx >= 0) run.dungeon.encounters.splice(idx, 1);
  run.playerPos = { x: encounter.x, y: encounter.y };
  reveal(run);
  persist(state);
  emit(events);
}

function beginCombat(encounter) {
  const run = state.run;
  let heroes = [];
  if (run.dragon) {
    const tier = tierByName(run.dragon.tier);
    // The dragon is a pure martial — bite and breath, no tomes and no familiar.
    const dragon = makeDragonCombatant(tier, run.dragon.hp.current, { spells: [] });
    dragon.hp.max = run.dragon.hp.max;
    dragon.hp.current = Math.min(run.dragon.hp.current, dragon.hp.max);
    applyEquipment(dragon, 'dragon');
    heroes.push(dragon);
  }
  // Downed companions come along at 0 HP — a Healing Word can revive them. Each
  // carries its own familiar (from heroWithGrowth → makeCombatant), if it has one.
  for (const slot of run.party) {
    const c = makeCombatant(heroWithGrowth(slot.id));
    c.hp.max = slot.hp.max;
    c.hp.current = slot.hp.current;
    applyEquipment(c, slot.id);
    c.burned = [...(run.burnedSpells?.[slot.id] ?? [])];
    c.luck = run.luck?.[slot.id] ?? 0; // this hero's remaining luck token(s) for the day
    heroes.push(c);
  }
  const monsters = encounter.monsterIds.map((id) => makeCombatant(monsterById(id)));
  if (encounter.bossName) for (const m of monsters) m.isBoss = true; // a boss pack can't be dominated
  applyWorldFlags(monsters, encounter); // quest flags may weaken a specific boss
  const { combat, events } = createCombat(heroes, monsters, liveRNG, encounter.bossName ?? null);
  combat.consumables = state.meta.consumables; // shared pouch (same array ref; a used item splices out of meta)
  // Knowledge check (Shadowdark lore): one silent party INT roll per kind of foe
  // sizes it up. Higher totals reveal more in the inspect popup (name -> stats &
  // weaknesses) and in action labels; a fail leaves it an unidentified
  // "creature". Stored per type, never announced -- the player only feels it
  // through what info they can see.
  const bestInt = Math.max(0, ...heroes.map((h) => h.abilities?.int ?? 0));
  combat.lore = {};
  for (const m of monsters) {
    if (m.templateId in combat.lore) continue;
    const dc = 10 + (monsterById(m.templateId)?.minDepth ?? 1);
    const margin = 1 + Math.floor(liveRNG() * 20) + bestInt - dc;
    combat.lore[m.templateId] = margin < 0 ? 0 : margin < 5 ? 1 : 2;
  }
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
  const followUp = runAiTurns(combat, liveRNG);
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

// Use a consumable from the shared pouch. Spent only when the turn is actually
// taken (playerUseItem returns events), so a wasted click doesn't lose an item.
export function useItem(itemId, targetId = null) {
  const item = consumableById(itemId);
  if (!item || !state.meta.consumables.includes(itemId)) return;
  resolvePlayerAction((combat) => {
    const events = playerUseItem(combat, item, targetId, liveRNG);
    if (events.length) {
      const i = state.meta.consumables.indexOf(itemId);
      if (i >= 0) state.meta.consumables.splice(i, 1);
    }
    return events;
  });
}

/** Cow the highlighted enemy mid-fight: a CHA check to panic it into fleeing. */
export function intimidate(targetId) {
  resolvePlayerAction((combat) => playerIntimidate(combat, targetId, liveRNG));
}

export function sweep() {
  resolvePlayerAction((combat) => playerSweep(combat, liveRNG));
}

/** Flee an unwinnable fight: you escape the labyrinth but drop the gold you were
 *  carrying — the same cost as being downed. Banked hoard is safe. */
export function flee() {
  const run = state.run;
  if (!run || run.phase !== 'combat' || !run.combat) return;
  forcedRetreat([{ type: 'flee-combat' }]);
}

function resolvePlayerAction(act) {
  const run = state.run;
  if (!run || run.phase !== 'combat' || !run.combat) return;
  const combat = run.combat.combat;
  if (!isPlayerTurn(combat)) return;
  const events = act(combat);
  if (!events.length) return;
  // A failed roll may pause the turn to offer a luck reroll: narrate the miss and
  // wait — the AI turns wait for spendLuck()/declineLuck() to resolve the choice.
  if (combat.pendingLuck) {
    syncDragonHp();
    emit(events);
    return;
  }
  if (!combat.over) events.push(...runAiTurns(combat, liveRNG));
  syncDragonHp();
  if (combat.over) {
    finishCombat(events);
    return;
  }
  // Mid-combat state is never persisted; reloading resumes from before the fight.
  emit(events);
}

/** Cash in the pending luck token to reroll the failed attack/cast. */
export function spendLuck() {
  resolveLuckChoice((combat) => luckReroll(combat, liveRNG));
}
/** Let the failed roll stand and move on. */
export function declineLuck() {
  resolveLuckChoice((combat) => luckDecline(combat, liveRNG));
}
function resolveLuckChoice(resolve) {
  const run = state.run;
  if (!run || run.phase !== 'combat' || !run.combat) return;
  const combat = run.combat.combat;
  if (!combat.pendingLuck) return;
  const events = resolve(combat); // rerolls (or finalizes) and advances the turn
  if (!combat.over) events.push(...runAiTurns(combat, liveRNG));
  syncDragonHp();
  if (combat.over) {
    finishCombat(events);
    return;
  }
  emit(events);
}

/** Fold a character's equipped item mods into its combatant. */
function applyEquipment(c, charKey) {
  // A two-handed weapon leaves no hand for a shield, so a shield in the slot
  // pays out nothing — the same rule as the shield a hero already carries
  // (shieldAcFor in data/weapons.js). It stays equipped, it just does nothing
  // until they take up a one-handed weapon.
  const twoHanded = !!c.attacks?.[0]?.twoHanded;
  const worn = equippedItems(charKey).filter((it) => !(it.slot === 'shield' && twoHanded));
  const sum = (field) => worn.reduce((n, it) => n + (it.mods[field] ?? 0), 0);
  c.ac += sum('ac');
  c.initBonus = sum('init');
  c.regen = (c.regen ?? 0) + sum('regen'); // Rubicite and its kin mend as you go
  c.castDC = sum('castDC'); // the Metal Wand: negative makes every spell easier
  c.intimidate = sum('intimidate'); // the Idol of Thule
  // An ability item raises the score itself, so everything that rolls that
  // ability improves for free (initiative and DEX saves, a caster's DC, a
  // parley's CHA). DEX also buys AC and sharpens a finesse weapon, the way an
  // ability increase does; CON's max HP is added where party HP is built, so
  // the run's own HP numbers agree with the combatant's.
  for (const ab of ABILITY_KEYS) {
    const n = sum(ab);
    if (!n) continue;
    c.abilities[ab] = (c.abilities[ab] ?? 0) + n;
    if (ab === 'dex') {
      c.ac += n;
      for (const a of c.attacks) if (a.stat === 'dex') a.toHit += n;
    }
  }
  for (const item of worn) {
    if (item.bane) c.bane = item.bane;
  }
  const toHit = sum('toHit');
  const damage = sum('damage');
  for (const attack of c.attacks) {
    attack.toHit += toHit;
    attack.damage = bumpDamage(attack.damage, damage);
  }
}

/**
 * A hero as they actually stand, gear and all — the same numbers the combat
 * engine will build, for anything that *shows* a hero rather than fights with
 * them. `heroWithGrowth` deliberately stops at level-up folds, so without this
 * the character sheet reported a bare AC and a +1 ring appeared to do nothing.
 */
export function heroWithGear(id) {
  const hero = heroWithGrowth(id);
  if (!hero) return null;
  const view = {
    ...hero,
    abilities: { ...hero.abilities },
    attacks: hero.attacks.map((a) => ({ ...a })),
  };
  applyEquipment(view, id);
  view.hpMax = hero.hpMax + equipmentHp(id);
  return view;
}

/** Does this character's equipped shield actually do anything? */
function shieldIdle(charKey) {
  const hero = heroWithGrowth(charKey);
  if (!hero?.attacks?.[0]?.twoHanded) return false;
  return equippedItems(charKey).some((it) => it.slot === 'shield');
}

function syncDragonHp() {
  const run = state.run;
  const combat = run.combat?.combat;
  if (!combat) return;
  run.burnedSpells ??= {};
  for (const hero of heroesOf(combat)) {
    // Fizzled spells stay lost until the party makes camp (Shadowdark), so mirror
    // each caster's burned list back onto the run between combats.
    if (hero.spells?.length) {
      const key = hero.kind === 'dragon' ? 'dragon' : hero.templateId;
      if (key) run.burnedSpells[key] = [...(hero.burned ?? [])];
    }
    if (hero.kind === 'dragon') {
      if (run.dragon) run.dragon.hp.current = hero.hp.current;
    } else {
      const slot = run.party.find((p) => p.id === hero.templateId);
      if (slot) slot.hp.current = hero.hp.current;
      if (run.luck && hero.templateId in run.luck) run.luck[hero.templateId] = hero.luck ?? 0;
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
      bumpRep(t.faction, -1);
      for (const friend of Object.keys(FACTION_ENEMIES)) {
        if (FACTION_ENEMIES[friend]?.includes(t.faction)) bumpRep(friend, 1);
      }
    }
    const idx = run.dungeon.encounters.findIndex((e) => e.id === run.combat.encounterId);
    let bossName = null;
    let bossDrops = null;
    if (idx >= 0) {
      const enc = run.dungeon.encounters[idx];
      bossName = enc.bossName ?? null;
      bossDrops = enc.bossDrops ?? null;
      // A named boss stays dead across future visits.
      if (enc.bossKey && !state.meta.defeatedBosses.includes(enc.bossKey)) {
        state.meta.defeatedBosses.push(enc.bossKey);
      }
      run.dungeon.encounters.splice(idx, 1);
      run.playerPos = { x: enc.x, y: enc.y };
      reveal(run);
    }
    // A promised bounty pays out when its target falls.
    if (run.quest && run.quest.encId === run.combat.encounterId) {
      run.unbankedGold += run.quest.reward;
      events.push({ type: 'quest-complete', target: run.quest.name, reward: run.quest.reward, from: run.quest.from });
      bumpRep(run.quest.from, 2);
      run.quest = null;
    }

    // A beast has no purse, but it has fangs and feathers. Each slain beast that
    // carries a `harvest` has a moderate chance of leaving it behind — the venom
    // into the shared pouch, the trophy into the inventory (once only).
    for (const m of slain) {
      const h = monsterById(m.templateId)?.harvest;
      if (!h || liveRNG() >= HARVEST_CHANCE) continue;
      if (h.consumable && consumableById(h.consumable)) {
        state.meta.consumables.push(h.consumable);
        events.push({ type: 'harvest', who: m.name, name: consumableById(h.consumable).name, kind: 'consumable' });
      } else if (h.item) {
        const it = itemById(h.item);
        if (it && !state.meta.inventory.includes(it.id)) {
          state.meta.inventory.push(it.id);
          events.push({ type: 'harvest', who: m.name, name: it.name, blurb: it.blurb, kind: 'item' });
        }
      }
    }

    // Magic items come ONLY from the named boss that carries them. There is no
    // zone-wide fallback: an item no boss lists cannot be found, which keeps
    // "this boss drops this thing" a promise the player can rely on.
    if (slain.length && bossName) {
      const owned = state.meta.inventory;
      const pool = (bossDrops ?? []).filter((id) => !owned.includes(id)).map(itemById).filter(Boolean);
      if (pool.length && liveRNG() < victoryDropChance(true)) {
        const found = pool[Math.floor(liveRNG() * pool.length)];
        state.meta.inventory.push(found.id);
        events.push({ type: 'item-drop', name: found.name, blurb: found.blurb });
        grantTreasureXp(itemXpTier(found), events);
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
