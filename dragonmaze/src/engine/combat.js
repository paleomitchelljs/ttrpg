// Turn-based combat: initiative, turn loop, attack resolution, death.
// Pure logic, no DOM. Every function returns an array of events the view
// narrates. The UI drives the loop: runMonsterTurns() until it is the
// dragon's turn, then wait for playerAttack().

import { resolveAttack, rollInitiative } from './rules.js';

const alive = (c) => c.hp.current > 0;

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

/** Roll initiative and build combat state. */
export function createCombat(dragon, monsters, rng = Math.random) {
  const combatants = [dragon, ...monsters];
  for (const c of combatants) c.initiative = rollInitiative(c, rng);
  // Ties go to the dragon (kind to the kid at the table).
  const order = [...combatants].sort(
    (a, b) => b.initiative - a.initiative || (a.kind === 'dragon' ? -1 : 1)
  );
  const combat = { combatants, order, turnIndex: 0, round: 1, over: false, winner: null };
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

/** Play out monster turns until it is the dragon's turn or combat ends. */
export function runMonsterTurns(combat, rng = Math.random) {
  const events = [];
  while (!combat.over && currentCombatant(combat).kind !== 'dragon') {
    const monster = currentCombatant(combat);
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
  return events;
}

/** Resolve the dragon's attack against a chosen monster, then advance. */
export function playerAttack(combat, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const dragon = currentCombatant(combat);
  const target =
    combat.order.find((c) => c.id === targetId && c.kind !== 'dragon' && alive(c)) ??
    livingMonsters(combat)[0];
  if (!target) return events;
  const res = resolveAttack(dragon, dragon.attacks[0], target, rng);
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
  if (!alive(target)) {
    events.push({ type: 'death', id: target.id, who: target.name, goldValue: target.goldValue });
  }
  if (livingMonsters(combat).length === 0) {
    combat.over = true;
    combat.winner = 'dragon';
    const gold = combat.order
      .filter((c) => c.kind !== 'dragon')
      .reduce((sum, m) => sum + (m.goldValue ?? 0), 0);
    events.push({ type: 'victory', gold });
  } else {
    advanceTurn(combat, events);
  }
  return events;
}
