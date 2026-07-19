// Turn-based combat: initiative, turn loop, attacks, breath, spells, morale,
// death and flight — now for a whole party. Pure logic, no DOM. Every
// function returns an array of events the view narrates. The UI drives the
// loop: runMonsterTurns() until a hero's turn, then wait for playerAttack(),
// playerBreath(), or playerSpell() from whichever hero is up.
//
// The dragon is the run: if it falls, the fight is lost, even with
// companions standing. Downed companions stay in the order and can be
// revived by healing.

import {
  resolveAttack,
  rollInitiative,
  resolveBreathOn,
  rollBreathRecharge,
  moraleCheck,
  resolveSpellCast,
} from './rules.js';
import { roll } from './dice.js';
import { spellById } from '../../data/spells.js';

const alive = (c) => c.hp.current > 0 && !c.fled;
const isMonster = (c) => c.kind === 'monster';

export function currentCombatant(combat) {
  return combat.order[combat.turnIndex];
}

export function livingMonsters(combat) {
  return combat.order.filter((c) => isMonster(c) && alive(c));
}

export function livingHeroes(combat) {
  return combat.order.filter((c) => !isMonster(c) && alive(c));
}

export function heroesOf(combat) {
  // creation order: dragon first, then companions
  return combat.combatants.filter((c) => !isMonster(c));
}

export function dragonOf(combat) {
  return combat.order.find((c) => c.kind === 'dragon');
}

export function isPlayerTurn(combat) {
  return !combat.over && !isMonster(currentCombatant(combat));
}

/** Roll initiative and build combat state. Breath starts charged. */
export function createCombat(heroes, monsters, rng = Math.random) {
  const combatants = [...heroes, ...monsters];
  for (const c of combatants) c.initiative = rollInitiative(c, rng);
  // Ties go to the heroes (kind to the kids at the table).
  const order = [...combatants].sort(
    (a, b) => b.initiative - a.initiative || (isMonster(a) ? 1 : -1)
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
    { type: 'combat-start', monsters: monsters.map((m) => ({ name: m.name })) },
    { type: 'initiative', order: order.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative })) },
  ];
  // A downed companion (carried into the fight at 0 HP) never gets a turn
  // unless revived; make sure the opening turn belongs to someone standing.
  if (!alive(currentCombatant(combat))) advanceTurn(combat, events);
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
  combat.winner = 'heroes';
  const gold = combat.order
    .filter((c) => isMonster(c) && c.hp.current <= 0)
    .reduce((sum, m) => sum + (m.goldValue ?? 0), 0);
  const fled = combat.order.filter((c) => isMonster(c) && c.fled).length;
  events.push({ type: 'victory', gold, fled });
  return true;
}

/** The dragon falling ends the fight in defeat, whoever else stands. */
function checkDefeat(combat, events) {
  if (dragonOf(combat).hp.current > 0) return false;
  combat.over = true;
  combat.winner = 'monsters';
  events.push({ type: 'defeat' });
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

/** Consequences of damage: deaths rattle allies, wounds rattle the victim. */
function afterDamage(combat, target, rng, events) {
  if (target.hp.current <= 0) {
    if (isMonster(target)) {
      events.push({ type: 'death', id: target.id, who: target.name, goldValue: target.goldValue });
      for (const ally of livingMonsters(combat)) triggerMorale(combat, ally, rng, events);
    } else if (target.kind !== 'dragon') {
      events.push({ type: 'hero-down', id: target.id, who: target.name });
    }
  } else if (isMonster(target) && target.hp.current <= target.hp.max / 2) {
    triggerMorale(combat, target, rng, events);
  }
}

/** Play out monster turns until a hero's turn comes up or combat ends. */
export function runMonsterTurns(combat, rng = Math.random) {
  const events = [];
  while (!combat.over && isMonster(currentCombatant(combat))) {
    const monster = currentCombatant(combat);
    if (monster.panicked) {
      monster.fled = true;
      events.push({ type: 'flee', id: monster.id, who: monster.name });
      if (checkVictory(combat, events)) return events;
      advanceTurn(combat, events);
      continue;
    }
    const targets = livingHeroes(combat);
    const target = targets[Math.floor(rng() * targets.length)];
    const res = resolveAttack(monster, monster.attacks[0], target, rng);
    if (res.hit) target.hp.current = Math.max(0, target.hp.current - res.damage);
    events.push({
      type: 'attack',
      attackerId: monster.id,
      attacker: monster.name,
      attackerKind: monster.kind,
      targetId: target.id,
      target: target.name,
      targetKind: target.kind,
      targetHpAfter: target.hp.current,
      ...res,
    });
    if (target.kind === 'dragon' && checkDefeat(combat, events)) return events;
    afterDamage(combat, target, rng, events);
    advanceTurn(combat, events);
  }
  // The dragon's turn is coming up: try to rekindle spent breath.
  if (!combat.over && !combat.breathReady && currentCombatant(combat).kind === 'dragon') {
    const re = rollBreathRecharge(rng);
    if (re.ready) combat.breathReady = true;
    events.push({ type: 'recharge', roll: re.roll, ready: re.ready });
  }
  return events;
}

/**
 * The current hero attacks a chosen monster, then the turn advances.
 * Striking panicked prey rolls with advantage.
 */
export function playerAttack(combat, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const actor = currentCombatant(combat);
  const target =
    combat.order.find((c) => c.id === targetId && isMonster(c) && alive(c)) ??
    livingMonsters(combat)[0];
  if (!target) return events;
  const res = resolveAttack(actor, actor.attacks[0], target, rng, {
    advantage: !!target.panicked,
  });
  if (res.hit) target.hp.current = Math.max(0, target.hp.current - res.damage);
  events.push({
    type: 'attack',
    attackerId: actor.id,
    attacker: actor.name,
    attackerKind: actor.kind,
    targetId: target.id,
    target: target.name,
    targetKind: target.kind,
    targetHpAfter: target.hp.current,
    ...res,
  });
  afterDamage(combat, target, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}

/**
 * Fire breath (dragon only): one damage roll, every living monster makes a
 * DEX save for half. Spends the charge; rekindles on a d6 of 5+.
 */
export function playerBreath(combat, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat) || !combat.breathReady) return events;
  const dragon = currentCombatant(combat);
  const spec = dragon.breath;
  if (dragon.kind !== 'dragon' || !spec) return events;
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

/**
 * The current hero casts a known, unburned spell. A failed casting check
 * fizzles and burns the spell for the rest of the combat.
 */
export function playerSpell(combat, spellId, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const caster = currentCombatant(combat);
  const spell = spellById(spellId);
  if (!spell || !caster.spells.includes(spellId) || caster.burned.includes(spellId)) return events;

  const cast = resolveSpellCast(caster, spell, rng);
  events.push({
    type: 'spell-cast',
    casterId: caster.id,
    caster: caster.name,
    spellId,
    name: spell.name,
    ...cast,
  });
  if (!cast.success) {
    caster.burned.push(spellId);
    advanceTurn(combat, events);
    return events;
  }

  if (spell.target === 'enemy') {
    const target =
      combat.order.find((c) => c.id === targetId && isMonster(c) && alive(c)) ??
      livingMonsters(combat)[0];
    const dmg = roll(spell.dice, rng);
    target.hp.current = Math.max(0, target.hp.current - dmg.total);
    events.push({
      type: 'spell-hit',
      targetId: target.id,
      target: target.name,
      damage: dmg.total,
      hpAfter: target.hp.current,
    });
    afterDamage(combat, target, rng, events);
  } else if (spell.target === 'ally') {
    const target =
      combat.order.find((c) => c.id === targetId && !isMonster(c)) ?? caster;
    const amount = roll(spell.dice, rng).total;
    const revived = target.hp.current <= 0;
    target.hp.current = Math.min(target.hp.max, target.hp.current + amount);
    events.push({
      type: 'spell-heal',
      targetId: target.id,
      target: target.name,
      amount,
      revived,
      hpAfter: target.hp.current,
    });
  } else if (spell.target === 'all-enemies') {
    const dmg = roll(spell.dice, rng);
    const targets = livingMonsters(combat);
    const results = [];
    for (const m of targets) {
      const res = resolveBreathOn(m, spell.saveDC, dmg.total, rng);
      m.hp.current = Math.max(0, m.hp.current - res.damage);
      results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
    }
    events.push({ type: 'spell-wave', total: dmg.total, dc: spell.saveDC, results });
    for (const m of targets) afterDamage(combat, m, rng, events);
  }

  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}
