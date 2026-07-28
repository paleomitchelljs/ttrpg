// Faction refactor: side assignment, the hero/foe/minion partitions, minion
// AI turns, and full-fight victory/defeat. Plain node, no framework — mirrors
// dice.test.js. Combatants use extreme stats so outcomes are RNG-proof.

import assert from 'node:assert/strict';
import { makeCombatant } from '../src/engine/entities.js';
import {
  createCombat,
  runAiTurns,
  playerAttack,
  playerUseItem,
  playerSpell,
  isPlayerTurn,
  livingMonsters,
  livingHeroes,
  heroesOf,
} from '../src/engine/combat.js';
import { makeSeededRNG } from '../src/engine/rng.js';
import { consumableById } from '../data/consumables.js';

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

// --- 6. consumables (playerUseItem) ---
// put a specific hero on turn so isPlayerTurn passes
function heroTurn(combat, id = 'hero') {
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith(id));
  return combat;
}

{ // healing potion restores a wounded ally + emits item-heal
  const rng = makeSeededRNG('c-heal');
  const h = hero({ hp: 30 }); h.hp.current = 6;
  const { combat } = createCombat([h], [foe({ hp: 1000, ac: 1000 })], rng);
  const ev = playerUseItem(heroTurn(combat), consumableById('potion-healing'), h.id, rng);
  assert.ok(h.hp.current > 6, 'healing potion restored HP');
  assert.ok(ev.some((e) => e.type === 'item-heal'), 'item-heal event fired');
}

{ // Draught of Recall clears burned spells
  const rng = makeSeededRNG('c-restore');
  const h = hero(); h.burned = ['ember-bolt', 'smite'];
  const { combat } = createCombat([h], [foe({ hp: 1000, ac: 1000 })], rng);
  playerUseItem(heroTurn(combat), consumableById('potion-mana'), h.id, rng);
  assert.equal(h.burned.length, 0, 'burned spells restored');
}

{ // Vial of Venom damages one foe
  const rng = makeSeededRNG('c-poison');
  const f = foe({ hp: 50 });
  const { combat } = createCombat([hero()], [f], rng);
  const ev = playerUseItem(heroTurn(combat), consumableById('vial-poison'), f.id, rng);
  assert.ok(f.hp.current < 50, 'venom damaged the foe');
  assert.ok(ev.some((e) => e.type === 'item-hit'), 'item-hit event fired');
}

{ // Caustic Flask hits every foe
  const rng = makeSeededRNG('c-caustic');
  const a = foe({ id: 'goblin', hp: 50 }), b = foe({ id: 'rat', hp: 50 });
  const { combat } = createCombat([hero()], [a, b], rng);
  const ev = playerUseItem(heroTurn(combat), consumableById('vial-caustic'), null, rng);
  assert.ok(a.hp.current < 50 && b.hp.current < 50, 'caustic hit both foes');
  const wave = ev.find((e) => e.type === 'item-wave');
  assert.ok(wave && wave.results.length === 2, 'item-wave covers both foes');
}

{ // Potion of Warding applies a lasting +2 AC condition that turns a hit into a miss
  const rng = () => 0.58; // d20 -> 12
  const h = hero({ hp: 30, ac: 12 });
  const f = foe({ id: 'goblin', hp: 1000, ac: 1000, attacks: [{ name: 'poke', toHit: 0, damage: '1d4' }] });
  const { combat } = createCombat([h], [f], rng);
  playerUseItem(heroTurn(combat), consumableById('potion-protection'), h.id, rng);
  const w = (h.conditions ?? []).find((k) => k.id === 'warded');
  assert.ok(w && w.ac === 2 && w.rounds >= 2, 'warded applied (+2 AC)');
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('goblin'));
  const atk = runAiTurns(combat, rng).find((e) => e.type === 'attack' && e.targetId === h.id);
  assert.ok(atk && !atk.hit, 'the ward (AC 12->14) turns a 12 into a miss');
}

{ // grease: the whole pack attacks at disadvantage
  const rng = () => 0.99;
  const h = hero({ hp: 100, ac: 100 });
  const f = foe({ id: 'goblin', hp: 1000, ac: 1, attacks: [{ name: 'poke', toHit: 5, damage: '1d4' }] });
  const { combat } = createCombat([h], [f], rng);
  playerUseItem(heroTurn(combat), consumableById('grease'), null, rng);
  assert.ok((f.conditions ?? []).some((k) => k.id === 'greased' && k.disadv), 'foe is greased');
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('goblin'));
  const atk = runAiTurns(combat, rng).find((e) => e.type === 'attack' && String(e.attackerId).startsWith('goblin'));
  assert.equal(atk?.mode, 'disadvantage', 'greased foe rolls at disadvantage');
}

{ // flaming pitch: burning DoT ticks at the end of the foe's turn
  const rng = () => 0.99;
  const h = hero({ hp: 100, ac: 100 });
  const f = foe({ id: 'goblin', hp: 50, ac: 100 });
  const { combat } = createCombat([h], [f], rng);
  playerUseItem(heroTurn(combat), consumableById('flaming-pitch'), null, rng);
  assert.ok((f.conditions ?? []).some((k) => k.id === 'burning' && k.dot), 'foe is burning');
  const hpAfterSplash = f.hp.current;
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('goblin'));
  const ev = runAiTurns(combat, rng);
  assert.ok(ev.some((e) => e.type === 'condition-dot'), 'the burn dealt damage');
  assert.ok(f.hp.current < hpAfterSplash, 'foe lost HP to the burn');
}

// --- 7. dominate -> convert a foe into an ally minion ---
const domCaster = (over = {}) =>
  hero({ id: 'hero', abilities: { cha: 20 }, spells: ['dominate-undead'], ...over });

{ // dominates a foe: it joins the hero side, is no longer a foe, and pays its gold
  const rng = () => 0.99; // d20 -> nat20, so the cast never fizzles
  const c = domCaster();
  const f = foe({ id: 'goblin', hp: 20, goldValue: 7, undead: true }); // undead can't resist
  const { combat } = createCombat([c], [f, foe({ id: 'rat', hp: 1000, ac: 1000 })], rng);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'dominate-undead', f.id, rng);
  assert.equal(f.side, 'ally', 'foe converted to ally');
  assert.equal(f.ownerId, c.id, 'ownerId set to the caster');
  assert.equal(combat.bonusGold, 7, 'dominated foe banks its gold');
  assert.ok(heroesOf(combat).some((h) => h.id === f.id), 'the ally is on the hero side');
  assert.ok(!livingMonsters(combat).some((m) => m.id === f.id), 'no longer counted a foe');
  assert.ok(ev.some((e) => e.type === 'dominated'), 'dominated event fired');
}

{ // a boss pack is immune
  const rng = () => 0.99;
  const boss = foe({ id: 'boss', hp: 50, undead: true, isBoss: true });
  const { combat } = createCombat([domCaster()], [boss], rng);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'dominate-undead', boss.id, rng);
  assert.equal(boss.side, 'foe', 'boss stays a foe');
  assert.ok(ev.some((e) => e.type === 'dominate-resisted' && e.reason === 'boss'), 'boss immunity');
}

{ // one minion per caster: a second dominate is blocked
  const rng = () => 0.99;
  const c = domCaster();
  const a = foe({ id: 'a', hp: 20, undead: true }), b = foe({ id: 'b', hp: 20, undead: true });
  const { combat } = createCombat([c], [a, b, foe({ id: 'z', hp: 1000, ac: 1000 })], rng);
  playerSpell(heroTurn(combat, 'hero'), 'dominate-undead', a.id, rng);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'dominate-undead', b.id, rng);
  assert.equal(a.side, 'ally', 'first dominate holds');
  assert.equal(b.side, 'foe', 'second dominate blocked by the 1-minion cap');
  assert.ok(ev.some((e) => e.type === 'dominate-resisted' && e.reason === 'full'), 'cap-full reason');
}

// --- 8. summon -> conjure an ally minion ---
{ // summon adds an owned ally minion
  const rng = () => 0.99; // nat20 -> cast lands
  const c = hero({ id: 'hero', abilities: { cha: 20 }, spells: ['summon-ember'] });
  const { combat } = createCombat([c], [foe({ id: 'goblin', hp: 1000, ac: 1000 })], rng);
  const before = combat.order.length;
  const ev = playerSpell(heroTurn(combat, 'hero'), 'summon-ember', null, rng);
  assert.equal(combat.order.length, before + 1, 'a combatant joined the order');
  const minion = combat.order.find((x) => x.minionType === 'summoned');
  assert.ok(minion && minion.side === 'ally' && minion.ownerId === c.id, 'summoned an owned ally');
  assert.ok(ev.some((e) => e.type === 'summoned'), 'summoned event fired');
}

{ // one minion per caster: a second summon fizzles
  const rng = () => 0.99;
  const c = hero({ id: 'hero', abilities: { cha: 20 }, spells: ['summon-ember'] });
  const { combat } = createCombat([c], [foe({ id: 'z', hp: 1000, ac: 1000 })], rng);
  playerSpell(heroTurn(combat, 'hero'), 'summon-ember', null, rng);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'summon-ember', null, rng);
  assert.equal(combat.order.filter((x) => x.minionType === 'summoned').length, 1, 'still just one minion');
  assert.ok(ev.some((e) => e.type === 'summon-full'), 'second summon fizzles');
}

// --- 9. familiars render but never fight; a deployed minion displaces them ---
{
  const rng = () => 0.99;
  const dragon = makeCombatant({ id: 'dragon', name: 'Red Dragon', kind: 'dragon',
    abilities: { cha: 20 }, ac: 18, hp: 100, spells: ['summon-ember'] });
  dragon.familiar = 'ember-wisp';
  const { combat } = createCombat([dragon], [foe({ id: 'goblin', hp: 1000, ac: 1000 })], rng);
  const fam = combat.combatants.find((c) => c.minionType === 'familiar');
  assert.ok(fam, 'the familiar joined as a combatant');
  assert.ok(fam.inert, 'the familiar is inert');
  assert.ok(!combat.order.includes(fam), 'the familiar is not in the turn order');
  assert.ok(heroesOf(combat).some((h) => h.id === fam.id), 'the familiar renders on the hero side');
  assert.ok(!livingHeroes(combat).some((h) => h.id === fam.id), 'but is not counted a hero');

  // A foe can't strike the familiar — it isn't in the order the AI picks from.
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('goblin'));
  const aiEv = runAiTurns(combat, rng);
  assert.ok(!aiEv.some((e) => e.type === 'attack' && e.targetId === fam.id), 'foes cannot target the familiar');

  // Summoning a real minion displaces the familiar (and its boost) from the field.
  const ev = playerSpell(heroTurn(combat, 'dragon'), 'summon-ember', null, rng);
  assert.ok(ev.some((e) => e.type === 'familiar-dismiss'), 'the familiar was dismissed');
  assert.ok(!combat.combatants.some((c) => c.minionType === 'familiar'), 'familiar left the field');
  assert.ok(combat.order.some((c) => c.minionType === 'summoned'), 'the summoned minion took its place');
}

console.log('combat.test.js: all assertions passed ✓');
