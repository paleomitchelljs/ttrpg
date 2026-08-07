// Turn-based combat: initiative, turn loop, attacks, breath, spells, morale,
// death and flight — now for a whole party. Pure logic, no DOM. Every
// function returns an array of events the view narrates. The UI drives the
// loop: runAiTurns() until a hero's turn, then wait for playerAttack(),
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
import { roll, d20 } from './dice.js';
import { resolveParleyCheck } from './rules.js';
import { spellById } from '../../data/spells.js';
import { makeCombatant } from './entities.js';
import { monsterById } from '../../data/monsters.js';
import { familiarById } from '../../data/familiars.js';

const alive = (c) => c.hp.current > 0 && !c.fled;
// Factions. A minion (side 'ally') fights on the hero side but is AI-run, like
// a foe. isHero = a true, player-controlled hero: only these gate the player's
// turn and count for defeat. onHeroSide = hero OR minion — what foes target and
// who shares victory/defeat. aiRun = takes an automatic turn (foe or minion).
const isFoe = (c) => c.side === 'foe';
const isAlly = (c) => c.side === 'ally';
const isHero = (c) => c.side === 'hero';
const onHeroSide = (c) => !isFoe(c);
const aiRun = (c) => isFoe(c) || isAlly(c);

// ---- conditions: timed buffs/debuffs from consumables and spells ------------
// A condition is { id, rounds, ac?, disadv?, dot?:{amount,dtype}, toHit?,
// damage?, disable?, wakeOnDamage?, focusOf? }.
//   toHit/damage  — sharpen the owner's swings (Holy Weapon).
//   disable       — the owner loses their turns, and anyone striking them has
//                   advantage (Sleep, Hold Person).
//   wakeOnDamage  — drops the moment the owner takes a hit (Sleep).
//   focusOf       — a caster's id: the condition lives only while that caster
//                   holds focus, so it carries no `rounds` of its own.
function addCondition(c, cond) {
  c.conditions = (c.conditions ?? []).filter((k) => k.id !== cond.id); // refresh, don't stack
  c.conditions.push({ ...cond });
}
function dropCondition(c, id) {
  const had = (c.conditions ?? []).some((k) => k.id === id);
  c.conditions = (c.conditions ?? []).filter((k) => k.id !== id);
  return had;
}
const condAc = (c) => (c.conditions ?? []).reduce((n, k) => n + (k.ac ?? 0), 0);
const condDisadv = (c) => (c.conditions ?? []).some((k) => k.disadv);
const condToHit = (c) => (c.conditions ?? []).reduce((n, k) => n + (k.toHit ?? 0), 0);
const condDamage = (c) => (c.conditions ?? []).reduce((n, k) => n + (k.damage ?? 0), 0);
/** Asleep, held — out of the fight until it wears off. */
function disabledBy(c) {
  return (c.conditions ?? []).find((k) => k.disable);
}
// resolveAttack options folding in the attacker's greased footing and blessed
// weapon, and the target's ward and helplessness.
const atkOpts = (attacker, target, extra = {}) => ({
  ...extra,
  advantage: !!extra.advantage || !!disabledBy(target),
  disadvantage: !!extra.disadvantage || condDisadv(attacker),
  toHitBonus: condToHit(attacker),
  damageBonus: condDamage(attacker),
  acBonus: condAc(target),
});
// Age the just-finished combatant's conditions: apply DoT, then expire timed
// ones. A DoT can drop someone, so resolve win/loss here.
function tickConditions(combat, c, events) {
  if (!c.conditions?.length) return;
  const remain = [];
  for (const k of c.conditions) {
    if (k.dot && c.hp.current > 0) {
      c.hp.current = Math.max(0, c.hp.current - k.dot.amount);
      events.push({ type: 'condition-dot', id: c.id, who: c.name, cond: k.id, amount: k.dot.amount, hpAfter: c.hp.current, dtype: k.dot.dtype ?? 'fire' });
    }
    // A focus-held condition has no clock of its own — it lasts exactly as long
    // as its caster keeps concentrating (see tickFocus / breakFocus).
    if (k.focusOf) remain.push(k);
    else if (--k.rounds > 0) remain.push(k);
    else events.push({ type: 'condition-end', id: c.id, who: c.name, cond: k.id });
  }
  c.conditions = remain;
  if (c.hp.current <= 0) {
    if (isFoe(c)) { events.push({ type: 'death', id: c.id, who: c.name, goldValue: c.goldValue }); checkVictory(combat, events); }
    else if (c.kind === 'dragon') checkDefeat(combat, events);
    else { events.push({ type: 'hero-down', id: c.id, who: c.name }); checkDefeat(combat, events); }
  }
}

// ---- focus: spells that last while the caster concentrates ------------------
// Shadowdark's Focus, as the system guide states it: one focus spell at a time;
// a spellcasting check at the start of each of your turns keeps it up; taking a
// hit forces an immediate check; an ordinary failure just ends it, but a
// natural 1 is a full critical failure (burned until rest, plus a mishap).
//
// The caster carries `focus = { spellId, name, targetId, condId, dice, dtype }`
// and the target carries the matching condition tagged `focusOf: caster.id`.

/**
 * Lay a spell's lingering effect on a target: a fixed-duration condition, a
 * focus-held one, or both. `rounds` may be a dice string ('1d4' for Sleep), and
 * a nat-20 cast doubles the duration the way it doubles any other number.
 */
function applySpellCond(combat, caster, target, spell, cast, rng, events) {
  const focused = !!spell.focus;
  const src = spell.focus?.cond ?? spell.cond;
  if (!src) return;
  const cond = { ...src };
  if (focused) {
    // One focus at a time (Shadowdark): starting this one drops the last.
    breakFocus(combat, caster, 'recast', events);
    delete cond.rounds;
    cond.focusOf = caster.id;
    caster.focus = {
      spellId: spell.id, name: spell.name, targetId: target.id, condId: cond.id,
      dice: spell.focus.dice ?? null, dtype: spell.dtype ?? spell.focus.dtype ?? 'fire',
    };
  } else {
    const n = typeof cond.rounds === 'string' ? roll(cond.rounds, rng).total : (cond.rounds ?? 1);
    cond.rounds = cast?.crit ? n * 2 : n;
  }
  addCondition(target, cond);
  events.push({
    type: 'condition-start', targetId: target.id, who: target.name,
    cond: cond.id, rounds: cond.rounds ?? null, focus: focused,
    casterId: caster.id, caster: caster.name, spellId: spell.id, name: spell.name,
    disable: !!cond.disable, toHit: cond.toHit ?? 0, damage: cond.damage ?? 0,
  });
}

/** Lift a caster's focus and the condition it was holding on its target. */
function breakFocus(combat, caster, reason, events) {
  const f = caster?.focus;
  if (!f) return;
  caster.focus = null;
  const target = combat.combatants.find((c) => c.id === f.targetId);
  if (target && f.condId) dropCondition(target, f.condId);
  events.push({
    type: 'focus-end', casterId: caster.id, caster: caster.name,
    spellId: f.spellId, name: f.name, who: target?.name ?? null, reason,
  });
}

/**
 * One upkeep check. Called at the start of the caster's turn, and again
 * whenever they take a hit. Holding it deals the spell's ongoing dice.
 */
function checkFocus(combat, caster, rng, events, trigger) {
  const f = caster?.focus;
  if (!f) return;
  // A focus tick damages its target, which runs afterDamage, which checks that
  // target's own focus. Two casters focused on each other would ping-pong, so a
  // check never re-enters itself.
  if (caster.focusChecking) return;
  if (!alive(caster)) return breakFocus(combat, caster, 'down', events);
  const target = combat.combatants.find((c) => c.id === f.targetId);
  if (!target || !alive(target)) return breakFocus(combat, caster, 'target-gone', events);

  const spell = spellById(f.spellId);
  const check = resolveSpellCast(caster, spell, rng, {});
  events.push({
    type: 'focus-check', casterId: caster.id, caster: caster.name,
    spellId: f.spellId, name: f.name, trigger, ...check,
  });
  if (!check.success) {
    // A natural 1 is a critical failure like any other: the spell is lost until
    // the party rests, and the backlash lands.
    if (check.natural === 1) {
      if (!caster.burned.includes(f.spellId)) caster.burned.push(f.spellId);
      breakFocus(combat, caster, 'mishap', events);
      applyCastMishap(combat, caster, rng, events);
    } else {
      breakFocus(combat, caster, 'lost', events);
    }
    return;
  }
  // Held. An ongoing-damage focus (Acid Arrow) bites again; a nat-20 doubles it.
  if (!f.dice) return;
  const rolled = roll(f.dice, rng).total;
  const amount = check.crit ? rolled * 2 : rolled;
  caster.focusChecking = true;
  const dealt = applyDamage(target, amount, f.dtype ?? 'fire', events);
  events.push({
    type: 'focus-tick', casterId: caster.id, caster: caster.name, name: f.name,
    targetId: target.id, target: target.name, damage: dealt,
    hpAfter: target.hp.current, dtype: f.dtype ?? 'fire', crit: check.crit,
  });
  afterDamage(combat, target, rng, events);
  caster.focusChecking = false;
}

/**
 * Start of a combatant's turn: mend what regenerating gear knits back, then
 * keep any focus they're holding alive.
 */
function beginTurn(combat, c, rng, events) {
  if (c?.regen > 0 && alive(c) && c.hp.current < c.hp.max) {
    const healed = Math.min(c.regen, c.hp.max - c.hp.current);
    c.hp.current += healed;
    events.push({ type: 'regen', id: c.id, who: c.name, amount: healed, hpAfter: c.hp.current });
  }
  if (c?.focus) checkFocus(combat, c, rng, events, 'turn');
}

export function currentCombatant(combat) {
  return combat.order[combat.turnIndex];
}

// Living enemies. (A dominated foe becomes an ally and drops out of here.)
export function livingMonsters(combat) {
  return combat.order.filter((c) => isFoe(c) && alive(c));
}

// Living true heroes — the ones whose survival the run depends on. Minions are
// deliberately excluded (their fall doesn't lose the fight).
export function livingHeroes(combat) {
  return combat.order.filter((c) => isHero(c) && alive(c));
}

// Everyone a foe may strike: heroes plus their minions.
function livingHeroSide(combat) {
  return combat.order.filter((c) => onHeroSide(c) && alive(c));
}

// Who a foe will actually target. A minion "bodyguards" its controller: while
// any minion it owns is alive, that controller can't be targeted — the enemy
// has to go through the minion first. (Falls back to the full side if, somehow,
// everyone left is a guarded controller.)
function foeTargets(combat) {
  const guarded = new Set(
    combat.order.filter((c) => isAlly(c) && alive(c) && c.ownerId).map((c) => c.ownerId)
  );
  const pool = livingHeroSide(combat).filter((c) => !guarded.has(c.id));
  return pool.length ? pool : livingHeroSide(combat);
}

export function heroesOf(combat) {
  // creation order: dragon first, then companions, then any minions
  return combat.combatants.filter((c) => onHeroSide(c));
}

export function dragonOf(combat) {
  return combat.order.find((c) => c.kind === 'dragon');
}

export function isPlayerTurn(combat) {
  return !combat.over && isHero(currentCombatant(combat));
}

/** Roll initiative and build combat state. Breath starts charged. */
export function createCombat(heroes, monsters, rng = Math.random, label = null) {
  const combatants = [...heroes, ...monsters];
  for (const c of combatants) c.initiative = rollInitiative(c, rng);
  // Ties go to the heroes (kind to the kids at the table).
  const order = [...combatants].sort(
    (a, b) => b.initiative - a.initiative || (isFoe(a) ? 1 : -1)
  );
  const combat = {
    combatants,
    order,
    turnIndex: 0,
    round: 1,
    over: false,
    winner: null,
    breathReady: true,
    bonusGold: 0, // loot from dominated foes (they leave the foe list but still pay out)
  };
  // Each hero who tends a familiar (their own, chosen as a feat) brings it along
  // as a companion sprite: added to `combatants` (so heroesOf renders it) but NOT
  // to `order`, so it never takes a turn, can't be struck, and doesn't count for
  // victory/defeat. It's inert — it only carries its OWNER's boost, and it's
  // displaced the instant that owner deploys a real minion. The dragon can't have
  // one. Multiple heroes may each field their own.
  for (const owner of heroes) {
    const famData = owner.familiar ? familiarById(owner.familiar) : null;
    if (!famData) continue;
    const fam = makeCombatant({
      id: `familiar-${famData.id}-${owner.id}`,
      name: famData.name,
      kind: 'monster',
      side: 'ally',
      ownerId: owner.id,
      minionType: 'familiar',
      temporary: true,
      ac: 10,
      hpMax: 1,
      emoji: famData.emoji ?? '✦',
      anim: famData.anim ?? null, // drawn familiars use sprite strips; the rest keep the emoji
      faction: 'wild',
    });
    fam.inert = true; // never fights, never targeted — a passive boost-carrier
    fam.initiative = 0;
    combat.combatants.push(fam);
  }
  const events = [
    // Snapshot every combatant's HP at combat open — BEFORE any opening enemy
    // round is resolved — so the view can render the cards at their pre-round HP
    // and then animate the first hits landing (rather than showing the damage
    // already applied). See renderRoster in combatView.
    {
      type: 'combat-start', monsters: monsters.map((m) => ({ name: m.name })), label,
      startHp: Object.fromEntries(combat.combatants.map((c) => [c.id, c.hp.current])),
    },
    { type: 'initiative', order: order.map((c) => ({ id: c.id, name: c.name, initiative: c.initiative })) },
  ];
  // A downed companion (carried into the fight at 0 HP) never gets a turn
  // unless revived; make sure the opening turn belongs to someone standing.
  if (!alive(currentCombatant(combat))) advanceTurn(combat, events, rng);
  return { combat, events };
}

function advanceTurn(combat, events, rng = Math.random) {
  tickConditions(combat, currentCombatant(combat), events); // end-of-turn: DoT + expiry
  if (combat.over) return; // a DoT could have ended the fight
  do {
    combat.turnIndex++;
    if (combat.turnIndex >= combat.order.length) {
      combat.turnIndex = 0;
      combat.round++;
      events.push({ type: 'round', round: combat.round });
    }
  } while (!alive(currentCombatant(combat)));
  // Start of the new turn: whoever is up keeps any focus they're holding, which
  // is where an Acid Arrow bites again and where a slipped concentration ends.
  beginTurn(combat, currentCombatant(combat), rng, events);
}

/** All monsters dead or fled? Only the defeated give up their gold. */
function checkVictory(combat, events) {
  if (livingMonsters(combat).length > 0) return false;
  combat.over = true;
  combat.winner = 'heroes';
  const gold = combat.order
    .filter((c) => isFoe(c) && c.hp.current <= 0)
    .reduce((sum, m) => sum + (m.goldValue ?? 0), 0) + (combat.bonusGold ?? 0);
  const fled = combat.order.filter((c) => isFoe(c) && c.fled).length;
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
  // A ward (Potion of Warding) soaks damage before it reaches HP.
  if (target.tempHp > 0 && dealt > 0) {
    const soaked = Math.min(target.tempHp, dealt);
    target.tempHp -= soaked;
    dealt -= soaked;
    events.push({ type: 'ward', id: target.id, who: target.name, soaked, tempLeft: target.tempHp });
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
  // A hit shakes a sleeper awake (Sleep). Held is a rigid magic, not a doze —
  // it only lifts when its caster's concentration does.
  if (dealt > 0) {
    for (const k of target.conditions ?? []) {
      if (k.wakeOnDamage && dropCondition(target, k.id)) {
        events.push({ type: 'condition-end', id: target.id, who: target.name, cond: k.id, woken: true });
      }
    }
  }
  return dealt;
}

// A hero's familiar gives its knack only to that hero, and only while it's on
// the field. Deploying a real minion (summon / dominate / beast) displaces the
// familiar via dismissFamiliar(), so the boost simply follows the sprite. Each
// hero has at most one familiar (their own), keyed by ownerId.
function familiarActiveFor(combat, hero) {
  return (
    !!hero?.familiar &&
    combat.combatants.some((c) => c.minionType === 'familiar' && c.ownerId === hero.id && alive(c))
  );
}
// +1 to a caster's damage spells while their Ember Wisp is out.
function fireBonus(combat, caster) {
  return familiarActiveFor(combat, caster) && caster?.familiar === 'ember-wisp' ? 1 : 0;
}
// Advantage on the cast for a caster's own familiar knacks (Fae Drake lowers the
// DC via dcMod; the Dusk Bat grants advantage on Drain Life).
function familiarDcMod(combat, caster) {
  return familiarActiveFor(combat, caster) && caster?.familiar === 'fae-drake' ? -1 : 0;
}
function familiarCastAdvantage(combat, caster, spell) {
  return !!spell?.drain && familiarActiveFor(combat, caster) && caster?.familiar === 'dusk-bat';
}
// What to tell the player when a knack actually changed a roll. The knacks are
// small numbers buried in the maths (a DC one lower, a die of damage one
// higher), so without a line in the log there is no way to tell the familiar is
// doing anything at all. Returns null when nothing applied. The view phrases it.
function familiarCredit(combat, caster, effect) {
  if (!familiarActiveFor(combat, caster)) return null;
  const fam = familiarById(caster.familiar);
  return fam?.effect === effect ? { name: fam.name, effect } : null;
}
// Which knack (if any) shaped the casting check we just made.
function castCredit(combat, caster, opts) {
  if (opts.dcMod) return familiarCredit(combat, caster, 'spell-focus');
  if (opts.advantage) return familiarCredit(combat, caster, 'drain-boost');
  return null;
}
// A real minion just took the slot — the familiar winks out, and its boost with
// it. Removing it from `combatants` (it was never in `order`) drops it from the
// hero lineup on the next render.
function dismissFamiliar(combat, casterId, events) {
  const idx = combat.combatants.findIndex((c) => c.minionType === 'familiar' && c.ownerId === casterId);
  if (idx === -1) return;
  const fam = combat.combatants[idx];
  combat.combatants.splice(idx, 1);
  events.push({ type: 'familiar-dismiss', id: fam.id, who: fam.name });
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
  // Being struck rattles concentration: an immediate focus check, per the
  // Shadowdark rule that damage or distraction forces one.
  if (target.focus) checkFocus(combat, target, rng, events, 'damage');
  if (target.hp.current <= 0) {
    if (isFoe(target)) {
      events.push({ type: 'death', id: target.id, who: target.name, goldValue: target.goldValue });
      for (const foe of livingMonsters(combat)) triggerMorale(combat, foe, rng, events);
    } else if (isAlly(target)) {
      events.push({ type: 'minion-down', id: target.id, who: target.name });
    } else if (target.kind !== 'dragon') {
      events.push({ type: 'hero-down', id: target.id, who: target.name });
    }
  } else if (isFoe(target) && target.hp.current <= target.hp.max / 2) {
    triggerMorale(combat, target, rng, events);
  }
}

/**
 * Play out every AI turn — foes and allied minions alike — until a
 * player-controlled hero's turn comes up or combat ends. Foes strike the hero
 * side (heroes and their minions); minions strike the foes.
 */
export function runAiTurns(combat, rng = Math.random) {
  const events = [];
  while (!combat.over && aiRun(currentCombatant(combat))) {
    const actor = currentCombatant(combat);
    if (isAlly(actor)) {
      takeMinionTurn(combat, actor, rng, events);
      if (combat.over) return events;
      advanceTurn(combat, events, rng);
      continue;
    }
    const monster = actor;
    // Asleep or held: it loses the turn outright. The condition still ages in
    // advanceTurn, so a 1d4-round Sleep runs its clock down while it lies there.
    const out = disabledBy(monster);
    if (out) {
      events.push({ type: 'condition-skip', id: monster.id, who: monster.name, cond: out.id });
      advanceTurn(combat, events, rng);
      continue;
    }
    if (monster.ability === 'regenerate' && monster.hp.current > 0 && monster.hp.current < monster.hp.max) {
      monster.hp.current = Math.min(monster.hp.max, monster.hp.current + 2);
      events.push({ type: 'regenerate', id: monster.id, who: monster.name, hpAfter: monster.hp.current });
    }
    if (monster.panicked) {
      monster.fled = true;
      events.push({ type: 'flee', id: monster.id, who: monster.name });
      if (checkVictory(combat, events)) return events;
      advanceTurn(combat, events, rng);
      continue;
    }
    // A caster monster may work a spell instead of swinging. If it has nothing
    // worth casting at (e.g. a healer with no wounded ally), it falls through.
    if (monster.cast && rng() < (monster.cast.chance ?? 0.5) && takeMonsterCast(combat, monster, rng, events)) {
      if (combat.over) return events;
      advanceTurn(combat, events, rng);
      continue;
    }
    const targets = foeTargets(combat);
    const target = targets[Math.floor(rng() * targets.length)];
    const res = resolveAttack(monster, monster.attacks[0], target, rng, atkOpts(monster, target));
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
      attackerSide: monster.side,
      targetId: target.id,
      target: target.name,
      targetKind: target.kind,
      targetSide: target.side,
      targetHpAfter: target.hp.current,
      ...res,
    });
    if (target.kind === 'dragon' && checkDefeat(combat, events)) return events;
    afterDamage(combat, target, rng, events);
    if (checkDefeat(combat, events)) return events;
    advanceTurn(combat, events, rng);
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
 * An allied minion's automatic turn: swing at a random living foe. Minions are
 * kept simple — no morale, no special abilities — they exist to soak and chip.
 */
function takeMinionTurn(combat, minion, rng, events) {
  if (!minion.attacks?.length) return; // a bodyguard with no attack just holds
  const foes = livingMonsters(combat);
  if (!foes.length) { checkVictory(combat, events); return; }
  const target = foes[Math.floor(rng() * foes.length)];
  const res = resolveAttack(minion, minion.attacks[0], target, rng, atkOpts(minion, target));
  if (res.hit) res.damage = applyDamage(target, res.damage, 'physical', events);
  events.push({
    type: 'attack',
    attackerId: minion.id,
    attacker: minion.name,
    attackerKind: minion.kind,
    attackerSide: 'ally',
    targetId: target.id,
    target: target.name,
    targetKind: target.kind,
    targetSide: target.side,
    targetHpAfter: target.hp.current,
    ...res,
  });
  afterDamage(combat, target, rng, events);
  checkVictory(combat, events);
}

/**
 * A caster monster works its spell (data/monsters.js `cast`). Uses the same
 * Shadowdark check as everyone: d20 + the monster's castStat vs DC (10 + tier),
 * nat-20 doubles the effect, nat-1 mishaps. Returns true if the turn was spent
 * casting; false if there was no worthwhile target (caller then attacks).
 *   kind 'bolt'  — sears a random hero for its dice
 *   kind 'drain' — same, and the caster heals half
 *   kind 'heal'  — mends its most-wounded ally (or itself)
 *   kind 'daze'  — leaves a hero reeling (disadvantage next round)
 */
function takeMonsterCast(combat, monster, rng, events) {
  const c = monster.cast;
  let target = null;
  if (c.kind === 'heal') {
    const hurt = combat.order.filter((x) => isFoe(x) && alive(x) && x.hp.current < x.hp.max);
    hurt.sort((a, b) => a.hp.current / a.hp.max - b.hp.current / b.hp.max);
    target = hurt[0] ?? null;
  } else {
    const hs = foeTargets(combat); // honour minion bodyguards for offensive spells too
    target = hs.length ? hs[Math.floor(rng() * hs.length)] : null;
  }
  if (!target) return false; // nothing worth casting at — swing instead

  const cast = resolveSpellCast(monster, c, rng);
  events.push({ type: 'monster-cast', casterId: monster.id, caster: monster.name, name: c.name, tier: c.tier, kind: c.kind, ...cast });
  if (!cast.success) {
    if (cast.natural === 1) applyCastMishap(combat, monster, rng, events);
    return true;
  }
  const rolled = c.dice ? roll(c.dice, rng).total : 0;
  const amount = cast.crit ? rolled * 2 : rolled;
  if (c.kind === 'heal') {
    const revived = target.hp.current <= 0;
    target.hp.current = Math.min(target.hp.max, target.hp.current + amount);
    events.push({ type: 'monster-heal', casterId: monster.id, caster: monster.name, targetId: target.id, target: target.name, amount, revived, hpAfter: target.hp.current });
    return true;
  }
  if (c.kind === 'daze') {
    addCondition(target, { id: 'dazed', rounds: 2, disadv: true });
    events.push({ type: 'monster-daze', casterId: monster.id, caster: monster.name, targetId: target.id, target: target.name });
    return true;
  }
  // 'bolt' or 'drain'
  const dealt = applyDamage(target, amount, 'fire', events);
  if (c.kind === 'drain' && dealt > 0 && monster.hp.current < monster.hp.max) {
    monster.hp.current = Math.min(monster.hp.max, monster.hp.current + Math.ceil(dealt / 2));
  }
  events.push({ type: 'monster-spell-hit', casterId: monster.id, caster: monster.name, targetId: target.id, target: target.name, damage: dealt, hpAfter: target.hp.current, kind: c.kind });
  if (target.kind === 'dragon') { checkDefeat(combat, events); return true; }
  afterDamage(combat, target, rng, events);
  checkDefeat(combat, events);
  return true;
}

/**
 * The current hero attacks a chosen monster, then the turn advances.
 * Striking panicked prey rolls with advantage.
 */
export function playerAttack(combat, targetId, rng = Math.random, opts = {}) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const actor = currentCombatant(combat);
  // Flurry (talent) lets a landed Strike carry into a second swing — it follows
  // a hit, it isn't two free attacks a turn. Each swing re-picks a live foe.
  const flurry = !!actor.talents?.includes('flurry');
  const maxStrikes = flurry ? 2 : 1;
  let acted = false;
  let lastRes = null;
  let lastTarget = null;
  for (let i = 0; i < maxStrikes; i++) {
    if (i > 0 && !lastRes?.hit) break; // the first swing missed: no follow-up
    const target =
      combat.order.find((c) => c.id === targetId && isFoe(c) && alive(c)) ??
      livingMonsters(combat)[0];
    if (!target) break;
    acted = true;
    const res = resolveAttack(actor, actor.attacks[0], target, rng, atkOpts(actor, target, { advantage: !!target.panicked }));
    lastRes = res;
    lastTarget = target;
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
      attackerSide: actor.side,
      targetId: target.id,
      target: target.name,
      targetKind: target.kind,
      targetSide: target.side,
      targetHpAfter: target.hp.current,
      ...res,
    });
    afterDamage(combat, target, rng, events);
    if (!livingMonsters(combat).length) break;
  }
  if (!acted) return events;
  // The last swing missed and there's still a foe to hit: offer a luck reroll
  // (deferred — the turn does not pass until the player decides; see spendLuck).
  if (lastRes && !lastRes.hit && livingMonsters(combat).length && actor.luck > 0 && !opts.viaLuck) {
    combat.pendingLuck = { kind: 'attack', casterId: actor.id, targetId: lastTarget.id };
    events.push({ type: 'luck-offer', actorId: actor.id, actor: actor.name, kind: 'attack' });
    return events;
  }
  if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
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
  const total = dmg.total + fireBonus(combat, dragon); // dragon has no familiar → 0
  const targets = livingMonsters(combat);
  const results = [];
  for (const m of targets) {
    const res = resolveBreathOn(m, spec.dc, total, rng);
    res.damage = applyDamage(m, res.damage, 'fire', events);
    results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
  }
  events.push({ type: 'breath', total, rolls: dmg.rolls, dc: spec.dc, results });
  for (const m of targets) afterDamage(combat, m, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
  return events;
}

/**
 * Sweep (Cleave talent): one attack roll against every living monster, each hit
 * dealing half the weapon's damage. Counts as the hero's whole turn.
 */
export function playerSweep(combat, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const actor = currentCombatant(combat);
  if (!actor.talents?.includes('cleave')) return events;
  const targets = livingMonsters(combat);
  if (!targets.length) return events;
  const results = [];
  for (const m of targets) {
    const res = resolveAttack(actor, actor.attacks[0], m, rng, atkOpts(actor, m));
    let dealt = 0;
    if (res.hit) dealt = applyDamage(m, Math.max(1, Math.floor(res.damage / 2)), 'physical', events);
    results.push({ id: m.id, name: m.name, hit: res.hit, damage: dealt, hpAfter: m.hp.current });
  }
  events.push({ type: 'sweep', actor: actor.name, actorId: actor.id, results });
  for (const m of targets) afterDamage(combat, m, rng, events);
  if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
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
      advanceTurn(combat, events, rng);
      return events;
    }
    for (const m of livingMonsters(combat)) m.fled = true;
    events.push({ type: 'parley-peace', mode });
    checkVictory(combat, events);
    return events;
  }
  advanceTurn(combat, events, rng);
  return events;
}

// Intimidate the highlighted enemy: a CHA check vs its resolve (braver monsters
// are harder). Success panics it — a panicked monster flees on its turn.
// Fearless things (undead, constructs) can't be cowed.
export function playerIntimidate(combat, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const actor = currentCombatant(combat);
  const target = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
  if (!target) return events;
  if (target.morale == null) {
    events.push({ type: 'intimidate', actor: actor.name, target: target.name, targetId: target.id, fearless: true, success: false });
    advanceTurn(combat, events, rng);
    return events;
  }
  const dc = 12 + target.morale;
  const check = resolveParleyCheck(actor, dc, rng, { advantage: actor.talents?.includes('silver-tongue') });
  events.push({ type: 'intimidate', actor: actor.name, target: target.name, targetId: target.id, ...check });
  if (check.success) {
    target.panicked = true;
    target.moraleChecked = true;
  }
  advanceTurn(combat, events, rng);
  return events;
}

// Shadowdark: a natural-1 casting check is a critical failure — magic is
// perilous. We keep the backlash light and game-appropriate: half the time a
// jolt of arcane feedback (1d4, and a fumble never kills — floored at 1 HP),
// half the time the caster is left reeling (dazed: disadvantage next round).
// Used by both the party's casters and monster casters.
function applyCastMishap(combat, caster, rng, events) {
  if (rng() < 0.5) {
    const dmg = roll('1d4', rng).total;
    caster.hp.current = Math.max(1, caster.hp.current - dmg);
    events.push({ type: 'spell-mishap', kind: 'backlash', casterId: caster.id, caster: caster.name, damage: dmg, hpAfter: caster.hp.current });
  } else {
    addCondition(caster, { id: 'dazed', rounds: 2, disadv: true });
    events.push({ type: 'spell-mishap', kind: 'dazed', casterId: caster.id, caster: caster.name });
  }
}

/**
 * The current hero casts a known, unburned spell. A failed casting check
 * fizzles and burns the spell until the party rests; a natural 1 also mishaps.
 */
export function playerSpell(combat, spellId, targetId, rng = Math.random, opts = {}) {
  const events = [];
  if (!isPlayerTurn(combat)) return events;
  const caster = currentCombatant(combat);
  const spell = spellById(spellId);
  if (!spell || !caster.spells.includes(spellId) || caster.burned.includes(spellId)) return events;

  const castOpts = {
    dcMod: familiarDcMod(combat, caster),
    advantage: familiarCastAdvantage(combat, caster, spell), // Dusk Bat: advantage on Drain Life
  };
  const cast = resolveSpellCast(caster, spell, rng, castOpts);
  events.push({
    type: 'spell-cast',
    casterId: caster.id,
    caster: caster.name,
    spellId,
    name: spell.name,
    famAid: castCredit(combat, caster, castOpts),
    ...cast,
  });
  if (cast.success) {
    applyCastSuccess(combat, caster, spell, targetId, cast, rng, events);
    return events;
  }
  // A failed cast offers a luck reroll before finalizing — deferred, so the spell
  // is NOT burned and the turn does NOT pass until the player decides (see
  // spendLuck / declineLuck). viaLuck means we're already in the reroll.
  if (caster.luck > 0 && !opts.viaLuck) {
    combat.pendingLuck = { kind: 'cast', casterId: caster.id, spellId, targetId, cast };
    events.push({ type: 'luck-offer', actorId: caster.id, actor: caster.name, kind: 'cast' });
    return events;
  }
  finalizeFizzle(combat, caster, spellId, cast, rng, events);
  return events;
}

// Burn the fizzled spell (unless Arcane Recovery saves the first this fight),
// mishap on a nat-1, then pass the turn.
function finalizeFizzle(combat, caster, spellId, cast, rng, events) {
  if (caster.talents?.includes('arcane-recovery') && !caster.recoveredThisCombat) {
    caster.recoveredThisCombat = true;
    const sc = [...events].reverse().find((e) => e.type === 'spell-cast');
    if (sc) sc.recovered = true;
    else events.push({ type: 'spell-recovered', casterId: caster.id, caster: caster.name, spellId });
  } else {
    caster.burned.push(spellId);
  }
  if (cast.natural === 1) applyCastMishap(combat, caster, rng, events);
  advanceTurn(combat, events, rng);
}

// Apply a successful cast's effect (summon / damage / heal / wave / dominate),
// then pass the turn. `cast` carries the crit flag for doubling.
function applyCastSuccess(combat, caster, spell, targetId, cast, rng, events) {
  // Conjure an allied minion. One minion per caster; it slots in right after you
  // and lasts the battle (temporary — dropped when the combat object is discarded).
  if (spell.summon) {
    if (combat.order.some((c) => isAlly(c) && c.ownerId === caster.id && alive(c))) {
      events.push({ type: 'summon-full', caster: caster.name });
    } else {
      const tmpl = monsterById(spell.summon);
      if (tmpl) {
        dismissFamiliar(combat, caster.id, events); // the conjuration takes the familiar's slot
        const minion = makeCombatant({ ...tmpl, side: 'ally', ownerId: caster.id, minionType: 'summoned', temporary: true });
        minion.initiative = rollInitiative(minion, rng);
        combat.combatants.push(minion);
        combat.order.splice(combat.turnIndex + 1, 0, minion); // acts next, after the caster
        events.push({ type: 'summoned', casterId: caster.id, caster: caster.name, id: minion.id, name: minion.name });
      }
    }
    advanceTurn(combat, events, rng);
    return;
  }

  if (spell.target === 'enemy') {
    const target =
      combat.order.find((c) => c.id === targetId && isFoe(c) && alive(c)) ??
      livingMonsters(combat)[0];
    // Pure control (Sleep, Hold Person): no damage, just a condition the foe may
    // shrug off. Bosses are too big to sleep or freeze, same as they can't be
    // dominated. A `save` spell gives one ability check to resist outright.
    if (spell.cond && !spell.dice) {
      const fail = (reason) => {
        events.push({ type: 'control-resisted', spellId: spell.id, name: spell.name, who: target.name, reason });
        if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
      };
      if (spell.bossImmune && target.isBoss) return fail('boss');
      if (spell.save) {
        const saveDC = 10 + (spell.tier ?? 1) + (caster.abilities?.[caster.castStat ?? 'cha'] ?? 0);
        const die = d20({ rng });
        const total = die.total + (target.abilities?.[spell.save] ?? 0);
        if (die.total !== 1 && (die.total === 20 || total >= saveDC)) return fail('save');
      }
      applySpellCond(combat, caster, target, spell, cast, rng, events);
      advanceTurn(combat, events, rng);
      return;
    }
    if (spell.dominate) {
      // Turn the foe into an allied minion for the rest of the battle. Bosses are
      // immune; the caster commands only one minion at a time; undead (mindless)
      // can't resist, others get one WIS save. A dominated foe still yields loot.
      const fail = (reason) => {
        events.push({ type: 'dominate-resisted', who: target.name, reason });
        if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
      };
      if (target.isBoss) return fail('boss');
      if (combat.order.some((c) => isAlly(c) && c.ownerId === caster.id && alive(c))) return fail('full');
      const saveDC = 12 + (caster.abilities?.[caster.castStat ?? 'cha'] ?? 0);
      const die = d20({ rng });
      const saveTotal = die.total + (target.abilities?.wis ?? 0);
      const resisted = !target.undead && die.total !== 1 && (die.total === 20 || saveTotal >= saveDC);
      if (resisted) return fail('save');
      dismissFamiliar(combat, caster.id, events); // the new thrall takes the familiar's slot
      target.side = 'ally';
      target.ownerId = caster.id;
      target.minionType = 'dominated';
      target.temporary = true;
      target.panicked = false;
      target.fled = false;
      combat.bonusGold = (combat.bonusGold ?? 0) + (target.goldValue ?? 0);
      events.push({ type: 'dominated', targetId: target.id, who: target.name, goldValue: target.goldValue ?? 0 });
      if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
      return events;
    }
    // Shadowdark: damage is the spell's dice only. A natural-20 cast doubles it.
    const rolled = roll(spell.dice, rng).total;
    const boost = spell.drain ? 0 : fireBonus(combat, caster);
    const dmg = (cast.crit ? rolled * 2 : rolled) + boost;
    // Drain has its own damage type. It used to ride on 'physical', which meant
    // a skeleton's resistance to blades — and an iron golem's — halved a spell
    // that isn't a blow at all. Nothing resists 'drain' today; a monster that
    // should (something with no life to take) can just list it in `resist`.
    const dealt = applyDamage(target, dmg, spell.dtype ?? (spell.drain ? 'drain' : 'fire'), events);
    let drained = 0;
    if (spell.drain && dealt > 0 && caster.hp.current < caster.hp.max) {
      // A vampire keeps everything she takes: the caster heals the full damage
      // dealt, bounded only by her missing HP (it never overheals).
      drained = Math.min(dealt, caster.hp.max - caster.hp.current);
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
      famAid: boost ? familiarCredit(combat, caster, 'fire-boost') : null,
    });
    // Acid Arrow: the hit leaves something behind that keeps eating while the
    // caster focuses. Only if the foe survived the impact.
    if (spell.cond || spell.focus) {
      if (alive(target)) applySpellCond(combat, caster, target, spell, cast, rng, events);
    }
    afterDamage(combat, target, rng, events);
  } else if (spell.target === 'ally') {
    const target =
      combat.order.find((c) => c.id === targetId && onHeroSide(c)) ?? caster;
    // A buff, not a mending (Holy Weapon): lay the condition on and pass the turn.
    if (spell.cond && !spell.dice) {
      applySpellCond(combat, caster, target, spell, cast, rng, events);
      advanceTurn(combat, events, rng);
      return;
    }
    const healed = roll(spell.dice, rng).total;
    const amount = cast.crit ? healed * 2 : healed; // nat-20 doubles the mending
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
    const rolled = roll(spell.dice, rng).total;
    const waveBoost = fireBonus(combat, caster);
    const total = (cast.crit ? rolled * 2 : rolled) + waveBoost;
    const targets = livingMonsters(combat);
    const results = [];
    for (const m of targets) {
      const res = resolveBreathOn(m, spell.saveDC, total, rng);
      res.damage = applyDamage(m, res.damage, 'fire', events);
      results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
    }
    events.push({
      type: 'spell-wave',
      total,
      dc: spell.saveDC,
      results,
      famAid: waveBoost ? familiarCredit(combat, caster, 'fire-boost') : null,
    });
    for (const m of targets) afterDamage(combat, m, rng, events);
  }

  if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
}

/**
 * The player answers a pending luck offer. spendLuck cashes the token and rerolls
 * the deferred attack or cast (keeping the new result); declineLuck lets the
 * original failure stand (burning a fizzle, passing the turn). Both leave the
 * turn advanced so the caller can run the AI turns that follow.
 */
export function spendLuck(combat, rng = Math.random) {
  const p = combat.pendingLuck;
  if (!p) return [];
  combat.pendingLuck = null;
  const actor = combat.order.find((c) => c.id === p.casterId);
  if (!actor) return [];
  actor.luck = Math.max(0, (actor.luck ?? 0) - 1);
  const events = [{ type: 'luck-spent', actorId: actor.id, actor: actor.name, kind: p.kind }];
  if (p.kind === 'cast') {
    const spell = spellById(p.spellId);
    const castOpts = { dcMod: familiarDcMod(combat, actor), advantage: familiarCastAdvantage(combat, actor, spell) };
    const cast = resolveSpellCast(actor, spell, rng, castOpts);
    events.push({ type: 'spell-cast', casterId: actor.id, caster: actor.name, spellId: p.spellId, name: spell.name, reroll: true, famAid: castCredit(combat, actor, castOpts), ...cast });
    if (cast.success) applyCastSuccess(combat, actor, spell, p.targetId, cast, rng, events);
    else finalizeFizzle(combat, actor, p.spellId, cast, rng, events);
  } else {
    // Reroll exactly the one swing that missed (not the whole flurry).
    const target = combat.order.find((c) => c.id === p.targetId && isFoe(c) && alive(c)) ?? livingMonsters(combat)[0];
    if (target) {
      const res = resolveAttack(actor, actor.attacks[0], target, rng, atkOpts(actor, target, { advantage: !!target.panicked }));
      if (res.hit) {
        if (actor.bane === 'undead' && target.undead) { res.damage += 2; events.push({ type: 'bane', attacker: actor.name, who: target.name }); }
        res.damage = applyDamage(target, res.damage, 'physical', events);
      }
      events.push({
        type: 'attack', attackerId: actor.id, attacker: actor.name, attackerKind: actor.kind,
        attackerSide: actor.side, targetId: target.id, target: target.name, targetKind: target.kind,
        targetSide: target.side, targetHpAfter: target.hp.current, reroll: true, ...res,
      });
      afterDamage(combat, target, rng, events);
    }
    if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
  }
  return events;
}

export function declineLuck(combat, rng = Math.random) {
  const p = combat.pendingLuck;
  if (!p) return [];
  combat.pendingLuck = null;
  const actor = combat.order.find((c) => c.id === p.casterId);
  const events = [];
  if (p.kind === 'cast' && actor) {
    finalizeFizzle(combat, actor, p.spellId, p.cast, rng, events); // the fizzle stands
  } else if (!checkVictory(combat, events)) {
    advanceTurn(combat, events, rng); // the miss stands; pass the turn
  }
  return events;
}

/**
 * Use a consumable from the party pouch — instant effects plus timed conditions
 * (grease/ward/burning). Spends the actor's whole turn, like a spell. `item` is a
 * CONSUMABLES entry; the caller (gameState) owns the pouch and removes it on use.
 */
export function playerUseItem(combat, item, targetId, rng = Math.random) {
  const events = [];
  if (!isPlayerTurn(combat) || !item?.use) return events;
  const actor = currentCombatant(combat);
  const u = item.use;
  events.push({ type: 'item-use', actorId: actor.id, actor: actor.name, itemId: item.id, name: item.name, tile: item.tile ?? null, target: u.target });

  if (u.target === 'self' || u.target === 'ally') {
    const target = u.target === 'self'
      ? actor
      : combat.order.find((c) => c.id === targetId && onHeroSide(c)) ?? actor;
    if (u.heal) {
      const amount = roll(u.heal, rng).total;
      const revived = target.hp.current <= 0;
      target.hp.current = Math.min(target.hp.max, target.hp.current + amount);
      events.push({ type: 'item-heal', targetId: target.id, target: target.name, amount, revived, hpAfter: target.hp.current });
    }
    if (u.tempHp) {
      const amount = roll(u.tempHp, rng).total;
      target.tempHp = Math.max(target.tempHp, amount); // wards don't stack — keep the stronger
      events.push({ type: 'item-ward', targetId: target.id, target: target.name, amount });
    }
    if (u.restoreSpells) {
      const before = target.burned.length;
      target.burned = u.restoreSpells === 'all' ? [] : target.burned.slice(Number(u.restoreSpells));
      events.push({ type: 'item-restore', targetId: target.id, target: target.name, count: before - target.burned.length });
    }
    if (u.condition) {
      addCondition(target, u.condition);
      events.push({ type: 'condition-applied', targetId: target.id, target: target.name, cond: u.condition.id });
    }
  } else if (u.target === 'enemy') {
    const target = combat.order.find((c) => c.id === targetId && isFoe(c) && alive(c)) ?? livingMonsters(combat)[0];
    if (target) {
      if (u.damage) {
        const dealt = applyDamage(target, roll(u.damage, rng).total, u.dtype ?? 'physical', events);
        events.push({ type: 'item-hit', targetId: target.id, target: target.name, damage: dealt, hpAfter: target.hp.current, dtype: u.dtype ?? 'physical' });
      }
      if (u.condition) {
        addCondition(target, u.condition);
        events.push({ type: 'condition-applied', targetId: target.id, target: target.name, cond: u.condition.id });
      }
      afterDamage(combat, target, rng, events);
    }
  } else if (u.target === 'all-enemies') {
    const targets = livingMonsters(combat);
    const total = u.damage ? roll(u.damage, rng).total : 0;
    const results = [];
    for (const m of targets) {
      if (u.damage) {
        const res = u.saveDC ? resolveBreathOn(m, u.saveDC, total, rng) : { damage: total, saved: false };
        res.damage = applyDamage(m, res.damage, u.dtype ?? 'fire', events);
        results.push({ id: m.id, name: m.name, hpAfter: m.hp.current, ...res });
      }
      if (u.condition) addCondition(m, u.condition);
    }
    events.push({ type: 'item-wave', total, dc: u.saveDC ?? null, dtype: u.dtype ?? 'fire', cond: u.condition?.id ?? null, results });
    for (const m of targets) afterDamage(combat, m, rng, events);
  }

  if (!checkVictory(combat, events)) advanceTurn(combat, events, rng);
  return events;
}
