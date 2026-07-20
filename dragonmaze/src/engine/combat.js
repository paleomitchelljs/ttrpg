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
import { resolveParleyCheck } from './rules.js';
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
export function createCombat(heroes, monsters, rng = Math.random, label = null) {
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
    familiar: heroes.find((h) => h.kind === 'dragon')?.familiar ?? null,
  };
  const events = [
    { type: 'combat-start', monsters: monsters.map((m) => ({ name: m.name })), label },
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

/** With the dragon along, its fall ends the fight; a party adventuring
 * alone is beaten only when every hero is down. */
function checkDefeat(combat, events) {
  const dragon = dragonOf(combat);
  const beaten = dragon ? dragon.hp.current <= 0 : livingHeroes(combat).length === 0;
  if (!beaten) return false;
  combat.over = true;
  combat.winner = 'monsters';
  events.push({ type: 'defeat' });
  return true;
}

/**
 * Apply typed damage ('physical' | 'fire') honoring resistances,
 * vulnerabilities, and the relentless keyword. Returns the damage actually
 * dealt and pushes explanatory events.
 */
function applyDamage(target, amount, type, events) {
  let dealt = amount;
  if (target.resist?.includes(type)) {
    dealt = Math.max(1, Math.floor(dealt / 2));
    events.push({ type: 'resist', id: target.id, who: target.name, dtype: type });
  } else if (target.vulnerable?.includes(type)) {
    dealt *= 2;
    events.push({ type: 'vulnerable', id: target.id, who: target.name, dtype: type });
  }
  if (
    target.ability === 'relentless' &&
    !target.relentlessUsed &&
    target.hp.current > 0 &&
    target.hp.current - dealt <= 0
  ) {
    target.relentlessUsed = true;
    target.hp.current = 1;
    events.push({ type: 'relentless', id: target.id, who: target.name });
    return dealt;
  }
  target.hp.current = Math.max(0, target.hp.current - dealt);
  return dealt;
}

/** The dragon's familiar sharpens the party's fire. */
function fireBonus(combat) {
  return combat.familiar === 'ember-wisp' ? 1 : 0;
}

/** One courage check, at most once per monster per combat. */
function triggerMorale(combat, monster, rng, events) {
  if (monster.moraleChecked || monster.morale == null) return;
  if (!alive(monster) || monster.panicked) return;
  monster.moraleChecked = true;
  // Beren cows beasts: a 'wild' monster fighting him checks morale at
  // disadvantage, so it routs more readily.
  const dread =
    monster.faction === 'wild' &&
    livingHeroes(combat).some((h) => h.traits?.includes('beast-dread'));
  const res = moraleCheck(monster, rng, dread);
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
    if (monster.ability === 'regenerate' && monster.hp.current > 0 && monster.hp.current < monster.hp.max) {
      monster.hp.current = Math.min(monster.hp.max, monster.hp.current + 2);
      events.push({ type: 'regenerate', id: monster.id, who: monster.name, hpAfter: monster.hp.current });
    }
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
    if (res.hit) {
      res.damage = applyDamage(target, res.damage, 'physical', events);
      if (monster.ability === 'lifedrain' && res.damage > 1 && monster.hp.current < monster.hp.max) {
        const drained = Math.floor(res.damage / 2);
        monster.hp.current = Math.min(monster.hp.max, monster.hp.current + drained);
        events.push({ type: 'lifedrain', id: monster.id, who: monster.name, amount: drained, hpAfter: monster.hp.current });
      }
    }
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
    if (checkDefeat(combat, events)) return events;
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
  if (res.hit) {
    if (actor.bane === 'undead' && target.undead) {
      res.damage += 2;
      events.push({ type: 'bane', attacker: actor.name, who: target.name });
    }
    res.damage = applyDamage(target, res.damage, 'physical', events);
  }
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
  const total = dmg.total + fireBonus(combat);
  const targets = livingMonsters(combat);
  const results = [];
  for (const m of targets) {
    const res = resolveBreathOn(m, spec.dc, total, rng);
    res.damage = applyDamage(m, res.damage, 'fire', events);
    results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
  }
  events.push({ type: 'breath', total, rolls: dmg.rolls, dc: spec.dc, results });
  for (const m of targets) afterDamage(combat, m, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}

/**
 * Talk instead of fight. Available on the first round only, once per
 * combat, and only against creatures willing to hear it (the UI gates
 * that). The check is CHA vs a DC the caller computed from disposition
 * and renown. Outcomes:
 *   threaten — success routs every living monster (they keep their gold)
 *   persuade — success ends the fight peacefully
 *   barter   — like persuade; the caller already took the payment
 *   work     — like persuade; the caller records the bounty they offer
 */
export function playerParley(combat, mode, dc, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat) || combat.parleyUsed || combat.round > 1) return events;
  combat.parleyUsed = true;
  const actor = currentCombatant(combat);
  const check = resolveParleyCheck(actor, dc, rng);
  events.push({ type: 'parley', mode, actor: actor.name, ...check });
  if (check.success) {
    if (mode === 'threaten') {
      for (const m of livingMonsters(combat)) {
        m.panicked = true;
        m.moraleChecked = true;
      }
      events.push({ type: 'parley-rout' });
      advanceTurn(combat, events);
      return events;
    }
    for (const m of livingMonsters(combat)) m.fled = true;
    events.push({ type: 'parley-peace', mode });
    checkVictory(combat, events);
    return events;
  }
  advanceTurn(combat, events);
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
    if (spell.dominate) {
      if (target.undead) {
        target.panicked = true;
        target.moraleChecked = true;
        events.push({ type: 'dominated', targetId: target.id, who: target.name });
      } else {
        events.push({ type: 'dominate-resisted', who: target.name });
      }
      if (!checkVictory(combat, events)) advanceTurn(combat, events);
      return events;
    }
    const dmg = roll(spell.dice, rng).total + (spell.drain ? 0 : fireBonus(combat));
    const dealt = applyDamage(target, dmg, spell.drain ? 'physical' : 'fire', events);
    let drained = 0;
    if (spell.drain && dealt > 0 && caster.hp.current < caster.hp.max) {
      // lifesteal is capped at half the damage — no full heal-tanking off one mob
      drained = Math.min(Math.ceil(dealt / 2), caster.hp.max - caster.hp.current);
      caster.hp.current += drained;
    }
    events.push({
      type: 'spell-hit',
      targetId: target.id,
      target: target.name,
      damage: dealt,
      hpAfter: target.hp.current,
      drained,
      casterId: caster.id,
      caster: caster.name,
      casterHpAfter: caster.hp.current,
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
    const total = roll(spell.dice, rng).total + fireBonus(combat);
    const targets = livingMonsters(combat);
    const results = [];
    for (const m of targets) {
      const res = resolveBreathOn(m, spell.saveDC, total, rng);
      res.damage = applyDamage(m, res.damage, 'fire', events);
      results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
    }
    events.push({ type: 'spell-wave', total, dc: spell.saveDC, results });
    for (const m of targets) afterDamage(combat, m, rng, events);
  }

  if (!checkVictory(combat, events)) advanceTurn(combat, events);
  return events;
}
