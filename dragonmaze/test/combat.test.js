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
  spendLuck,
  declineLuck,
  isPlayerTurn,
  livingMonsters,
  livingHeroes,
  heroesOf,
} from '../src/engine/combat.js';
import { makeSeededRNG } from '../src/engine/rng.js';
import { maxSpellTier, canLearnSpell } from '../src/engine/rules.js';
import { consumableById } from '../data/consumables.js';
import { spellById } from '../data/spells.js';
import { companionById } from '../data/party.js';

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

// --- 10. spell damage is dice-only, and a natural-20 cast doubles it ---
{
  // ember-bolt is 1d6, DC 11. rng 0.99 -> d20 20 (crit) and 1d6 -> 6, doubled to 12.
  const c = hero({ id: 'hero', abilities: { cha: 20 }, castStat: 'cha', spells: ['ember-bolt'] });
  const foeBig = foe({ id: 'goblin', hp: 1000, ac: 1 });
  const { combat } = createCombat([c], [foeBig], () => 0.99);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', foeBig.id, () => 0.99);
  const hit = ev.find((e) => e.type === 'spell-hit');
  assert.ok(ev.find((e) => e.type === 'spell-cast')?.crit, 'a natural 20 is a crit');
  assert.equal(hit.damage, 12, 'nat-20 doubles the spell dice (1d6=6 -> 12), no ability bonus');
}

// --- 11. a failed cast burns the spell for the rest of the fight ---
{
  // rng 0.01 -> d20 1: an automatic fizzle. The spell is now burned.
  const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', spells: ['ember-bolt'] });
  const { combat } = createCombat([c], [foe({ id: 'goblin', hp: 1000, ac: 1000 })], () => 0.01);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', null, () => 0.01);
  assert.ok(ev.find((e) => e.type === 'spell-cast' && e.success === false), 'the cast fizzled');
  assert.ok(c.burned.includes('ember-bolt'), 'the fizzled spell is burned (lost until rest)');
}

// --- 12. a caster monster works a spell on its turn ---
{
  // A monster with a 'bolt' cast sears a hero (rng 0.99 -> nat-20 crit success).
  const h = hero({ id: 'hero', ac: 100, hp: 100 });
  const mage = foe({ id: 'mage', hp: 1000, ac: 1000, abilities: { int: 3 } });
  mage.castStat = 'int';
  mage.cast = { name: 'Zap', tier: 1, kind: 'bolt', dice: '1d6', chance: 1 };
  const { combat } = createCombat([h], [mage], () => 0.99);
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('mage'));
  const before = h.hp.current;
  const ev = runAiTurns(combat, () => 0.99);
  assert.ok(ev.some((e) => e.type === 'monster-cast' && e.success), 'the monster cast its spell');
  assert.ok(ev.some((e) => e.type === 'monster-spell-hit'), 'the bolt landed on the hero');
  assert.ok(h.hp.current < before, 'the hero took spell damage');
}

// --- 13. a caster monster heals its most-wounded ally instead of the hero ---
{
  const h = hero({ id: 'hero', ac: 100, hp: 100 });
  const healer = foe({ id: 'healer', hp: 1000, ac: 1000, abilities: { wis: 3 } });
  healer.castStat = 'wis';
  healer.cast = { name: 'Mend', tier: 1, kind: 'heal', dice: '1d6', chance: 1 };
  const hurt = foe({ id: 'hurt', hp: 1000, ac: 1000 });
  hurt.hp.current = 3; // wounded ally worth healing
  const { combat } = createCombat([h], [healer, hurt], () => 0.99);
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('healer'));
  const ev = runAiTurns(combat, () => 0.99);
  assert.ok(ev.some((e) => e.type === 'monster-heal' && e.targetId === hurt.id), 'the healer mended its ally');
  assert.ok(hurt.hp.current > 3, 'the wounded ally recovered HP');
}

// --- 14. a natural-1 cast mishaps (perilous magic) ---
{
  // rng 0.01 -> d20 1: auto-fizzle + mishap. First rng() in the mishap is 0.01
  // (<0.5) so it's the backlash branch, then 1d4 damage.
  const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', hp: 40, spells: ['ember-bolt'] });
  const { combat } = createCombat([c], [foe({ id: 'goblin', hp: 1000, ac: 1000 })], () => 0.01);
  const before = c.hp.current;
  const ev = playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', null, () => 0.01);
  assert.ok(ev.some((e) => e.type === 'spell-mishap'), 'a nat-1 triggers a mishap');
  assert.ok(c.hp.current < before && c.hp.current >= 1, 'the backlash hurts the caster but never kills');
}

// --- 15. a luck token is OFFERED after a missed swing; spending it rerolls ---
{
  const h = hero({ id: 'hero', attacks: [{ name: 'sword', toHit: 0, damage: '1d6' }] });
  h.luck = 1;
  const g = foe({ id: 'goblin', hp: 1000, ac: 15 });
  const { combat } = createCombat([h], [g], () => 0.5);
  const ev = playerAttack(heroTurn(combat, 'hero'), g.id, () => 0.05); // d20 2 -> miss
  assert.ok(ev.some((e) => e.type === 'luck-offer'), 'a missed swing offers luck');
  assert.ok(combat.pendingLuck, 'the turn pauses for the choice (not advanced)');
  assert.equal(h.luck, 1, 'the token is not spent until the player cashes it');
  // Cash it in: reroll d20 20 (crit hit) + damage.
  let i = 0; const seq = [0.99, 0.5]; const rng = () => (i < seq.length ? seq[i++] : 0.5);
  const ev2 = spendLuck(combat, rng);
  assert.ok(ev2.some((e) => e.type === 'luck-spent'), 'the token was cashed');
  assert.equal(h.luck, 0, 'and now spent');
  assert.ok(ev2.find((e) => e.type === 'attack')?.hit, 'the reroll landed the hit');
  assert.ok(!combat.pendingLuck, 'the offer is cleared');
}

// --- 15b. declining a luck offer lets the miss stand and passes the turn ---
{
  const h = hero({ id: 'hero', attacks: [{ name: 'sword', toHit: 0, damage: '1d6' }] });
  h.luck = 1;
  const g = foe({ id: 'goblin', hp: 1000, ac: 15 });
  const { combat } = createCombat([h], [g], () => 0.5);
  playerAttack(heroTurn(combat, 'hero'), g.id, () => 0.05);
  assert.ok(combat.pendingLuck, 'offer is pending');
  declineLuck(combat, () => 0.5);
  assert.equal(h.luck, 1, 'declining keeps the token');
  assert.ok(!combat.pendingLuck, 'the offer is cleared');
}

// --- 15c. a fizzled cast offers luck; spending it can save the spell ---
{
  const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', hp: 40, spells: ['ember-bolt'] });
  c.luck = 1;
  const g = foe({ id: 'goblin', hp: 1000, ac: 1000 });
  const { combat } = createCombat([c], [g], () => 0.5);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', g.id, () => 0.01); // d20 1 -> fizzle
  assert.ok(ev.some((e) => e.type === 'luck-offer'), 'a fizzle offers luck');
  assert.ok(!c.burned.includes('ember-bolt'), 'the spell is not burned while the offer stands');
  assert.ok(!ev.some((e) => e.type === 'spell-mishap'), 'and the nat-1 mishap has not fired yet');
  const ev2 = spendLuck(combat, () => 0.99); // reroll d20 20 -> success
  assert.ok(ev2.some((e) => e.type === 'spell-cast' && e.success), 'the reroll landed the cast');
  assert.ok(!c.burned.includes('ember-bolt'), 'a saved spell is not burned');
}

// --- 16. a minion bodyguards its controller — the foe can't reach them ---
{
  const h = hero({ id: 'hero', hp: 100 });
  const wolf = minion({ ownerId: h.id, hp: 100, ac: 1000 }); // owned by this hero, hard to kill
  const g = foe({ id: 'goblin', hp: 1000, ac: 1000, attacks: [{ name: 'poke', toHit: 100, damage: '1d4' }] });
  const { combat } = createCombat([h, wolf], [g], () => 0.5);
  combat.turnIndex = combat.order.findIndex((c) => c.id.startsWith('goblin'));
  const ev = runAiTurns(combat, () => 0.5);
  const foeAtk = ev.find((e) => e.type === 'attack' && e.attackerSide === 'foe');
  assert.ok(foeAtk, 'the foe took its swing');
  assert.notEqual(foeAtk.targetId, h.id, 'the guarded controller was spared');
  assert.equal(foeAtk.targetId, wolf.id, 'the minion took the hit instead');
}

// --- 17. the familiar's keeper is a hero, never the dragon ---
{
  const dragon = makeCombatant({ id: 'dragon', name: 'Red Dragon', kind: 'dragon', ac: 18, hp: 100 });
  const caster = hero({ id: 'mage', castStat: 'int', abilities: { int: 3 }, spells: ['ember-bolt'] });
  caster.familiar = 'ember-wisp'; // beginCombat pins the familiar to a caster, not the dragon
  const { combat } = createCombat([dragon, caster], [foe({ id: 'goblin', hp: 100, ac: 12 })], () => 0.5);
  const fam = combat.combatants.find((c) => c.minionType === 'familiar');
  assert.ok(fam, 'the familiar joined the field');
  assert.equal(fam.ownerId, caster.id, 'the caster hero keeps it');
  assert.notEqual(fam.ownerId, dragon.id, 'the dragon does not');
}

// --- 18. familiars are per-hero — each hero fields their own ---
{
  const a = hero({ id: 'aaa' }); a.familiar = 'ember-wisp';
  const b = hero({ id: 'bbb' }); b.familiar = 'fae-drake';
  const plain = hero({ id: 'ccc' }); // no familiar
  const { combat } = createCombat([a, b, plain], [foe({ id: 'goblin', hp: 100, ac: 12 })], () => 0.5);
  const fams = combat.combatants.filter((c) => c.minionType === 'familiar');
  assert.equal(fams.length, 2, 'two heroes with familiars => two familiar sprites');
  assert.ok(fams.some((f) => f.ownerId === a.id) && fams.some((f) => f.ownerId === b.id), 'each owned by its hero');
}

// --- 19. the Dusk Bat gives its owner advantage on Drain Life ---
{
  const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', spells: ['drain-life'] });
  c.familiar = 'dusk-bat';
  const g = foe({ id: 'goblin', hp: 100, ac: 1000 });
  const { combat } = createCombat([c], [g], () => 0.5);
  // Two d20 rolls (advantage): first 2 (would fail vs DC 12), then 15 (succeeds);
  // advantage keeps the 15. Then the 1d6 drain roll.
  let i = 0; const seq = [0.05, 0.7, 0.5]; const rng = () => (i < seq.length ? seq[i++] : 0.5);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'drain-life', g.id, rng);
  assert.ok(ev.find((e) => e.type === 'spell-cast')?.success, 'advantage lands the drain the low roll would have flubbed');
}

// --- 20. the Fae Drake shaves 1 off its owner's casting DC, and says so ---
{
  const withFam = () => {
    const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', spells: ['ember-bolt'] });
    c.familiar = 'fae-drake';
    return c;
  };
  const plain = () => hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', spells: ['ember-bolt'] });
  const cast = (h) => {
    const g = foe({ id: 'goblin', hp: 100, ac: 1000 });
    const { combat } = createCombat([h], [g], () => 0.5);
    return playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', g.id, () => 0.5)
      .find((e) => e.type === 'spell-cast');
  };
  const bare = cast(plain());
  const aided = cast(withFam());
  assert.equal(bare.dc - aided.dc, 1, 'the drake lowers the casting DC by exactly 1');
  assert.equal(aided.famAid?.effect, 'spell-focus', 'and the cast credits the drake');
  assert.equal(bare.famAid, null, 'no familiar, no credit');
}

// --- 21. the Ember Wisp adds 1 damage to its owner's spells, and says so ---
{
  const shoot = (famId) => {
    const c = hero({ id: 'hero', abilities: { cha: 5 }, castStat: 'cha', spells: ['ember-bolt'] });
    c.familiar = famId;
    const g = foe({ id: 'goblin', hp: 100, ac: 1000 });
    const { combat } = createCombat([c], [g], () => 0.5);
    const ev = playerSpell(heroTurn(combat, 'hero'), 'ember-bolt', g.id, () => 0.5);
    return ev.find((e) => e.type === 'spell-hit');
  };
  const bare = shoot(null);
  const aided = shoot('ember-wisp');
  assert.equal(aided.damage - bare.damage, 1, 'the wisp adds exactly 1 damage');
  assert.equal(aided.famAid?.effect, 'fire-boost', 'and the hit credits the wisp');
  assert.equal(bare.famAid, null, 'no familiar, no credit');
  // a familiar whose knack has nothing to do with damage changes neither
  const other = shoot('fae-drake');
  assert.equal(other.damage, bare.damage, 'the drake does not pad damage');
  assert.equal(other.famAid, null, 'and takes no credit for it');
}

// --- 22. a drawn familiar carries its sprite strips onto the card ---
{
  const drawn = hero({ id: 'aaa' }); drawn.familiar = 'fae-drake';
  const undrawn = hero({ id: 'bbb' }); undrawn.familiar = 'pack-rat';
  const { combat } = createCombat([drawn, undrawn], [foe({ id: 'goblin', hp: 100, ac: 12 })], () => 0.5);
  const fams = Object.fromEntries(
    combat.combatants.filter((c) => c.minionType === 'familiar').map((c) => [c.ownerId, c])
  );
  assert.equal(fams[drawn.id].anim?.idle, 'fae-drake-idle', 'the drake brings its strip');
  assert.equal(fams[undrawn.id].anim, null, 'an undrawn familiar has none');
  assert.equal(fams[undrawn.id].emoji, '🐀', 'and falls back to its emoji');
}

// --- 23. a cast with advantage reports BOTH dice, so the view can show them ---
{
  // Two rolls: 2 then 15. Advantage keeps the 15 and the event carries both.
  const rolls = () => { let i = 0; const seq = [0.05, 0.7, 0.5]; return () => (i < seq.length ? seq[i++] : 0.5); };
  const castWith = (over, spellId) => {
    const c = hero({ id: 'hero', abilities: { cha: 0 }, castStat: 'cha', spells: [spellId], ...over });
    if (over.familiar) c.familiar = over.familiar;
    const g = foe({ id: 'goblin', hp: 100, ac: 1000 });
    const { combat } = createCombat([c], [g], () => 0.5);
    return playerSpell(heroTurn(combat, 'hero'), spellId, g.id, rolls()).find((e) => e.type === 'spell-cast');
  };

  // Magic Missile carries its own advantage (Shadowdark) — no talent, no familiar.
  const mm = castWith({}, 'magic-missile');
  assert.equal(mm.mode, 'advantage', 'Magic Missile always rolls with advantage');
  assert.equal(mm.advSource, 'spell', 'and the spell itself is the source');
  assert.deepEqual(mm.dieRolls, [2, 15], 'both dice ride out on the event');
  assert.equal(mm.natural, 15, 'the kept die is the better one');

  // The Dusk Bat supplies it for Drain Life, and says so.
  const bat = castWith({ familiar: 'dusk-bat' }, 'drain-life');
  assert.equal(bat.mode, 'advantage', 'the Dusk Bat grants advantage on Drain Life');
  assert.equal(bat.advSource, 'familiar', 'credited to the familiar');
  assert.equal(bat.dieRolls.length, 2, 'and two dice reach the view');
  assert.equal(bat.famAid?.effect, 'drain-boost', 'the log line still names the bat');

  // A Spell Focus talent supplies it for its own school.
  const focus = castWith({ talents: ['focus-fire'] }, 'ember-bolt');
  assert.equal(focus.advSource, 'focus', 'Fire Focus grants advantage on a fire spell');

  // No source: one die, straight, and nothing to explain.
  const plain = castWith({}, 'ember-bolt');
  assert.equal(plain.mode, 'straight', 'an unaided cast rolls once');
  assert.equal(plain.advSource, null, 'with no advantage to credit');
  assert.deepEqual(plain.dieRolls, [2], 'and reports the single die');
}

// --- 24. spell tiers gate learning, and nobody opens play above their tier ---
{
  assert.equal(maxSpellTier(1), 1, 'a 1st-level caster reaches tier 1');
  assert.equal(maxSpellTier(2), 1, 'still tier 1 at 2nd');
  assert.equal(maxSpellTier(3), 2, 'tier 2 opens at 3rd');
  assert.equal(maxSpellTier(5), 3, 'tier 3 opens at 5th');
  assert.equal(maxSpellTier(9), 5, 'tier 5 opens at 9th');
  assert.equal(maxSpellTier(20), 5, 'and stops there');

  const fireball = spellById('flame-wave');
  const burningHands = spellById('burning-hands');
  assert.equal(fireball.tier, 3, 'Fireball is tier 3');
  assert.equal(burningHands.tier, 1, 'Burning Hands is its tier-1 stand-in');
  assert.ok(!canLearnSpell(1, fireball), 'a 1st-level caster cannot learn Fireball');
  assert.ok(canLearnSpell(5, fireball), 'a 5th-level caster can');
  assert.ok(canLearnSpell(1, burningHands), 'Burning Hands is open from 1st');

  // The arcanist starts inside tier 1 rather than holding two tier-3 spells.
  const blade = companionById('dragonkin-spellblade');
  for (const sid of blade.spells) {
    assert.ok(spellById(sid), `${sid} is a real spell`);
    assert.ok(canLearnSpell(1, spellById(sid)), `the Spellblade opens with ${sid} inside tier 1`);
  }
}

// A harmless foe, so a focus test measures the upkeep check and nothing else.
const dummy = (over = {}) =>
  foe({ id: 'goblin', hp: 100, ac: 12, attacks: [{ name: 'bite', toHit: -100, damage: '1d4' }], ...over });

// --- 25. Acid Arrow: it bites on impact, then again every turn you hold focus ---
{
  const c = hero({ id: 'hero', abilities: { int: 5 }, castStat: 'int', spells: ['acid-arrow'] });
  const g = dummy();
  const { combat } = createCombat([c], [g], () => 0.5);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'acid-arrow', g.id, () => 0.5);
  const hit = ev.find((e) => e.type === 'spell-hit');
  assert.ok(hit.damage > 0, 'the arrow lands');
  assert.equal(c.focus?.spellId, 'acid-arrow', 'and the caster is now focusing on it');
  assert.equal(c.focus.targetId, g.id, 'on the foe it struck');
  const burn = g.conditions.find((k) => k.id === 'acid-burn');
  assert.ok(burn, 'the foe is burning');
  assert.equal(burn.focusOf, c.id, 'held by its caster, not by a clock');
  assert.equal(burn.rounds, undefined, 'so it has no rounds of its own');

  // Let the round come back around: the upkeep check fires as the caster's turn
  // begins. 0.5 -> d20 11, +5 INT = 16 vs DC 11, so it holds.
  const hpBefore = g.hp.current;
  const back = runAiTurns(combat, () => 0.5);
  assert.ok(back.some((e) => e.type === 'focus-check' && e.success), 'the upkeep check holds');
  const tick = back.find((e) => e.type === 'focus-tick');
  assert.ok(tick && tick.damage > 0, 'and the acid bites again');
  assert.equal(tick.dtype, 'acid', 'as acid, not fire');
  assert.ok(g.hp.current < hpBefore, 'the foe keeps losing HP');
}

// --- 26. a failed upkeep check ends the focus and lifts what it was holding ---
{
  const c = hero({ id: 'hero', abilities: { int: 0 }, castStat: 'int', spells: ['acid-arrow'] });
  const g = dummy();
  const { combat } = createCombat([c], [g], () => 0.5);
  playerSpell(heroTurn(combat, 'hero'), 'acid-arrow', g.id, () => 0.9); // 0.9 -> 19, lands
  assert.ok(c.focus, 'focusing');
  // 0.1 -> d20 3, +0 = 3 vs DC 11: the concentration slips (but it isn't a nat 1).
  const ev = runAiTurns(combat, () => 0.1);
  assert.ok(ev.some((e) => e.type === 'focus-check' && !e.success), 'the check fails');
  assert.equal(ev.find((e) => e.type === 'focus-end')?.reason, 'lost', 'the focus ends');
  assert.equal(c.focus, null, 'the caster is no longer concentrating');
  assert.ok(!g.conditions.some((k) => k.id === 'acid-burn'), 'and the acid stops eating');
  assert.ok(!c.burned.includes('acid-arrow'), 'an ordinary slip does not burn the spell');
}

// --- 27. Sleep takes a foe out: it loses turns, is struck at advantage, wakes on a hit ---
{
  const c = hero({ id: 'hero', abilities: { int: 5 }, castStat: 'int', spells: ['sleep'],
    attacks: [{ name: 'poke', toHit: 100, damage: '1d4' }] });
  const g = foe({ id: 'goblin', hp: 100, ac: 12, attacks: [{ name: 'bite', toHit: 100, damage: '1d4' }] });
  const { combat } = createCombat([c, g], [], () => 0.5);
  const ev = playerSpell(heroTurn(combat, 'hero'), 'sleep', g.id, () => 0.5);
  const start = ev.find((e) => e.type === 'condition-start');
  assert.equal(start?.cond, 'asleep', 'the goblin is asleep');
  assert.ok(start.rounds >= 1 && start.rounds <= 4, '1d4 rounds');
  assert.ok(g.conditions.some((k) => k.disable), 'and disabled');

  // Its turn comes and goes without it acting.
  const ai = runAiTurns(combat, () => 0.5);
  assert.ok(ai.some((e) => e.type === 'condition-skip' && e.id === g.id), 'it sleeps through its turn');
  assert.ok(!ai.some((e) => e.type === 'attack' && e.attackerId === g.id), 'and never swings');

  // The next hit is rolled at advantage, and wakes it.
  const hpMax = g.hp.max;
  const swing = playerAttack(heroTurn(combat, 'hero'), g.id, () => 0.5);
  const atk = swing.find((e) => e.type === 'attack');
  assert.equal(atk.mode, 'advantage', 'a sleeper is struck at advantage');
  assert.ok(swing.some((e) => e.type === 'condition-end' && e.woken), 'and the blow wakes it');
  assert.ok(!g.conditions.some((k) => k.id === 'asleep'), 'no longer asleep');
  assert.ok(hpMax, 'sanity');
}

// --- 28. Hold Person: a save resists it, and it lasts only while focus holds ---
{
  const held = () => {
    const c = hero({ id: 'hero', abilities: { int: 5 }, castStat: 'int', spells: ['hold-person'] });
    const g = foe({ id: 'goblin', hp: 100, ac: 12, abilities: { wis: -5 } }); // will fail the save
    const { combat } = createCombat([c, g], [], () => 0.5);
    const ev = playerSpell(heroTurn(combat, 'hero'), 'hold-person', g.id, () => 0.5);
    return { c, g, combat, ev };
  };
  const { c, g, ev } = held();
  assert.ok(ev.some((e) => e.type === 'condition-start' && e.cond === 'held'), 'the goblin is held');
  assert.equal(c.focus?.spellId, 'hold-person', 'and the caster is concentrating on it');
  assert.ok(g.conditions.some((k) => k.disable && k.focusOf === c.id), 'held by the focus');

  // A tough-willed foe shrugs it off instead.
  const c2 = hero({ id: 'hero', abilities: { int: 0 }, castStat: 'int', spells: ['hold-person'] });
  const g2 = foe({ id: 'goblin', hp: 100, ac: 12, abilities: { wis: 10 } });
  const { combat: cb2 } = createCombat([c2, g2], [], () => 0.5);
  const ev2 = playerSpell(heroTurn(cb2, 'hero'), 'hold-person', g2.id, () => 0.9);
  assert.equal(ev2.find((e) => e.type === 'control-resisted')?.reason, 'save', 'a strong will resists');
  assert.equal(c2.focus, null, 'and no focus is started');
  assert.ok(!g2.conditions.some((k) => k.id === 'held'), 'the foe is free');
}

// --- 29. Holy Weapon buffs an ally's swing for a fixed count of rounds ---
{
  const setup = (bless) => {
    const priest = hero({ id: 'hero', abilities: { wis: 5 }, castStat: 'wis', spells: ['holy-weapon'] });
    const knight = hero({ id: 'ally', name: 'Knight', abilities: {},
      attacks: [{ name: 'sword', toHit: 0, damage: '1d6' }] });
    const g = foe({ id: 'goblin', hp: 500, ac: 5 });
    const { combat } = createCombat([priest, knight, g], [], () => 0.5);
    if (bless) playerSpell(heroTurn(combat, 'hero'), 'holy-weapon', knight.id, () => 0.5);
    return { priest, knight, g, combat };
  };
  const { knight, g, combat } = setup(true);
  const cond = knight.conditions.find((k) => k.id === 'holy-weapon');
  assert.ok(cond, 'the knight is blessed');
  assert.equal(cond.rounds, 5, 'for 5 rounds');
  assert.equal(cond.toHit, 1, '+1 to hit');
  assert.equal(cond.damage, 1, '+1 damage');

  const blessed = playerAttack(heroTurn(combat, 'ally'), g.id, () => 0.5).find((e) => e.type === 'attack');
  const plain = setup(false);
  const bare = playerAttack(heroTurn(plain.combat, 'ally'), plain.g.id, () => 0.5).find((e) => e.type === 'attack');
  assert.equal(blessed.toHit - bare.toHit, 1, 'the blessed swing is +1 to hit');
  assert.equal(blessed.damage - bare.damage, 1, 'and deals 1 more');
  // A buff is not concentration — the priest holds no focus for it.
  assert.equal(setup(true).priest.focus, null, 'Holy Weapon needs no focus');
}

console.log('combat.test.js: all assertions passed ✓');
