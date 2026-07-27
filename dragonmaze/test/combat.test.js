// Faction refactor: side assignment, the hero/foe/minion partitions, minion
// AI turns, and full-fight victory/defeat. Plain node, no framework — mirrors
// dice.test.js. Combatants use extreme stats so outcomes are RNG-proof.

import assert from 'node:assert/strict';
import { makeCombatant } from '../src/engine/entities.js';
import {
  createCombat,
  runAiTurns,
  playerAttack,
  isPlayerTurn,
  livingMonsters,
  livingHeroes,
  heroesOf,
} from '../src/engine/combat.js';
import { makeSeededRNG } from '../src/engine/rng.js';

const hero = (over = {}) =>
  makeCombatant({ id: 'hero', name: 'Hero', kind: 'hero', ac: 12, hp: 40, abilities: { dex: 1 },
    attacks: [{ name: 'sword', toHit: 100, damage: '20d10' }], ...over });
const minion = (over = {}) =>
  makeCombatant({ id: 'wolf', name: 'Wolf', kind: 'beast', side: 'ally', ownerId: 'hero', ac: 12, hp: 8,
    attacks: [{ name: 'bite', toHit: 100, damage: '1d4' }], ...over });
const foe = (over = {}) =>
  makeCombatant({ id: 'goblin', name: 'Goblin', kind: 'monster', ac: 1, hp: 1, goldValue: 7,
    attacks: [{ name: 'poke', toHit: 0, damage: '1d4' }], ...over });

// Drive a fight to the finish exactly the way the game's driver does.
function playOut(heroes, foes, rng) {
  let { combat, events } = createCombat(heroes, foes, rng);
  events = [...events, ...runAiTurns(combat, rng)];
  let guard = 0;
  while (!combat.over && isPlayerTurn(combat) && guard++ < 200) {
    events.push(...playerAttack(combat, foes[0].id, rng));
    if (!combat.over) events.push(...runAiTurns(combat, rng));
  }
  return { combat, events };
}

// --- 1. side defaults from kind; explicit side wins ---
assert.equal(makeCombatant({ name: 'M', kind: 'monster' }).side, 'foe');
assert.equal(makeCombatant({ name: 'H', kind: 'hero' }).side, 'hero');
assert.equal(makeCombatant({ name: 'D', kind: 'dragon' }).side, 'hero');
assert.equal(makeCombatant({ name: 'W', kind: 'beast', side: 'ally' }).side, 'ally');
assert.equal(makeCombatant({ name: 'X' }).side, 'foe'); // kind defaults to monster

// --- 2. a minion is on the hero side but is NOT counted a hero (defeat) ---
{
  const { combat } = createCombat([hero(), minion()], [foe()], makeSeededRNG('parts'));
  assert.equal(livingMonsters(combat).length, 1, 'one foe');
  assert.equal(livingHeroes(combat).length, 1, 'minion excluded from heroes');
  assert.equal(heroesOf(combat).length, 2, 'hero side = hero + minion');
}

// --- 3. an allied minion takes an automatic (non-player) turn, hitting a foe ---
{
  const rng = makeSeededRNG('minion-turn');
  const f = foe({ hp: 1000, ac: 1 }); // survives, so no early victory
  const { combat } = createCombat(
    [hero({ attacks: [{ name: 'sword', toHit: 0, damage: '1d4' }] }), minion()], [f], rng);
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('wolf'));
  assert.equal(isPlayerTurn(combat), false, 'a minion turn is not the player’s');
  const events = runAiTurns(combat, rng);
  assert.ok(
    events.some((e) => e.type === 'attack' && e.attackerSide === 'ally'),
    'the minion swung as an ally');
}

// --- 4. victory: a slain foe yields its gold ---
{
  const { combat, events } = playOut([hero()], [foe()], makeSeededRNG('win'));
  assert.ok(combat.over, 'fight resolved');
  assert.equal(combat.winner, 'heroes');
  const vic = events.find((e) => e.type === 'victory');
  assert.ok(vic && vic.gold >= 7, `victory awards foe gold (got ${vic?.gold})`);
}

// --- 5. defeat: the dragon falling loses the run ---
{
  const dragon = makeCombatant({ id: 'dragon', name: 'Dragon', kind: 'dragon', ac: -100, hp: 1,
    attacks: [{ name: 'bite', toHit: 0, damage: '1d4' }] });
  const boss = foe({ hp: 1000, ac: 1000, attacks: [{ name: 'maul', toHit: 100, damage: '20d10' }] });
  const { combat, events } = playOut([dragon], [boss], makeSeededRNG('lose'));
  assert.ok(combat.over, 'fight resolved');
  assert.equal(combat.winner, 'monsters');
  assert.ok(events.some((e) => e.type === 'defeat'), 'a defeat event fired');
}

console.log('combat.test.js: all assertions passed ✓');
