// The text-adventure engine: pure functions over a serializable GameState.
//
// `createGame` seeds a playthrough from an Adventure + party. `step` interprets
// one typed (or tapped) command and returns the next state with new transcript
// lines appended. Combat is light Shadowdark: 1d20+mod vs AC, weapon die for
// damage, HP tracked per combatant. Every die roll goes through `rollAndLog`
// so it also shows up in the shared Dice log.

import { formatMod, pick, statMod } from '../dice';
import { rollAndLog } from '../rollLog';
import { checkPassed, checkRoll, damageRoll } from '../cinematicRoll';
import { getMonster } from '../shadowdark/monsters';
import { characterCombatProfile } from '../shadowdark/combat';
import { getSpell } from '../shadowdark/spells';
import { scaleMonster } from './scaling';
import type { Character, SpellCombat } from '../shadowdark/types';
import type {
  Adventure,
  AdvEncounter,
  AdvExit,
  AdvItem,
  AdvParley,
  AdvRoom,
  EnemyState,
  GameState,
  MessageKind,
  PartyMemberState,
  RollPart,
  RollPayload,
  TurnRef,
} from './types';

// ───────── small helpers ─────────

function push(s: GameState, kind: MessageKind, text: string, roll?: RollPayload) {
  s.transcript.push({ id: s.messageSeq++, kind, text, roll });
}

// Every dramatic die roll goes through the shared `checkRoll`/`damageRoll`
// builders (lib/cinematicRoll.ts) so it (a) hits the shared Dice log and
// (b) carries a RollPayload the play UI replays as a BG3-style animated roll.

// ───────── torchlight ─────────
//
// Shadowdark's clock, turned crawl-shaped: a torch holds TORCH_LIFE ticks and
// loses one per room entered and one per combat round. At zero the dungeon goes
// dark — hero attacks at disadvantage, enemy attacks at advantage, no searching.

export const TORCH_LIFE = 24;

export function inDarkness(s: GameState): boolean {
  return s.light.lit <= 0;
}

function tickLight(s: GameState) {
  if (s.light.lit <= 0) return;
  s.light.lit -= 1;
  if (s.light.lit === 0) {
    push(
      s,
      'system',
      s.light.spares > 0
        ? 'Your torch gutters out! Darkness swallows the party — quick, "light torch"!'
        : 'Your last torch gutters out! Darkness swallows the party. Blades swing blind and every shadow has teeth.',
    );
  } else if (s.light.lit === 4) {
    push(s, 'system', 'Your torch burns low, the flame guttering blue at its heart…');
  }
}

function itemKey(roomId: string, name: string): string {
  return `${roomId}::${name.toLowerCase()}`;
}

const DIR_ALIASES: Record<string, string> = {
  n: 'n', north: 'n',
  s: 's', south: 's',
  e: 'e', east: 'e',
  w: 'w', west: 'w',
  u: 'up', up: 'up',
  d: 'down', down: 'down',
  in: 'in', inside: 'in', enter: 'in',
  out: 'out', outside: 'out', exit: 'out',
};

function normalizeDir(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return DIR_ALIASES[token] ?? token;
}

const FILLER = new Set(['to', 'the', 'a', 'an', 'at', 'into', 'toward', 'towards', 'on', 'of', 'my', 'your']);

function cleanTarget(rest: string[]): string {
  return rest.filter((t) => !FILLER.has(t)).join(' ').trim();
}

/** Drop filler words so "Pouch of goblin coins" matches a "pouch goblin coins" query. */
function normName(str: string): string {
  return str.toLowerCase().split(/\s+/).filter((t) => t && !FILLER.has(t)).join(' ');
}

/** Lenient name match: `target` is an already-cleaned query, `name` a full item/NPC name. */
function nameMatches(target: string, name: string): boolean {
  const a = normName(target);
  const b = normName(name);
  if (!a) return false;
  return a === b || b.includes(a) || a.includes(b);
}

/** Roll a damage expression, doubling dice on a crit. Handles flat numbers. */
function rollDamageTotal(damage: string, crit: boolean, label: string): number {
  const m = damage.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
  if (m) {
    const count = parseInt(m[1], 10) * (crit ? 2 : 1);
    const expr = `${count}d${m[2]}${m[3] ?? ''}`;
    return Math.max(1, rollAndLog(expr, 'normal', label).total);
  }
  const flat = parseInt(damage, 10) || 1;
  return Math.max(1, crit ? flat * 2 : flat);
}

// ───────── selectors (used by the engine and the UI) ─────────

export function currentRoom(state: GameState, adv: Adventure): AdvRoom {
  return adv.roomsById[state.currentRoomId];
}

export function roomItems(state: GameState, room: AdvRoom): AdvItem[] {
  const extra = state.extraItems.filter((e) => e.roomId === room.id).map((e) => e.item);
  return [...room.items, ...extra].filter(
    (it) => !state.takenItems.includes(itemKey(room.id, it.name)),
  );
}

export function visibleExits(_state: GameState, room: AdvRoom): AdvExit[] {
  return room.exits;
}

export function exitLabel(exit: AdvExit): string {
  if (exit.label) return exit.label;
  const pretty: Record<string, string> = {
    n: 'Go north', s: 'Go south', e: 'Go east', w: 'Go west',
    up: 'Go up', down: 'Go down', in: 'Go in', out: 'Go out',
  };
  return pretty[normalizeDir(exit.dir) ?? exit.dir] ?? `Go ${exit.dir}`;
}

export function livingEnemies(state: GameState): EnemyState[] {
  return state.combat?.enemies.filter((e) => e.hp.current > 0) ?? [];
}

export function consciousParty(state: GameState): PartyMemberState[] {
  return state.party.filter((m) => m.hp.current > 0);
}

export function activeMember(state: GameState): PartyMemberState | undefined {
  return state.party[state.activeIndex];
}

// ───────── room + combat lifecycle ─────────

function describeRoom(s: GameState, adv: Adventure, firstTime: boolean) {
  const room = currentRoom(s, adv);
  if (inDarkness(s)) {
    push(s, 'room', `${room.name}\nIt is pitch dark. Shapes loom half-guessed at the edge of your night-blind eyes.`);
    return;
  }
  push(s, 'room', `${room.name}\n${room.description}`);
  if (firstTime && room.firstVisit) push(s, 'room', room.firstVisit);
  const items = roomItems(s, room);
  if (items.length) push(s, 'system', `You see: ${items.map((i) => i.name).join(', ')}.`);
  if (room.npcs.length) push(s, 'system', `Here: ${room.npcs.map((n) => n.name).join(', ')}.`);
  const exits = visibleExits(s, room);
  push(
    s,
    'system',
    exits.length ? `Exits: ${exits.map((e) => normalizeDir(e.dir) ?? e.dir).join(', ')}.` : 'There are no obvious exits.',
  );
}

function buildEnemies(enc: AdvEncounter, powerLevel: number): EnemyState[] {
  const monsters = enc.monsters.map(getMonster).filter((m): m is NonNullable<typeof m> => !!m);
  const totals: Record<string, number> = {};
  for (const m of monsters) totals[m.name] = (totals[m.name] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return monsters.map((m, i) => {
    seen[m.name] = (seen[m.name] ?? 0) + 1;
    const label = totals[m.name] > 1 ? `${m.name} ${seen[m.name]}` : m.name;
    // Scale per instance, so a room of mooks comes out as a ragged spread.
    const sc = scaleMonster(m, powerLevel);
    return {
      id: `e${i}`,
      monsterId: m.id,
      name: label,
      ac: sc.ac,
      hp: { current: sc.hpMax, max: sc.hpMax },
      attacks: sc.attacks,
      tags: m.tags ?? [],
      icon: m.icon,
    };
  });
}

// Tags that mark a foe as something you could talk to. Anything without one of
// these (a beast, a construct, a mindless skeleton) won't be reasoned with.
const REASON_TAGS = new Set([
  'humanoid', 'goblinoid', 'gnoll', 'kobold', 'leader', 'boss', 'named-character',
  'hero', 'caster', 'fiend', 'druid', 'wizard', 'fighter', 'dragon', 'vampire',
]);

function canReason(enemy: EnemyState): boolean {
  return enemy.tags.some((t) => REASON_TAGS.has(t));
}

function bestChaMod(s: GameState): number {
  const conscious = consciousParty(s);
  if (!conscious.length) return 0;
  return Math.max(...conscious.map((m) => m.chaMod));
}

function firstConsciousIndex(s: GameState): number {
  const idx = s.party.findIndex((m) => m.hp.current > 0);
  return idx >= 0 ? idx : 0;
}

/** Roll initiative for everyone and build the interleaved turn order. Heroes
 *  roll 1d20+DEX; monsters roll a flat 1d20. Heroes win ties. */
function rollInitiative(s: GameState, enemies: EnemyState[]): TurnRef[] {
  const order: TurnRef[] = [];
  for (const m of s.party) {
    if (m.hp.current <= 0) continue;
    const r = rollAndLog(`1d20${m.dexMod !== 0 ? formatMod(m.dexMod) : ''}`, 'normal', `${m.name} initiative`);
    order.push({ side: 'hero', refId: m.id, name: m.name, init: r.total });
  }
  for (const e of enemies) {
    const r = rollAndLog('1d20', 'normal', `${e.name} initiative`);
    order.push({ side: 'enemy', refId: e.id, name: e.name, init: r.total });
  }
  order.sort((a, b) => b.init - a.init || (a.side === 'hero' ? -1 : 1) - (b.side === 'hero' ? -1 : 1));
  return order;
}

function maybeStartCombat(s: GameState, adv: Adventure) {
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  if (!enc) return;
  if (enc.flag && s.flags.includes(enc.flag)) return;
  const enemies = buildEnemies(enc, s.powerLevel);
  if (!enemies.length) return;
  const order = rollInitiative(s, enemies);
  s.combat = { encounterId: enc.id, enemies, round: 1, order, turnIndex: -1, moraleChecked: false };
  s.mode = 'combat';
  for (const m of s.party) {
    m.acted = false;
    m.spentSpells = [];
    m.atkBonus = 0;
    m.dmgBonus = 0;
    m.acBonus = 0;
  }
  s.activeIndex = firstConsciousIndex(s);
  if (enc.intro) push(s, 'combat', enc.intro);
  push(s, 'combat', `Foes: ${enemies.map((e) => `${e.name} (AC ${e.ac}, HP ${e.hp.max})`).join(', ')}.`);
  if (enc.parley?.prompt) push(s, 'combat', enc.parley.prompt);
  push(s, 'combat', `Initiative: ${order.map((t) => `${t.name} (${t.init})`).join(' → ')}.`);
  const canTalk = !!enc.parley || enemies.some(canReason);
  push(s, 'system', `Battle begins! You can attack, "flee"${canTalk ? ', or "negotiate"' : ''}.`);
  advanceTurn(s, adv);
}

/** March the initiative order forward: auto-resolve enemy turns as they come
 *  up, stop when a hero's turn arrives (or the fight ends). */
function advanceTurn(s: GameState, _adv: Adventure) {
  const c = s.combat;
  if (!c) return;
  let guard = 0;
  while (s.mode === 'combat' && s.combat && guard++ < 200) {
    c.turnIndex += 1;
    if (c.turnIndex >= c.order.length) {
      c.turnIndex = 0;
      c.round += 1;
      tickLight(s);
      push(s, 'system', `— Round ${c.round} —`);
    }
    const t = c.order[c.turnIndex];
    if (t.side === 'hero') {
      const idx = s.party.findIndex((m) => m.id === t.refId);
      const member = s.party[idx];
      if (!member || member.hp.current <= 0) continue;
      s.activeIndex = idx;
      push(s, 'system', `${member.name}'s turn.`);
      return;
    }
    const enemy = c.enemies.find((e) => e.id === t.refId);
    if (!enemy || enemy.hp.current <= 0) continue;
    enemyAct(s, enemy);
  }
}

/** One enemy takes its turn: pick a random attack and a random conscious hero.
 *  Darkness gives the foe advantage. */
function enemyAct(s: GameState, enemy: EnemyState) {
  const targets = consciousParty(s);
  if (!targets.length) {
    resolveDefeat(s);
    return;
  }
  const target = pick(targets);
  const attack = pick(enemy.attacks.length ? enemy.attacks : [{ name: 'Strike', bonus: 0, damage: '1d4' }]);
  const effAc = target.ac + target.acBonus;
  const dark = inDarkness(s);
  const atk = checkRoll({
    kind: 'attack',
    side: 'enemy',
    title: `${enemy.name} — ${attack.name} vs ${target.name}`,
    mode: dark ? 'advantage' : 'normal',
    parts: [{ label: 'attack', value: attack.bonus }],
    target: effAc,
    targetLabel: `AC ${effAc}`,
  });
  if (!checkPassed(atk)) {
    push(s, 'combat', `${enemy.name} lunges at ${target.name} and misses. (${atk.total} vs AC ${effAc})`, atk);
    return;
  }
  const crit = atk.outcome === 'crit';
  const dmg = damageRoll({ side: 'enemy', title: `${enemy.name} — ${attack.name} damage`, damage: attack.damage, crit });
  push(s, 'combat', `${enemy.name} hits ${target.name}${crit ? ' — critical!' : ''}.`, atk);
  target.hp.current = Math.max(0, target.hp.current - dmg.total);
  push(s, 'combat', `${target.name} takes ${dmg.total} damage. (${target.hp.current}/${target.hp.max} HP)`, dmg);
  if (target.hp.current <= 0) push(s, 'combat', `${target.name} is knocked out!`);
  if (consciousParty(s).length === 0) resolveDefeat(s);
}

// Foes that never lose heart: the mindless, the deathless, and anything with a
// name worth putting on a tombstone.
const FEARLESS_TAGS = new Set(['undead', 'construct', 'ooze', 'boss', 'named-character', 'solo']);

/** Once per fight, when half or more of the foes are down, the survivors test
 *  their nerve. Failing the check, they scatter — a bloodless victory. */
function maybeMorale(s: GameState, adv: Adventure) {
  const c = s.combat;
  if (!c || c.moraleChecked) return;
  const living = livingEnemies(s);
  if (!living.length || living.length > c.enemies.length / 2) return;
  c.moraleChecked = true;
  if (living.some((e) => e.tags.some((t) => FEARLESS_TAGS.has(t)))) return;
  const morale = checkRoll({
    kind: 'check',
    side: 'enemy',
    title: 'Morale check — will the foes hold?',
    parts: [],
    target: 12,
    targetLabel: 'DC 12',
  });
  if (checkPassed(morale)) {
    push(s, 'combat', 'The remaining foes snarl and hold their ground.', morale);
    return;
  }
  push(
    s,
    'combat',
    `The survivors' nerve breaks! ${living.map((e) => e.name).join(', ')} scatter shrieking into the dark.`,
    morale,
  );
  for (const e of living) e.hp.current = 0;
  resolveVictory(s, adv, true);
}

function enterRoom(s: GameState, adv: Adventure, roomId: string) {
  if (!adv.roomsById[roomId]) {
    push(s, 'error', 'That passage leads nowhere (missing room).');
    return;
  }
  tickLight(s);
  s.prevRoomId = s.currentRoomId;
  s.currentRoomId = roomId;
  const firstTime = !s.visited.includes(roomId);
  if (firstTime) s.visited.push(roomId);
  describeRoom(s, adv, firstTime);
  maybeStartCombat(s, adv);
  if (s.mode === 'explore') {
    const room = currentRoom(s, adv);
    if (room.objective) winGame(s, room);
  }
}

function winGame(s: GameState, room: AdvRoom) {
  s.mode = 'over';
  s.outcome = 'win';
  s.combat = undefined;
  push(s, 'win', room.winText ?? 'You have triumphed! The adventure is won.');
  const loot = s.inventory.filter((i) => i.gold || i.description);
  if (loot.length) push(s, 'result', `Spoils carried out: ${s.inventory.map((i) => i.name).join(', ')}.`);
}

function resolveDefeat(s: GameState) {
  s.mode = 'over';
  s.outcome = 'lose';
  s.combat = undefined;
  push(s, 'lose', 'The whole party has fallen. Darkness takes the dungeon... (Your saved heroes are unharmed — return to the portal to try again.)');
}

function resolveVictory(s: GameState, adv: Adventure, fled = false) {
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  if (enc?.flag && !s.flags.includes(enc.flag)) s.flags.push(enc.flag);
  push(s, 'result', fled ? 'The field is yours — the foes have fled!' : enc?.victoryText ?? 'The enemies are defeated!');
  if (enc?.loot?.length) {
    for (const it of enc.loot) s.extraItems.push({ roomId: room.id, item: it });
    push(s, 'system', `Left behind: ${enc.loot.map((i) => i.name).join(', ')}.`);
  }
  s.combat = undefined;
  s.mode = 'explore';
  for (const m of s.party) m.acted = false;
  if (room.objective) {
    winGame(s, room);
    return;
  }
  const exits = visibleExits(s, room);
  push(s, 'system', `Exits: ${exits.map((e) => normalizeDir(e.dir) ?? e.dir).join(', ')}.`);
}

/** End a fight peacefully (a won parley). Like victory, but no killing. */
function resolvePeace(s: GameState, adv: Adventure, grantsFlag?: string) {
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  if (enc?.flag && !s.flags.includes(enc.flag)) s.flags.push(enc.flag);
  if (grantsFlag && !s.flags.includes(grantsFlag)) s.flags.push(grantsFlag);
  s.combat = undefined;
  s.mode = 'explore';
  for (const m of s.party) m.acted = false;
  if (room.objective) {
    winGame(s, room);
    return;
  }
  const exits = visibleExits(s, room);
  push(s, 'system', `Exits: ${exits.map((e) => normalizeDir(e.dir) ?? e.dir).join(', ')}.`);
}

function findEnemy(s: GameState, token: string): EnemyState | undefined {
  const alive = livingEnemies(s);
  if (!token) return alive[0];
  // Filler-tolerant match so "The Haunt of Dalnir" / "Xalgoz the Vampire" resolve
  // even though the parser strips "the"/"of" from the typed (or tapped) target.
  return alive.find((e) => nameMatches(token, e.name));
}

// ───────── command handlers ─────────

function doMove(s: GameState, adv: Adventure, token: string | undefined) {
  if (s.mode === 'combat') {
    push(s, 'system', 'You are locked in combat! Defeat the foes or "flee".');
    return;
  }
  const room = currentRoom(s, adv);
  const dir = normalizeDir(token);
  let exit = dir ? room.exits.find((e) => normalizeDir(e.dir) === dir) : undefined;
  if (!exit && token) {
    exit = room.exits.find((e) => (e.label ?? '').toLowerCase().includes(token) || e.to.includes(token));
  }
  if (!exit) {
    push(s, 'error', `You can't go ${token ? `"${token}"` : 'that way'}.`);
    return;
  }
  if (exit.lockedBy && !s.flags.includes(exit.lockedBy)) {
    push(s, 'system', exit.lockedText ?? 'That way is blocked.');
    return;
  }
  enterRoom(s, adv, exit.to);
}

function doLook(s: GameState, adv: Adventure) {
  describeRoom(s, adv, false);
  if (s.mode === 'combat') {
    const foes = livingEnemies(s);
    push(s, 'combat', `Still standing: ${foes.map((e) => `${e.name} (${e.hp.current}/${e.hp.max})`).join(', ')}.`);
  }
}

function doExamine(s: GameState, adv: Adventure, target: string) {
  if (!target) {
    doLook(s, adv);
    return;
  }
  const room = currentRoom(s, adv);
  const feature = room.features.find((f) => f.keywords.some((k) => target.includes(k) || k.includes(target)));
  if (feature && (!feature.hidden || s.searched.includes(room.id))) {
    push(s, 'result', feature.text);
    return;
  }
  const item =
    roomItems(s, room).find((i) => nameMatches(target, i.name)) ??
    s.inventory.find((i) => nameMatches(target, i.name));
  if (item) {
    push(s, 'result', item.description ?? `It's ${item.name}. Nothing more to learn.`);
    return;
  }
  const npc = room.npcs.find((n) => n.keywords.some((k) => target.includes(k)));
  if (npc) {
    push(s, 'result', `${npc.name} is here. Try: talk to ${npc.keywords[0]}.`);
    return;
  }
  const enemy = s.combat && findEnemy(s, target);
  if (enemy) {
    push(s, 'combat', `${enemy.name}: ${enemy.hp.current}/${enemy.hp.max} HP, AC ${enemy.ac}.`);
    return;
  }
  const member = s.party.find((m) => nameMatches(target, m.name));
  if (member) {
    push(s, 'result', `${member.name}: ${member.hp.current}/${member.hp.max} HP, AC ${member.ac}, ${member.weaponName}.`);
    return;
  }
  push(s, 'result', 'You see nothing special about that.');
}

function doSearch(s: GameState, adv: Adventure) {
  if (inDarkness(s)) {
    push(s, 'result', 'You grope blindly in the dark and find nothing but cold stone. You need light to search.');
    return;
  }
  const room = currentRoom(s, adv);
  const already = s.searched.includes(room.id);
  if (!already) s.searched.push(room.id);
  let found = false;
  if (room.searchText) {
    push(s, 'result', room.searchText);
    found = true;
  }
  for (const f of room.features.filter((f) => f.hidden)) {
    push(s, 'result', f.text);
    found = true;
  }
  const items = roomItems(s, room);
  if (items.length) {
    push(s, 'system', `You find: ${items.map((i) => i.name).join(', ')}.`);
    found = true;
  }
  if (!found) push(s, 'result', 'You search carefully but find nothing of interest.');
}

function doTake(s: GameState, adv: Adventure, target: string) {
  if (!target) {
    push(s, 'system', 'Take what?');
    return;
  }
  const room = currentRoom(s, adv);
  const items = roomItems(s, room);
  const item = items.find((i) => nameMatches(target, i.name));
  if (!item) {
    push(s, 'error', `There's no "${target}" here to take.`);
    return;
  }
  s.takenItems.push(itemKey(room.id, item.name));
  // Torch caches become spare torches, not pack loot.
  if (item.torches) {
    s.light.spares += item.torches;
    push(
      s,
      'result',
      `Taken: ${item.name}. +${item.torches} torch${item.torches === 1 ? '' : 'es'} for the packs (${s.light.spares} spare${s.light.spares === 1 ? '' : 's'} now).`,
    );
    return;
  }
  s.inventory.push(item);
  push(s, 'result', `Taken: ${item.name}.`);
}

function doDrop(s: GameState, adv: Adventure, target: string) {
  if (!target) {
    push(s, 'system', 'Drop what?');
    return;
  }
  const idx = s.inventory.findIndex((i) => nameMatches(target, i.name));
  if (idx < 0) {
    push(s, 'error', `You aren't carrying "${target}".`);
    return;
  }
  const [item] = s.inventory.splice(idx, 1);
  const room = currentRoom(s, adv);
  s.extraItems.push({ roomId: room.id, item });
  // allow re-taking
  s.takenItems = s.takenItems.filter((k) => k !== itemKey(room.id, item.name));
  push(s, 'result', `Dropped: ${item.name}.`);
}

function doInventory(s: GameState) {
  if (!s.inventory.length) {
    push(s, 'system', 'Your packs hold only torches, rope, and grit — nothing notable picked up yet.');
    return;
  }
  const gold = s.inventory.reduce((sum, i) => sum + (i.gold ?? 0), 0);
  push(
    s,
    'system',
    `Carrying: ${s.inventory.map((i) => i.name).join(', ')}.${gold ? ` (worth about ${gold}gp)` : ''}`,
  );
}

function doTalk(s: GameState, adv: Adventure, target: string) {
  const room = currentRoom(s, adv);
  if (!room.npcs.length) {
    push(s, 'system', 'There is no one here to talk to.');
    return;
  }
  const npc = target
    ? room.npcs.find((n) => n.keywords.some((k) => target.includes(k) || k.includes(target)))
    : room.npcs[0];
  if (!npc) {
    push(s, 'system', `You don't see "${target}" to talk to.`);
    return;
  }
  push(s, 'result', `${npc.name}: "${npc.text}"`);
  if (npc.setsFlag && !s.flags.includes(npc.setsFlag)) s.flags.push(npc.setsFlag);
}

function doAttack(s: GameState, adv: Adventure, target: string) {
  if (s.mode !== 'combat' || !s.combat) {
    push(s, 'system', "There's nothing to fight here.");
    return;
  }
  const member = activeMember(s);
  if (!member || member.hp.current <= 0) {
    advanceTurn(s, adv);
    return;
  }
  const enemy = findEnemy(s, target);
  if (!enemy) {
    push(s, 'system', target ? `There's no "${target}" to attack.` : 'No foes remain.');
    return;
  }
  const dark = inDarkness(s);
  const parts: RollPart[] = [{ label: member.weaponName, value: member.attackMod }];
  if (member.atkBonus) parts.push({ label: 'blessed', value: member.atkBonus });
  const atk = checkRoll({
    kind: 'attack',
    side: 'hero',
    title: `${member.name} attacks ${enemy.name}`,
    mode: dark ? 'disadvantage' : 'normal',
    parts,
    target: enemy.ac,
    targetLabel: `AC ${enemy.ac}`,
  });
  if (atk.outcome === 'fumble') {
    push(s, 'combat', `${member.name} swings at ${enemy.name} and fumbles!${dark ? ' (blind in the dark)' : ''}`, atk);
  } else if (checkPassed(atk)) {
    const crit = atk.outcome === 'crit';
    push(s, 'combat', `${member.name} hits ${enemy.name}${crit ? ' — CRITICAL HIT!' : ''} (${atk.total} vs AC ${enemy.ac})`, atk);
    const dmg = damageRoll({
      side: 'hero',
      title: `${member.name} — ${member.weaponName} damage`,
      damage: `1${member.damageDie}${formatMod(member.damageMod + member.dmgBonus)}`,
      crit,
    });
    enemy.hp.current = Math.max(0, enemy.hp.current - dmg.total);
    push(s, 'combat', `${enemy.name} takes ${dmg.total} damage. (${enemy.hp.current}/${enemy.hp.max} HP)`, dmg);
    if (enemy.hp.current <= 0) push(s, 'combat', `${enemy.name} is defeated!`);
  } else {
    push(s, 'combat', `${member.name} attacks ${enemy.name} but misses. (${atk.total} vs AC ${enemy.ac})`, atk);
  }
  member.acted = true;
  if (livingEnemies(s).length === 0) {
    resolveVictory(s, adv);
    return;
  }
  maybeMorale(s, adv);
  if (s.mode === 'combat') advanceTurn(s, adv);
}

function doFlee(s: GameState, adv: Adventure) {
  if (s.mode !== 'combat') {
    push(s, 'system', 'There is nothing to flee from.');
    return;
  }
  const back = s.prevRoomId;
  if (!back) {
    push(s, 'system', 'There is nowhere to run!');
    return;
  }
  s.combat = undefined;
  s.mode = 'explore';
  push(s, 'result', 'You break off the fight and retreat the way you came!');
  enterRoom(s, adv, back);
}

// A parley lever that is satisfied right now, with the bonus it contributes.
interface ActiveMod {
  label: string;
  bonus: number;
  /** Inventory item surrendered on success, if this is a consumed offering. */
  offerName?: string;
  /** HP each conscious hero gives up on success. */
  sacrificeHp?: number;
}

/** Which of a parley's modifiers apply now (offering held, secret known, faction
 *  won, or an always-available costly gesture) and what each adds to the check. */
function activeParleyMods(s: GameState, parley: AdvParley): ActiveMod[] {
  const out: ActiveMod[] = [];
  for (const m of parley.modifiers ?? []) {
    if (m.offer) {
      const idx = s.inventory.findIndex((i) => nameMatches(m.offer!, i.name));
      if (idx >= 0) {
        out.push({ label: m.label ?? `offering the ${m.offer}`, bonus: m.bonus, offerName: m.consume === false ? undefined : m.offer });
      }
    } else if (m.knows) {
      if (s.flags.includes(m.knows)) out.push({ label: m.label ?? 'what you have learned', bonus: m.bonus });
    } else if (m.allied) {
      if (s.flags.includes(m.allied)) out.push({ label: m.label ?? 'your alliance', bonus: m.bonus });
    } else if (m.sacrificeHp) {
      out.push({ label: m.label ?? 'a costly gesture', bonus: m.bonus, sacrificeHp: m.sacrificeHp });
    }
  }
  return out;
}

function clampNeeds(n: number): number {
  return Math.max(1, Math.min(21, n));
}

export interface ParleyForecast {
  dc: number;
  chaMod: number;
  mods: { label: string; bonus: number }[];
  /** chaMod + sum of active modifier bonuses: the fixed part of the roll. */
  total: number;
  /** d20 result needed to hit the DC (1..21; 21 means only a natural 20 works). */
  needs: number;
  /** Set when a hard gate blocks the parley outright. */
  gatedBy?: string;
}

/** Read-only forecast of the current parley, for the play UI. Null when there is
 *  nothing here to talk to (no scripted parley and no foe that would listen). */
export function parleyOdds(s: GameState, adv: Adventure): ParleyForecast | null {
  if (s.mode !== 'combat' || !s.combat) return null;
  const cha = bestChaMod(s);
  const parley = currentRoom(s, adv).encounter?.parley;
  if (!parley) {
    if (!livingEnemies(s).some(canReason)) return null;
    return { dc: 13, chaMod: cha, mods: [], total: cha, needs: clampNeeds(13 - cha) };
  }
  if (parley.requiresFlag && !s.flags.includes(parley.requiresFlag)) {
    return { dc: parley.dc, chaMod: cha, mods: [], total: cha, needs: clampNeeds(parley.dc - cha), gatedBy: parley.requiresFlag };
  }
  const active = activeParleyMods(s, parley);
  const total = cha + active.reduce((a, m) => a + m.bonus, 0);
  return {
    dc: parley.dc,
    chaMod: cha,
    mods: active.map((m) => ({ label: m.label, bonus: m.bonus })),
    total,
    needs: clampNeeds(parley.dc - total),
  };
}

function doParley(s: GameState, adv: Adventure) {
  if (s.mode !== 'combat' || !s.combat) {
    push(s, 'system', 'There is no one here to bargain with. (Try "talk" to speak with someone.)');
    return;
  }
  const room = currentRoom(s, adv);
  const parley = room.encounter?.parley;
  const foes = livingEnemies(s);
  const cha = bestChaMod(s);

  // No scripted deal: only intelligent foes will even listen, and it is a plain
  // CHA reaction roll with no levers to pull.
  if (!parley) {
    if (!foes.some(canReason)) {
      push(s, 'result', 'These are not foes you can reason with. There is no talking your way out of this one.');
      return;
    }
    const r = checkRoll({
      kind: 'parley',
      side: 'hero',
      title: 'The party negotiates',
      parts: [{ label: 'CHA', value: cha }],
      target: 13,
      targetLabel: 'DC 13',
    });
    if (checkPassed(r)) {
      push(s, 'result', 'You talk fast and well. The foes weigh the fight, decide you are not worth dying for, and withdraw into the dark.', r);
      resolvePeace(s, adv);
    } else {
      push(s, 'result', 'They are in no mood to talk. The fight goes on.', r);
      advanceTurn(s, adv);
    }
    return;
  }

  // Hard gate: some foes will not hear a word until you have done something first.
  if (parley.requiresFlag && !s.flags.includes(parley.requiresFlag)) {
    push(s, 'result', parley.failureText ?? 'They will not be moved. Not yet.');
    return;
  }

  // Everything else is one CHA speech check, lifted by whatever legwork you did:
  // offerings in hand, secrets learned, factions won, a costly gesture offered.
  const active = activeParleyMods(s, parley);
  if (active.length) {
    push(s, 'result', `Weighing in your favor: ${active.map((m) => `${m.label} (+${m.bonus})`).join(', ')}.`);
  }
  const r = checkRoll({
    kind: 'parley',
    side: 'hero',
    title: 'The party negotiates',
    parts: [{ label: 'CHA', value: cha }, ...active.map((m) => ({ label: m.label, value: m.bonus }))],
    target: parley.dc,
    targetLabel: `DC ${parley.dc}`,
  });
  if (!checkPassed(r)) {
    push(s, 'result', parley.failureText ?? 'The bargain falls flat. The fight goes on.', r);
    advanceTurn(s, adv);
    return;
  }
  push(s, 'result', 'Your words find their mark.', r);

  // Success: surrender offered items and pay any toll, then make peace.
  for (const m of active) {
    if (!m.offerName) continue;
    const idx = s.inventory.findIndex((i) => nameMatches(m.offerName!, i.name));
    if (idx >= 0) {
      const [given] = s.inventory.splice(idx, 1);
      push(s, 'result', `You give up the ${given.name}. It is gone for good.`);
    }
  }
  const toll = active.reduce((a, m) => a + (m.sacrificeHp ?? 0), 0);
  if (toll > 0) {
    for (const m of consciousParty(s)) {
      m.hp.max = Math.max(1, m.hp.max - toll);
      m.hp.current = Math.max(1, Math.min(m.hp.current, m.hp.max));
    }
    push(s, 'result', `The bargain takes its toll: each hero is left worn for good (-${toll} HP).`);
  }
  push(s, 'result', parley.successText);
  resolvePeace(s, adv, parley.grantsFlag);
}

// ───────── spellcasting ─────────
//
// A spell's combat behavior comes from its `combat` block in spells.yaml, so new
// combat spells are a data edit. The engine handles these `kind`s; anything else
// (or no combat block) does nothing useful in a fight.

const CHARMABLE = new Set(['humanoid', 'goblinoid', 'gnoll', 'kobold']);

function findMember(s: GameState, token: string): PartyMemberState | undefined {
  return token ? s.party.find((m) => nameMatches(token, m.name)) : undefined;
}

function mostHurt(s: GameState): PartyMemberState | undefined {
  const hurt = consciousParty(s).filter((m) => m.hp.current < m.hp.max);
  if (!hurt.length) return undefined;
  return hurt.reduce((a, b) => (a.hp.max - a.hp.current >= b.hp.max - b.hp.current ? a : b));
}

function doCast(s: GameState, adv: Adventure, spellArg: string, targetToken: string) {
  if (s.mode !== 'combat' || !s.combat) {
    push(s, 'system', 'There is nothing to cast at here.');
    return;
  }
  const combat = s.combat;
  const member = activeMember(s);
  if (!member || member.hp.current <= 0) {
    push(s, 'system', 'No conscious caster is ready.');
    return;
  }
  if (!member.spells.length) {
    push(s, 'system', `${member.name} knows no spells.`);
    return;
  }
  if (!spellArg) {
    push(s, 'system', `${member.name} knows: ${member.spells.join(', ')}. Try "cast <spell>".`);
    return;
  }
  const known = member.spells.find((sp) => nameMatches(spellArg, sp));
  if (!known) {
    push(s, 'system', `${member.name} doesn't know "${spellArg}". They know: ${member.spells.join(', ')}.`);
    return;
  }
  if (member.spentSpells.includes(known)) {
    push(s, 'result', `${member.name} already lost ${known} this fight. It returns after a rest.`);
    return;
  }
  const spell = getSpell(known);
  const fx: SpellCombat = spell?.combat ?? { kind: 'none' };
  if (fx.kind === 'none') {
    push(s, 'result', `${member.name} could cast ${known}, but it would do nothing useful in a fight.`);
    return; // no turn lost
  }

  const dc = 10 + (spell?.tier ?? 1);
  const check = checkRoll({
    kind: 'cast',
    side: 'hero',
    title: `${member.name} casts ${known}`,
    parts: [{ label: 'spellcasting', value: member.spellMod }],
    target: dc,
    targetLabel: `DC ${dc}`,
  });
  if (!checkPassed(check)) {
    push(s, 'combat', `${member.name}'s ${known} sputters and slips away. (${check.total} vs DC ${dc}) Lost until they rest.`, check);
    member.spentSpells.push(known);
    member.acted = true;
    advanceTurn(s, adv);
    return;
  }
  push(s, 'combat', `${member.name}'s ${known} takes hold!${check.outcome === 'crit' ? ' A perfect casting!' : ''}`, check);

  switch (fx.kind) {
    case 'damage': {
      const enemy = findEnemy(s, targetToken);
      if (!enemy) {
        push(s, 'combat', 'There is no foe left to strike.');
        break;
      }
      const dmg = damageRoll({ side: 'hero', title: `${known} damage`, damage: fx.dice ?? '1d6', crit: check.outcome === 'crit' });
      enemy.hp.current = Math.max(0, enemy.hp.current - dmg.total);
      push(s, 'combat', `${member.name}'s ${known} strikes ${enemy.name} for ${dmg.total}!`, dmg);
      if (enemy.hp.current <= 0) push(s, 'combat', `${enemy.name} is destroyed!`);
      break;
    }
    case 'heal': {
      const target = findMember(s, targetToken) ?? mostHurt(s) ?? member;
      const heal = damageRoll({ side: 'hero', title: `${known} healing`, damage: fx.dice ?? '1d6', kind: 'heal', crit: check.outcome === 'crit' });
      const before = target.hp.current;
      target.hp.current = Math.min(target.hp.max, target.hp.current + heal.total);
      push(s, 'combat', `${member.name}'s ${known} mends ${target.name} for ${target.hp.current - before} HP. (${target.hp.current}/${target.hp.max})`, heal);
      break;
    }
    case 'turn': {
      const undead = livingEnemies(s).filter((e) => e.tags.includes('undead') && !e.tags.includes('boss'));
      if (!undead.length) {
        push(s, 'combat', `${member.name} brandishes holy power, but nothing here is undead enough to flee.`);
        break;
      }
      combat.enemies = combat.enemies.filter((e) => !undead.includes(e));
      push(s, 'combat', `${member.name} turns the undead! ${undead.map((e) => e.name).join(', ')} flee shrieking into the dark.`);
      break;
    }
    case 'sleep': {
      const budget = rollDamageTotal('2d8', false, 'Sleep');
      const sorted = livingEnemies(s)
        .filter((e) => !e.tags.includes('boss'))
        .sort((a, b) => a.hp.current - b.hp.current);
      const put: EnemyState[] = [];
      let spent = 0;
      for (const e of sorted) {
        if (spent + e.hp.max <= budget) {
          put.push(e);
          spent += e.hp.max;
        }
      }
      if (!put.length) {
        push(s, 'combat', `${member.name}'s Sleep washes over the foes, but they are too strong to drop.`);
        break;
      }
      combat.enemies = combat.enemies.filter((e) => !put.includes(e));
      push(s, 'combat', `${member.name}'s Sleep takes hold. ${put.map((e) => e.name).join(', ')} crumple into slumber.`);
      break;
    }
    case 'charm': {
      const alive = livingEnemies(s);
      const target =
        (targetToken ? findEnemy(s, targetToken) : undefined) ?? alive.find((e) => e.tags.some((t) => CHARMABLE.has(t)));
      if (!target || !target.tags.some((t) => CHARMABLE.has(t))) {
        push(s, 'combat', `${member.name}'s charm finds nothing here willing to heed it.`);
        break;
      }
      combat.enemies = combat.enemies.filter((e) => e !== target);
      push(s, 'combat', `${member.name} charms ${target.name}; it lowers its weapon and wanders off, suddenly friendly.`);
      break;
    }
    case 'buff-ac': {
      const target = fx.self ? member : findMember(s, targetToken) ?? member;
      const amount = fx.amount ?? 2;
      target.acBonus += amount;
      push(s, 'combat', `${member.name}'s ${known} wards ${target.name}: +${amount} AC for the fight.`);
      break;
    }
    case 'buff-atk': {
      const target = findMember(s, targetToken) ?? member;
      const atk = fx.atk ?? 1;
      const dmg = fx.dmg ?? 1;
      target.atkBonus += atk;
      target.dmgBonus += dmg;
      push(s, 'combat', `${member.name}'s ${known} blesses ${target.name}'s weapon: +${atk} to hit, +${dmg} damage for the fight.`);
      break;
    }
  }

  member.acted = true;
  if (livingEnemies(s).length === 0) {
    resolveVictory(s, adv);
    return;
  }
  maybeMorale(s, adv);
  if (s.mode === 'combat') advanceTurn(s, adv);
}

function doWho(s: GameState) {
  push(s, 'system', 'Your party:');
  s.party.forEach((m, i) => {
    const down = m.hp.current <= 0 ? ' — DOWN' : '';
    const active = i === s.activeIndex && s.mode === 'combat' ? ' (active)' : '';
    push(s, 'system', `  ${m.name} — ${m.hp.current}/${m.hp.max} HP, AC ${m.ac}, ${m.weaponName}${active}${down}`);
  });
}

function doSelect(s: GameState, target: string) {
  if (s.mode === 'combat') {
    const now = activeMember(s);
    push(s, 'system', `No swapping mid-battle — initiative rules the field. It's ${now?.name ?? 'someone'}'s turn.`);
    return;
  }
  if (!target) {
    push(s, 'system', 'Select whom? Try: select <name>.');
    return;
  }
  const idx = s.party.findIndex((m) => nameMatches(target, m.name));
  if (idx < 0) {
    push(s, 'error', `No party member named "${target}".`);
    return;
  }
  if (s.party[idx].hp.current <= 0) {
    push(s, 'system', `${s.party[idx].name} is down and can't act.`);
    return;
  }
  s.activeIndex = idx;
  push(s, 'system', `${s.party[idx].name} is now active.`);
}

function doRest(s: GameState, adv: Adventure) {
  if (s.mode === 'combat') {
    push(s, 'system', 'No time to rest — there are enemies!');
    return;
  }
  const room = currentRoom(s, adv);
  const safe = room.safe || !room.encounter || (room.encounter.flag ? s.flags.includes(room.encounter.flag) : false);
  if (!safe) {
    push(s, 'system', 'It is too dangerous to rest here.');
    return;
  }
  if (s.rested.includes(room.id)) {
    push(s, 'system', 'You have already caught your breath here.');
    return;
  }
  s.rested.push(room.id);
  for (const m of s.party) {
    if (m.hp.current <= 0) {
      m.hp.current = 1;
      push(s, 'result', `${m.name} is roused back to their feet (1 HP).`);
    } else if (m.hp.current < m.hp.max) {
      const healed = rollDamageTotal('1d4+1', false, `${m.name} rests`);
      m.hp.current = Math.min(m.hp.max, m.hp.current + healed);
      push(s, 'result', `${m.name} recovers ${healed} HP (${m.hp.current}/${m.hp.max}).`);
    }
  }
}

function doLightTorch(s: GameState, adv: Adventure) {
  if (s.light.spares <= 0) {
    push(s, 'error', 'You have no torches left to light. The dark is yours to brave.');
    return;
  }
  if (s.light.lit > TORCH_LIFE / 2) {
    push(s, 'system', 'Your torch still burns bright — no need to waste a fresh one.');
    return;
  }
  const wasDark = inDarkness(s);
  s.light.spares -= 1;
  s.light.lit = TORCH_LIFE;
  push(
    s,
    'result',
    `You strike a fresh torch alight. ${wasDark ? 'The darkness leaps back and the dungeon returns in flickering orange.' : 'The flame steadies, tall and bright.'} (${s.light.spares} spare${s.light.spares === 1 ? '' : 's'} left)`,
  );
  // Fumbling with flint mid-battle costs your moment to act.
  if (s.mode === 'combat') advanceTurn(s, adv);
}

function doMap(s: GameState, adv: Adventure) {
  push(s, 'system', `You have explored ${s.visited.length} of ${adv.rooms.length} chambers. (Tap "Map" to see the dungeon plan.)`);
}

function doHelp(s: GameState) {
  push(
    s,
    'system',
    [
      'Commands you can type or tap:',
      '  Move: go <direction> (north/south/east/west/up/down/in/out), or just "north".',
      '  Look: look · examine <thing> · search',
      '  Items: take <item> · drop <item> · inventory',
      '  People: talk to <name>',
      '  Combat: attack <foe> · cast <spell> · negotiate · flee · who',
      '  Light: light torch (torches burn down as you explore and fight!)',
      '  Other: rest (in safe rooms) · map · help',
    ].join('\n'),
  );
}

// ───────── public API ─────────

/** Average party level, used as the default scaling target. */
function partyLevel(characters: Character[]): number {
  if (!characters.length) return 1;
  const sum = characters.reduce((s, c) => s + Math.max(1, c.level || 1), 0);
  return Math.max(1, Math.round(sum / characters.length));
}

export function createGame(adv: Adventure, characters: Character[], powerLevel?: number): GameState {
  const party: PartyMemberState[] = characters.map((c) => {
    const p = characterCombatProfile(c);
    return {
      id: c.id,
      name: c.name,
      portraitArtId: c.portraitArtId,
      className: c.classId,
      attackMod: p.attackMod,
      damageDie: p.damageDie,
      damageMod: p.damageMod,
      ac: p.ac,
      chaMod: statMod(c.stats.CHA),
      dexMod: statMod(c.stats.DEX),
      weaponName: p.weaponName,
      spells: c.spells ?? [],
      spellMod:
        c.classId === 'wizard'
          ? statMod(c.stats.INT)
          : c.classId === 'priest'
            ? statMod(c.stats.WIS)
            : Math.max(statMod(c.stats.INT), statMod(c.stats.WIS)),
      hp: { current: c.hp.current, max: c.hp.max },
      acted: false,
      spentSpells: [],
      atkBonus: 0,
      dmgBonus: 0,
      acBonus: 0,
    };
  });

  const s: GameState = {
    adventureId: adv.id,
    powerLevel: Math.max(1, powerLevel ?? partyLevel(characters)),
    currentRoomId: adv.start,
    party,
    activeIndex: 0,
    visited: [],
    inventory: [],
    flags: [],
    takenItems: [],
    extraItems: [],
    searched: [],
    rested: [],
    light: { lit: TORCH_LIFE, spares: 2 },
    mode: 'explore',
    transcript: [],
    messageSeq: 1,
  };

  if (adv.intro) push(s, 'system', adv.intro);
  push(s, 'system', `Party: ${party.map((m) => `${m.name} (${m.hp.current}/${m.hp.max} HP)`).join(', ')}.`);
  push(s, 'system', 'A fresh torch crackles to life at the head of the column — with two spares in the packs. Torches burn as you explore; keep an eye on the flame.');
  s.visited.push(adv.start);
  describeRoom(s, adv, true);
  maybeStartCombat(s, adv);
  if (s.mode === 'explore' && currentRoom(s, adv).objective) winGame(s, currentRoom(s, adv));
  push(s, 'system', 'Type "help" for commands, or tap an action below.');
  return s;
}

/** Patch a saved GameState from before the dungeon-crawler overhaul so old
 *  autosaves resume cleanly (adds torchlight, DEX mods, and initiative order). */
export function migrateGameState(state: GameState): GameState {
  const s = structuredClone(state);
  if (!s.light) s.light = { lit: TORCH_LIFE, spares: 2 };
  for (const m of s.party) {
    if (typeof m.dexMod !== 'number') m.dexMod = 0;
  }
  if (s.combat && !s.combat.order) {
    // A mid-fight save from the old engine: synthesize an order (heroes first)
    // without rolling dice or writing transcript lines.
    const order: TurnRef[] = [];
    for (const m of s.party) if (m.hp.current > 0) order.push({ side: 'hero', refId: m.id, name: m.name, init: 10 + m.dexMod });
    for (const e of s.combat.enemies) if (e.hp.current > 0) order.push({ side: 'enemy', refId: e.id, name: e.name, init: 9 });
    s.combat.order = order;
    s.combat.turnIndex = 0;
    s.combat.moraleChecked = true;
    s.activeIndex = firstConsciousIndex(s);
  }
  return s;
}

export function step(prev: GameState, adv: Adventure, raw: string): GameState {
  const s: GameState = structuredClone(prev);
  const input = raw.trim();
  if (!input) return s;
  push(s, 'echo', `> ${input}`);

  if (s.mode === 'over') {
    push(s, 'system', 'The adventure is over. Return to the portal to play again.');
    return s;
  }

  const tokens = input.toLowerCase().split(/\s+/);
  const verb = tokens[0];
  let rest = tokens.slice(1);

  // A direction word leads the command ("north", "d", "enter the tower").
  if (DIR_ALIASES[verb]) {
    doMove(s, adv, verb);
    return s;
  }

  switch (verb) {
    case 'go': case 'move': case 'walk': case 'head': case 'climb': case 'travel':
      doMove(s, adv, normalizeDir(rest.find((t) => !FILLER.has(t))) ?? rest.find((t) => !FILLER.has(t)));
      break;
    case 'look': case 'l':
      if (rest.length === 0) doLook(s, adv);
      else doExamine(s, adv, cleanTarget(rest));
      break;
    case 'examine': case 'x': case 'inspect': case 'check': case 'study': case 'read':
      doExamine(s, adv, cleanTarget(rest));
      break;
    case 'search': case 'loot':
      doSearch(s, adv);
      break;
    case 'take': case 'get': case 'grab': case 'collect': case 'steal':
      doTake(s, adv, cleanTarget(rest));
      break;
    case 'pick':
      doTake(s, adv, cleanTarget(rest[0] === 'up' ? rest.slice(1) : rest));
      break;
    case 'drop': case 'leave':
      doDrop(s, adv, cleanTarget(rest));
      break;
    case 'inventory': case 'inv': case 'i': case 'items': case 'bag':
      doInventory(s);
      break;
    case 'talk': case 'speak': case 'ask': case 'greet': case 'say':
      doTalk(s, adv, cleanTarget(rest));
      break;
    case 'attack': case 'fight': case 'hit': case 'kill': case 'strike': case 'stab': case 'slay': case 'shoot': {
      const withIdx = rest.indexOf('with');
      if (withIdx >= 0) rest = rest.slice(0, withIdx);
      doAttack(s, adv, cleanTarget(rest));
      break;
    }
    case 'flee': case 'run': case 'retreat': case 'escape':
      doFlee(s, adv);
      break;
    case 'negotiate': case 'parley': case 'bargain': case 'surrender': case 'persuade': case 'bribe':
      doParley(s, adv);
      break;
    case 'cast': case 'spell': case 'invoke': {
      let casted = rest;
      let spellTarget = '';
      const ti = casted.findIndex((t) => t === 'at' || t === 'on');
      if (ti >= 0) {
        spellTarget = cleanTarget(casted.slice(ti + 1));
        casted = casted.slice(0, ti);
      }
      doCast(s, adv, cleanTarget(casted), spellTarget);
      break;
    }
    case 'who': case 'party': case 'status':
      doWho(s);
      break;
    case 'select': case 'switch': case 'choose': case 'control':
      doSelect(s, cleanTarget(rest));
      break;
    case 'rest': case 'camp': case 'sleep': case 'recover':
      doRest(s, adv);
      break;
    case 'light': case 'torch': case 'relight':
      doLightTorch(s, adv);
      break;
    case 'map':
      doMap(s, adv);
      break;
    case 'help': case '?': case 'commands': case 'h':
      doHelp(s);
      break;
    default:
      push(s, 'error', `I don't understand "${input}". Type "help" for ideas.`);
  }

  return s;
}
