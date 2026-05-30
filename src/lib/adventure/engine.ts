// The text-adventure engine: pure functions over a serializable GameState.
//
// `createGame` seeds a playthrough from an Adventure + party. `step` interprets
// one typed (or tapped) command and returns the next state with new transcript
// lines appended. Combat is light Shadowdark: 1d20+mod vs AC, weapon die for
// damage, HP tracked per combatant. Every die roll goes through `rollAndLog`
// so it also shows up in the shared Dice log.

import { formatMod, pick, statMod } from '../dice';
import { rollAndLog } from '../rollLog';
import { getMonster } from '../shadowdark/monsters';
import { characterCombatProfile } from '../shadowdark/combat';
import type { Character } from '../shadowdark/types';
import type {
  Adventure,
  AdvEncounter,
  AdvExit,
  AdvItem,
  AdvRoom,
  EnemyState,
  GameState,
  MessageKind,
  PartyMemberState,
} from './types';

// ───────── small helpers ─────────

function push(s: GameState, kind: MessageKind, text: string) {
  s.transcript.push({ id: s.messageSeq++, kind, text });
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

function buildEnemies(enc: AdvEncounter): EnemyState[] {
  const monsters = enc.monsters.map(getMonster).filter((m): m is NonNullable<typeof m> => !!m);
  const totals: Record<string, number> = {};
  for (const m of monsters) totals[m.name] = (totals[m.name] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return monsters.map((m, i) => {
    seen[m.name] = (seen[m.name] ?? 0) + 1;
    const label = totals[m.name] > 1 ? `${m.name} ${seen[m.name]}` : m.name;
    return {
      id: `e${i}`,
      monsterId: m.id,
      name: label,
      ac: m.ac,
      hp: { current: m.hpMax, max: m.hpMax },
      attacks: m.attacks.map((a) => ({ name: a.name, bonus: a.bonus, damage: String(a.damage) })),
      tags: m.tags ?? [],
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

function maybeStartCombat(s: GameState, adv: Adventure) {
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  if (!enc) return;
  if (enc.flag && s.flags.includes(enc.flag)) return;
  const enemies = buildEnemies(enc);
  if (!enemies.length) return;
  s.combat = { encounterId: enc.id, enemies, round: 1 };
  s.mode = 'combat';
  for (const m of s.party) m.acted = false;
  s.activeIndex = firstConsciousIndex(s);
  if (enc.intro) push(s, 'combat', enc.intro);
  push(s, 'combat', `Foes: ${enemies.map((e) => `${e.name} (AC ${e.ac}, HP ${e.hp.max})`).join(', ')}.`);
  if (enc.parley?.prompt) push(s, 'combat', enc.parley.prompt);
  const canTalk = !!enc.parley || enemies.some(canReason);
  push(
    s,
    'system',
    `Round 1 — ${activeMember(s)?.name ?? 'the party'}'s move. You can attack, "flee"${canTalk ? ', or "negotiate"' : ''}.`,
  );
}

function enterRoom(s: GameState, adv: Adventure, roomId: string) {
  if (!adv.roomsById[roomId]) {
    push(s, 'error', 'That passage leads nowhere (missing room).');
    return;
  }
  s.prevRoomId = s.currentRoomId;
  s.currentRoomId = roomId;
  const firstTime = !s.visited.includes(roomId);
  if (firstTime) s.visited.push(roomId);
  describeRoom(s, adv, firstTime);
  maybeStartCombat(s, adv);
  if (s.mode !== 'combat') {
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

function resolveVictory(s: GameState, adv: Adventure) {
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  if (enc?.flag && !s.flags.includes(enc.flag)) s.flags.push(enc.flag);
  push(s, 'result', enc?.victoryText ?? 'The enemies are defeated!');
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

function enemyTurn(s: GameState) {
  const enemies = livingEnemies(s);
  for (const enemy of enemies) {
    const targets = consciousParty(s);
    if (!targets.length) break;
    const target = pick(targets);
    const attack = enemy.attacks[0] ?? { name: 'Strike', bonus: 0, damage: '1d4' };
    const atk = rollAndLog(`1d20${formatMod(attack.bonus)}`, 'normal', `${enemy.name} attacks ${target.name}`);
    if (atk.isFumble) {
      push(s, 'combat', `${enemy.name} lunges at ${target.name} and misses.`);
      continue;
    }
    if (atk.isCrit || atk.total >= target.ac) {
      const crit = atk.isCrit;
      const dealt = rollDamageTotal(attack.damage, crit, `${enemy.name} ${attack.name}`);
      target.hp.current = Math.max(0, target.hp.current - dealt);
      push(
        s,
        'combat',
        `${enemy.name} hits ${target.name}${crit ? ' — critical!' : ''} for ${dealt}. (${target.name}: ${target.hp.current}/${target.hp.max} HP)`,
      );
      if (target.hp.current <= 0) push(s, 'combat', `${target.name} is knocked out!`);
    } else {
      push(s, 'combat', `${enemy.name} attacks ${target.name} but misses. (rolled ${atk.total} vs AC ${target.ac})`);
    }
  }
  if (consciousParty(s).length === 0) {
    resolveDefeat(s);
    return;
  }
  // New round.
  for (const m of s.party) m.acted = false;
  if (s.combat) s.combat.round += 1;
  s.activeIndex = firstConsciousIndex(s);
  push(s, 'system', `Round ${s.combat?.round ?? '?'} — ${activeMember(s)?.name ?? 'the party'}'s move.`);
}

function advanceActive(s: GameState) {
  const next = s.party.findIndex((m) => m.hp.current > 0 && !m.acted);
  if (next >= 0) {
    s.activeIndex = next;
    push(s, 'system', `${s.party[next].name}'s move.`);
  } else {
    enemyTurn(s);
  }
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
  let member = activeMember(s);
  if (!member || member.hp.current <= 0) {
    advanceActive(s);
    member = activeMember(s);
    if (!member || member.hp.current <= 0) return;
  }
  const enemy = findEnemy(s, target);
  if (!enemy) {
    push(s, 'system', target ? `There's no "${target}" to attack.` : 'No foes remain.');
    return;
  }
  const atk = rollAndLog(`1d20${formatMod(member.attackMod)}`, 'normal', `${member.name} attacks ${enemy.name}`);
  if (atk.isFumble) {
    push(s, 'combat', `${member.name} swings at ${enemy.name} and fumbles! (rolled ${atk.total})`);
  } else if (atk.isCrit || atk.total >= enemy.ac) {
    const crit = atk.isCrit;
    const dealt = rollDamageTotal(`1${member.damageDie}${formatMod(member.damageMod)}`, crit, `${member.name} damage`);
    enemy.hp.current = Math.max(0, enemy.hp.current - dealt);
    push(
      s,
      'combat',
      `${member.name} hits ${enemy.name}${crit ? ' — critical hit!' : ''} for ${dealt}. (attack ${atk.total} vs AC ${enemy.ac})`,
    );
    if (enemy.hp.current <= 0) push(s, 'combat', `${enemy.name} is defeated!`);
  } else {
    push(s, 'combat', `${member.name} attacks ${enemy.name} but misses. (rolled ${atk.total} vs AC ${enemy.ac})`);
  }
  member.acted = true;
  if (livingEnemies(s).length === 0) {
    resolveVictory(s, adv);
    return;
  }
  advanceActive(s);
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

function doParley(s: GameState, adv: Adventure) {
  if (s.mode !== 'combat' || !s.combat) {
    push(s, 'system', 'There is no one here to bargain with. (Try "talk" to speak with someone.)');
    return;
  }
  const room = currentRoom(s, adv);
  const enc = room.encounter;
  const parley = enc?.parley;
  const foes = livingEnemies(s);
  const cha = bestChaMod(s);

  // No scripted deal on offer: only intelligent foes will even listen.
  if (!parley) {
    if (!foes.some(canReason)) {
      push(s, 'result', 'These are not foes you can reason with. There is no talking your way out of this one.');
      return;
    }
    const r = rollAndLog(`1d20${formatMod(cha)}`, 'normal', 'Party negotiates');
    if (r.isCrit || r.total >= 13) {
      push(s, 'result', 'You talk fast and well. The foes weigh the fight, decide you are not worth dying for, and withdraw into the dark.');
      resolvePeace(s, adv);
    } else {
      push(s, 'result', 'They are in no mood to talk. The fight goes on.');
      enemyTurn(s);
    }
    return;
  }

  // Scripted deal. A required item or flag closes it without a roll.
  // Gate: some deals only open once you've done something first (freed someone, etc.).
  if (parley.requiresFlag && !s.flags.includes(parley.requiresFlag)) {
    push(s, 'result', parley.failureText ?? 'They will not be moved. Not yet.');
    return;
  }

  // Can you pay the price they're asking?
  const payIdx = parley.costItem ? s.inventory.findIndex((i) => nameMatches(parley.costItem!, i.name)) : -1;
  const canPay = payIdx >= 0;

  const succeed = () => {
    if (canPay) {
      const [given] = s.inventory.splice(payIdx, 1);
      push(s, 'result', `You give up the ${given.name}. It is gone for good.`);
    }
    if (parley.costHp && parley.costHp > 0) {
      for (const m of consciousParty(s)) {
        m.hp.max = Math.max(1, m.hp.max - parley.costHp);
        m.hp.current = Math.max(1, Math.min(m.hp.current, m.hp.max));
      }
      push(s, 'result', `The price comes out of flesh and nerve. Each hero is left worn for good (-${parley.costHp} HP).`);
    }
    push(s, 'result', parley.successText);
    resolvePeace(s, adv, parley.grantsFlag);
  };

  // Paying the named price always works.
  if (canPay) {
    succeed();
    return;
  }

  // No price in hand. A silver tongue can still try, if the foe will hear words at all.
  if (parley.dc != null) {
    const r = rollAndLog(`1d20${formatMod(cha)}`, 'normal', 'Party negotiates');
    if (r.isCrit || r.total >= parley.dc) {
      succeed();
    } else {
      push(s, 'result', parley.failureText ?? 'The bargain falls flat. The fight goes on.');
      enemyTurn(s);
    }
    return;
  }

  // No price, no words will do: they want one specific thing you don't have.
  push(s, 'result', parley.failureText ?? 'There is something they want, and you do not have it. There will be no bargain.');
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
      '  Combat: attack <foe> · negotiate · flee · who · select <name>',
      '  Other: rest (in safe rooms) · map · help',
    ].join('\n'),
  );
}

// ───────── public API ─────────

export function createGame(adv: Adventure, characters: Character[]): GameState {
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
      weaponName: p.weaponName,
      hp: { current: c.hp.current, max: c.hp.max },
      acted: false,
    };
  });

  const s: GameState = {
    adventureId: adv.id,
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
    mode: 'explore',
    transcript: [],
    messageSeq: 1,
  };

  if (adv.intro) push(s, 'system', adv.intro);
  push(s, 'system', `Party: ${party.map((m) => `${m.name} (${m.hp.current}/${m.hp.max} HP)`).join(', ')}.`);
  s.visited.push(adv.start);
  describeRoom(s, adv, true);
  maybeStartCombat(s, adv);
  if (s.mode !== 'combat' && currentRoom(s, adv).objective) winGame(s, currentRoom(s, adv));
  push(s, 'system', 'Type "help" for commands, or tap an action below.');
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
    case 'who': case 'party': case 'status':
      doWho(s);
      break;
    case 'select': case 'switch': case 'choose': case 'control':
      doSelect(s, cleanTarget(rest));
      break;
    case 'rest': case 'camp': case 'sleep': case 'recover':
      doRest(s, adv);
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
