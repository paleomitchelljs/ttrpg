// Dice sanity (plan §4 checklist) + determinism checks.
// Run with: npm test  (plain node, no framework)

import assert from 'node:assert/strict';
import { roll, d20, save } from '../src/engine/dice.js';
import { makeSeededRNG } from '../src/engine/rng.js';
import { generateDungeon } from '../src/world/maze.js';

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

console.log(`\n${passed} checks passed.`);
