// Dice sanity (plan §4 checklist) + determinism checks.
// Run with: npm test  (plain node, no framework)

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { roll, d20, save } from '../src/engine/dice.js';
import { makeSeededRNG } from '../src/engine/rng.js';
import { generateDungeon } from '../src/world/maze.js';
import {
  tierAfterBanking,
  resolveBreathOn,
  rollBreathRecharge,
  moraleCheck,
  lootScale,
  resolveAttack,
} from '../src/engine/rules.js';
import { MONSTERS, monsterById } from '../data/monsters.js';
import { SPRITES } from '../src/assets-manifest.js';
import { SPELLS, spellById } from '../data/spells.js';
import { COMPANIONS, companionById } from '../data/party.js';
import { resolveSpellCast } from '../src/engine/rules.js';
import { makeCombatant, makeDragonCombatant } from '../src/engine/entities.js';
import { tierByName } from '../data/dragonProgression.js';
import {
  createCombat,
  runMonsterTurns,
  playerSpell,
  isPlayerTurn,
  livingMonsters,
} from '../src/engine/combat.js';

const N = 10_000;
let passed = 0;

function check(name, fn) {
  fn();
  passed++;
  console.log(`  ok — ${name}`);
}

// ---- each die type: min/max/mean in range over 10k rolls
for (const sides of [4, 6, 8, 10, 12, 20]) {
  check(`1d${sides} x ${N}`, () => {
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const r = roll(`1d${sides}`);
      assert.equal(r.rolls.length, 1);
      min = Math.min(min, r.total);
      max = Math.max(max, r.total);
      sum += r.total;
    }
    assert.equal(min, 1, `d${sides} should reach 1`);
    assert.equal(max, sides, `d${sides} should reach ${sides}`);
    const mean = sum / N;
    const expected = (sides + 1) / 2;
    const tolerance = sides * 0.035 + 0.05; // ~10σ for 10k rolls
    assert.ok(
      Math.abs(mean - expected) < tolerance,
      `d${sides} mean ${mean.toFixed(3)} not within ${tolerance} of ${expected}`
    );
  });
}

// ---- compound expressions
check('2d6+1 bounds and mean', () => {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const r = roll('2d6+1');
    min = Math.min(min, r.total);
    max = Math.max(max, r.total);
    sum += r.total;
  }
  assert.ok(min >= 3 && max <= 13, `bounds ${min}..${max} outside 3..13`);
  assert.ok(Math.abs(sum / N - 8) < 0.25, `mean ${sum / N} not near 8`);
});

check('3d6-2 never below 1 total bound', () => {
  for (let i = 0; i < 2000; i++) {
    const r = roll('3d6-2');
    assert.ok(r.total >= 1 && r.total <= 16);
  }
});

check('bad expressions throw', () => {
  for (const bad of ['', '2x6', 'd', '0d6', '2d1', 'banana']) {
    assert.throws(() => roll(bad), undefined, `should throw: ${bad}`);
  }
});

// ---- d20 advantage/disadvantage
check('advantage beats disadvantage on average', () => {
  let adv = 0;
  let dis = 0;
  for (let i = 0; i < N; i++) {
    adv += d20({ advantage: true }).total;
    dis += d20({ disadvantage: true }).total;
  }
  assert.ok(adv / N > 12.5 && adv / N < 15.2, `advantage mean ${adv / N}`);
  assert.ok(dis / N > 5.8 && dis / N < 8.5, `disadvantage mean ${dis / N}`);
});

check('save() compares vs DC', () => {
  const s = save(10, 100);
  assert.equal(s.success, true);
  const f = save(30, -100);
  assert.equal(f.success, false);
});

// ---- seeded RNG determinism
check('same seed, same stream', () => {
  const a = makeSeededRNG('cazic-thule');
  const b = makeSeededRNG('cazic-thule');
  for (let i = 0; i < 100; i++) assert.equal(a(), b());
});

check('different seeds diverge', () => {
  const a = makeSeededRNG('guk-alpha');
  const b = makeSeededRNG('guk-beta');
  const same = Array.from({ length: 20 }, () => a() === b()).filter(Boolean).length;
  assert.ok(same < 20, 'streams should not be identical');
});

// ---- maze determinism (plan checklist: same seed → same maze)
check('same seed produces the identical dungeon', () => {
  const a = generateDungeon('dragon-seed-1', 1);
  const b = generateDungeon('dragon-seed-1', 1);
  assert.deepEqual(a, b);
});

check('different seed produces a different dungeon', () => {
  const a = generateDungeon('dragon-seed-1', 1);
  const b = generateDungeon('dragon-seed-2', 1);
  assert.notDeepEqual(a.tiles, b.tiles);
});

check('dungeon is well-formed and connected', () => {
  for (const seed of ['a', 'b', 'c', 'xyzzy', '12345']) {
    const d = generateDungeon(seed, 1);
    assert.equal(d.tiles.length, d.height);
    assert.equal(d.tiles[0].length, d.width);
    assert.equal(d.tiles[d.start.y][d.start.x], 1, 'start is floor');
    assert.equal(d.tiles[d.exit.y][d.exit.x], 1, 'exit is floor');
    assert.ok(d.encounters.length >= 3 && d.encounters.length <= 5);
    assert.ok(d.loot.length <= 4);
    for (const l of d.loot) assert.ok(l.gold >= 2, 'loot has gold');
    // flood-fill: every floor tile reachable from start
    const seen = new Set([`${d.start.x},${d.start.y}`]);
    const queue = [[d.start.x, d.start.y]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (
          nx >= 0 && nx < d.width && ny >= 0 && ny < d.height &&
          d.tiles[ny][nx] === 1 && !seen.has(`${nx},${ny}`)
        ) {
          seen.add(`${nx},${ny}`);
          queue.push([nx, ny]);
        }
      }
    }
    let floors = 0;
    for (const row of d.tiles) for (const t of row) if (t === 1) floors++;
    assert.equal(seen.size, floors, `all floor tiles reachable (seed ${seed})`);
  }
});

// ---- Phase 1 rules
check('tier-ups are hoard-gated', () => {
  assert.deepEqual(tierAfterBanking('wyrmling', 999), []);
  assert.deepEqual(tierAfterBanking('wyrmling', 1000).map((t) => t.tier), ['young']);
  assert.deepEqual(tierAfterBanking('wyrmling', 6000).map((t) => t.tier), ['young', 'adult']);
  assert.deepEqual(tierAfterBanking('young', 4999), []);
  assert.deepEqual(tierAfterBanking('ancient', 999999), []);
});

check('breath save halves damage', () => {
  const alwaysHigh = () => 0.99; // d20 = 20
  const alwaysLow = () => 0; // d20 = 1
  const nimble = { abilities: { dex: 2 } };
  const saved = resolveBreathOn(nimble, 13, 11, alwaysHigh);
  assert.equal(saved.saved, true);
  assert.equal(saved.damage, 5); // floor(11/2)
  const caught = resolveBreathOn(nimble, 13, 11, alwaysLow);
  assert.equal(caught.saved, false);
  assert.equal(caught.damage, 11);
  assert.equal(resolveBreathOn(nimble, 13, 1, alwaysHigh).damage, 1, 'half damage never below 1');
});

check('breath recharge on 5+', () => {
  for (let i = 0; i < 2000; i++) {
    const r = rollBreathRecharge();
    assert.ok(r.roll >= 1 && r.roll <= 6);
    assert.equal(r.ready, r.roll >= 5);
  }
});

check('morale: fearless never breaks, cowards can', () => {
  const skeleton = monsterById('skeleton');
  assert.equal(skeleton.morale, null);
  assert.equal(moraleCheck(skeleton).pass, true);
  const rat = { morale: -2 };
  assert.equal(moraleCheck(rat, () => 0).pass, false); // d20=1, total -1 vs 12
  assert.equal(moraleCheck(rat, () => 0.99).pass, true); // d20=20, total 18 vs 12
});

check('advantage rolls twice and keeps best', () => {
  const seq = [0.1, 0.9, 0.5]; // d20: 3, then 19; damage d6: 4
  let i = 0;
  const rng = () => seq[i++];
  const attacker = { abilities: {} };
  const res = resolveAttack(attacker, { name: 'bite', toHit: 4, damage: '1d6' }, { ac: 15 }, rng, { advantage: true });
  assert.equal(res.mode, 'advantage');
  assert.deepEqual(res.dieRolls, [3, 19]);
  assert.equal(res.natural, 19);
  assert.equal(res.hit, true);
});

check('loot scales with depth', () => {
  assert.equal(lootScale(1), 1);
  assert.ok(lootScale(4) > lootScale(2));
});

check('encounters respect min/max depth', () => {
  for (const depth of [1, 2, 5]) {
    const d = generateDungeon(`depth-check-${depth}`, depth);
    for (const enc of d.encounters) {
      for (const id of enc.monsterIds) {
        const m = monsterById(id);
        assert.ok((m.minDepth ?? 1) <= depth, `${id} too deep for its minDepth at depth ${depth}`);
        assert.ok(depth <= (m.maxDepth ?? Infinity), `${id} should have retired by depth ${depth}`);
      }
    }
  }
});

check('sprite manifest is complete and every strip exists', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  for (const [key, rel] of Object.entries(SPRITES)) {
    assert.ok(existsSync(join(root, rel)), `manifest entry ${key} missing on disk`);
  }
  for (const key of ['dragon-fly', 'dragon-up', 'dragon-down']) {
    assert.ok(SPRITES[key], `player strip ${key} not in manifest`);
  }
  for (const m of MONSTERS.filter((m) => m.anim)) {
    assert.ok(SPRITES[m.anim.idle], `${m.id} idle strip not in manifest`);
    assert.ok(SPRITES[m.anim.attack], `${m.id} attack strip not in manifest`);
  }
});

check('roster is Phase-1 sized with sane stats', () => {
  assert.ok(MONSTERS.length >= 8 && MONSTERS.length <= 15, `roster size ${MONSTERS.length}`);
  for (const m of MONSTERS) {
    assert.ok(m.ac >= 8 && m.ac <= 20, `${m.id} ac`);
    assert.ok(m.hpMax >= 1, `${m.id} hp`);
    assert.ok(m.attacks.length >= 1, `${m.id} attacks`);
    assert.ok(m.goldValue > 0, `${m.id} gold`);
    roll(m.attacks[0].damage); // throws if the dice expression is malformed
  }
});

// ---- spells & party
check('spellbook is well-formed and companion spells exist', () => {
  for (const s of SPELLS) {
    roll(s.dice); // throws on a malformed expression
    assert.ok(['enemy', 'ally', 'all-enemies'].includes(s.target), `${s.id} target`);
    assert.ok(s.castDC >= 10 && s.castDC <= 15, `${s.id} castDC`);
  }
  for (const c of COMPANIONS) {
    for (const id of c.spells) assert.ok(spellById(id), `${c.id} knows unknown spell ${id}`);
    assert.ok(SPRITES[c.anim.idle] && SPRITES[c.anim.attack], `${c.id} strips in manifest`);
  }
});

check('spell casting: nat 20 works, nat 1 fizzles', () => {
  const caster = { abilities: { cha: 2 } };
  const spell = spellById('ember-bolt');
  assert.equal(resolveSpellCast(caster, spell, () => 0.99).success, true);
  assert.equal(resolveSpellCast(caster, spell, () => 0).success, false);
});

check('party combat: monsters fight heroes, heals can revive', () => {
  const dragon = makeDragonCombatant(tierByName('wyrmling'));
  const knight = makeCombatant(companionById('dragonkin-knight'));
  const swash = makeCombatant(companionById('dragonkin-swashbuckler'));
  const troll = makeCombatant(monsterById('cave-troll'));
  const seq = [0.5, 0.6, 0.4, 0.3]; // initiative rolls, then combat dice
  let i = 0;
  const rng = () => (i < seq.length ? seq[i++] : 0.99);
  const { combat } = createCombat([dragon, knight, swash], [troll], rng);
  assert.equal(combat.order.length, 4);
  runMonsterTurns(combat, rng);
  assert.ok(isPlayerTurn(combat), 'a hero should be up after monster turns');

  // knock the knight down, then Healing Word him back up mid-fight
  knight.hp.current = 0;
  swash.burned = [];
  while (combat.order[combat.turnIndex].id !== swash.id) combat.turnIndex++;
  const events = playerSpell(combat, 'healing-word', knight.id, () => 0.99);
  const heal = events.find((e) => e.type === 'spell-heal');
  assert.ok(heal, 'heal event emitted');
  assert.equal(heal.revived, true);
  assert.ok(knight.hp.current > 0, 'knight revived');
  assert.equal(livingMonsters(combat).length, 1);
});

console.log(`\n${passed} checks passed.`);
