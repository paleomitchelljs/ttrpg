// Turn-based combat: initiative, turn loop, attack + breath resolution,
// morale, death and flight. Pure logic, no DOM. Every function returns an
// array of events the view narrates. The UI drives the loop:
// runMonsterTurns() until it is the dragon's turn, then wait for
// playerAttack() or playerBreath().

import {
  resolveAttack,
  rollInitiative,
  resolveBreathOn,
  rollBreathRecharge,
  moraleCheck,
} from './rules.js';
import { roll } from './dice.js';

const alive = (c) => c.hp.current > 0 && !c.fled;

export function currentCombatant(combat) {
  return combat.order[combat.turnIndex];
}

export function livingMonsters(combat) {
  return combat.order.filter((c) => c.kind !== 'dragon' && alive(c));
}

export function dragonOf(combat) {
  return combat.order.find((c) => c.kind === 'dragon');
}

export function isPlayerTurn(combat) {
  return !combat.over && currentCombatant(combat).kind === 'dragon';
}

/** Roll initiative and build combat state. Breath starts charged. */
export function createCombat(dragon, monsters, rng = Math.random) {
  const combatants = [dragon, ...monsters];
  for (const c of combatants) c.initiative = rollInitiative(c, rng);
  // Ties go to the dragon (kind to the kid at the table).
  const order = [...combatants].sort(
    (a, b) => b.initiative - a.initiative || (a.kind === 'dragon' ? -1 : 1)
  );
  const combat = {
    combatants,
    order,
    turnIndex: 0,
    round: 1,
    over: false,
    winner: null,
    breathReady: true,
  };
  const events = [
    { type: 'combat-start', monsters: monsters.map((m) => ({ name: m.name, emoji: m.emoji })) },
    { type: 'initiative', order: order.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative })) },
  ];
  return { combat, events };
}

function advanceTurn(combat, events) {
  do {
    combat.turnIndex++;
    if (combat.turnIndex >= combat.order.length) {
      combat.turnIndex = 0;
      combat.round++;
      events.push({ type: 'round', round: combat.round });
    }
  } while (!alive(currentCombatant(combat)));
}

/** All monsters dead or fled? Only the defeated give up their gold. */
function checkVictory(combat, events) {
  if (livingMonsters(combat).length > 0) return false;
  combat.over = true;
  combat.winner = 'dragon';
  const gold = combat.order
    .filter((c) => c.kind !== 'dragon' && c.hp.current <= 0)
    .reduce((sum, m) => sum + (m.goldValue ?? 0), 0);
  const fled = combat.order.filter((c) => c.kind !== 'dragon' && c.fled).length;
  events.push({ type: 'victory', gold, fled });
  return true;
}

/** One courage check, at most once per monster per combat. */
function triggerMorale(combat, monster, rng, events) {
  if (monster.moraleChecked || monster.morale == null) return;
  if (!alive(monster) || monster.panicked) return;
  monster.moraleChecked = true;
  const res = moraleCheck(monster, rng);
  if (!res.pass) monster.panicked = true;
  events.push({ type: 'morale', id: monster.id, who: monster.name, ...res });
}

/** Deaths rattle the survivors; a bad wound rattles the victim. */
function afterDamage(combat, target, rng, events) {
  if (target.hp.current <= 0) {
    events.push({ type: 'death', id: target.id, who: target.name, goldValue: target.goldValue });
    for (const ally of livingMonsters(combat)) triggerMorale(combat, ally, rng, events);
  } else if (target.hp.current <= target.hp.max / 2) {
    triggerMorale(combat, target, rng, events);
  }
}

/** Play out monster turns until it is the dragon's turn or combat ends. */
export function runMonsterTurns(combat, rng = Math.random) {
  const events = [];
  while (!combat.over && currentCombatant(combat).kind !== 'dragon') {
    const monster = currentCombatant(combat);
    if (monster.panicked) {
      monster.fled = true;
      events.push({ type: 'flee', id: monster.id, who: monster.name });
      if (checkVictory(combat, events)) return events;
      advanceTurn(combat, events);
      continue;
    }
    const dragon = dragonOf(combat);
    const res = resolveAttack(monster, monster.attacks[0], dragon, rng);
    if (res.hit) dragon.hp.current = Math.max(0, dragon.hp.current - res.damage);
    events.push({
      type: 'attack',
      attackerId: monster.id,
      attacker: monster.name,
      attackerKind: monster.kind,
      targetId: dragon.id,
      target: dragon.name,
      targetHpAfter: dragon.hp.current,
      ...res,
    });
    if (dragon.hp.current <= 0) {
      combat.over = true;
      combat.winner = 'monsters';
      events.push({ type: 'defeat' });
      return events;
    }
    advanceTurn(combat, events);
  }
  // The dragon's turn is coming up: try to rekindle spent breath.
  if (!combat.over && !combat.breathReady) {
    const re = rollBreathRecharge(rng);
    if (re.ready) combat.breathReady = true;
    events.push({ type: 'recharge', roll: re.roll, ready: re.ready });
  }
  return events;
}

/**
 * Resolve the dragon's bite against a chosen monster, then advance.
 * Biting panicked prey rolls with advantage.
 */
export function playerAttack(combat, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const dragon = currentCombatant(combat);
  const target =
    combat.order.find((c) => c.id === targetId && c.kind !== 'dragon' && alive(c)) ??
    livingMonsters(combat)[0];
  if (!target) return events;
  const res = resolveAttack(dragon, dragon.attacks[0], target, rng, {
    advantage: !!target.panicked,
  });
  if (res.hit) target.hp.current = Math.max(0, target.hp.current - res.damage);
  events.push({
    type: 'attack',
    attackerId: dragon.id,
    attacker: dragon.name,
    attackerKind: 'dragon',
    targetId: target.id,
    target: target.name,
    targetHpAfter: target.hp.current,
    ...res,
  });
  afterDamage(combat, target, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}

/**
 * Fire breath: one damage roll, every living monster makes a DEX save for
 * half. Spends the charge; it rekindles on a d6 of 5+ at the dragon's turn.
 */
export function playerBreath(combat, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat) || !combat.breathReady) return events;
  const dragon = currentCombatant(combat);
  const spec = dragon.breath;
  if (!spec) return events;
  combat.breathReady = false;
  const dmg = roll(spec.damage, rng);
  const targets = livingMonsters(combat);
  const results = [];
  for (const m of targets) {
    const res = resolveBreathOn(m, spec.dc, dmg.total, rng);
    m.hp.current = Math.max(0, m.hp.current - res.damage);
    results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
  }
  events.push({ type: 'breath', total: dmg.total, rolls: dmg.rolls, dc: spec.dc, results });
  for (const m of targets) afterDamage(combat, m, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}
