// The shared autotiler: outer-vs-internal wall classification, the thin-run
// pieces, edge floors, and the guarantee that a theme declaring only one wall
// set renders exactly as it did before. Pure functions — plain node, no DOM.

import assert from 'node:assert/strict';
import {
  AUTOTILE,
  outerWalls,
  isInnerWall,
  wallKey,
  floorVariant,
  autotileKeys,
} from '../src/render/autotile.js';

// Build the `d` shape the pickers want from ASCII ('#' wall, else floor).
const geom = (rows) => ({
  width: rows[0].length,
  height: rows.length,
  tiles: rows.map((r) => [...r].map((ch) => (ch === '#' ? 0 : 1))),
});

// A room with a border ring and one free-standing wall island inside it.
const ROOM = geom([
  '#######',
  '#.....#',
  '#.###.#',
  '#.###.#',
  '#.....#',
  '#######',
]);

// --- 1. the border ring is outer, the island inside it is not ---
{
  const outer = outerWalls(ROOM);
  assert.equal(outer[0][0], true, 'a border corner is outer');
  assert.equal(outer[0][3], true, 'the top run is outer');
  assert.equal(outer[3][6], true, 'the right run is outer');
  assert.equal(outer[2][2], false, 'the island is not outer');
  assert.equal(outer[3][4], false, 'nor its far side');
  assert.equal(outer[1][1], false, 'a floor cell is never outer');
  assert.equal(isInnerWall(ROOM, 2, 2), true, 'island cell reads internal');
  assert.equal(isInnerWall(ROOM, 0, 0), false, 'border cell does not');
  assert.equal(isInnerWall(ROOM, 1, 1), false, 'a floor cell is not a wall at all');
}

// --- 2. a spur touching the perimeter counts as outer, all the way in ---
{
  const spur = geom([
    '#######',
    '#..#..#',
    '#..#..#',
    '#.....#',
    '#######',
  ]);
  const outer = outerWalls(spur);
  assert.equal(outer[1][3], true, 'the spur hangs off the border, so it is outer');
  assert.equal(outer[2][3], true, 'including its far end');
}

// --- 3. a diagonal touch does NOT connect (4-connectivity) ---
{
  const diag = geom([
    '#####',
    '#...#',
    '#.#.#', // this island only meets the border corner-to-corner
    '#...#',
    '#####',
  ]);
  assert.equal(outerWalls(diag)[2][2], false, 'diagonal contact is not connection');
}

// --- 4. results are cached per geometry object, and per object only ---
{
  assert.equal(outerWalls(ROOM), outerWalls(ROOM), 'same object -> same grid, memoized');
  const twin = geom(['###', '#.#', '###']);
  assert.notEqual(outerWalls(twin), outerWalls(geom(['###', '#.#', '###'])), 'a fresh object recomputes');
}

// --- 4b. a map can overrule the inference wholesale ---
{
  const forcedIn = { ...ROOM, wallStyle: 'inner' };
  assert.equal(outerWalls(forcedIn)[0][0], false, "wallStyle 'inner' -> even the border is a partition");
  assert.equal(isInnerWall(forcedIn, 0, 0), true);
  const forcedOut = { ...ROOM, wallStyle: 'outer' };
  assert.equal(outerWalls(forcedOut)[2][2], true, "wallStyle 'outer' -> even an island is shell");
  assert.equal(outerWalls(forcedOut)[1][1], false, 'but a floor cell is still not a wall');
}

// --- 5. a theme with no wallInner is untouched by any of this ---
{
  const before = wallKey(AUTOTILE.palace, ROOM, 2, 2); // an internal island cell
  assert.ok(before, 'still resolves to a tile');
  assert.ok(
    !JSON.stringify(AUTOTILE.palace.wall).includes('undefined'),
    'the outer set is fully populated'
  );
  // Every cell of the room resolves to a real key, internal or not.
  for (let y = 0; y < ROOM.height; y++) {
    for (let x = 0; x < ROOM.width; x++) {
      if (ROOM.tiles[y][x] === 1) continue;
      assert.ok(typeof wallKey(AUTOTILE.palace, ROOM, x, y) === 'string', `key at ${x},${y}`);
    }
  }
}

// --- 6. wallInner routes internal cells to the second set, outer cells stay ---
{
  const cfg = {
    ...AUTOTILE.palace,
    wallInner: { ...AUTOTILE.palace.wall, top: 'IN-top', bottom: 'IN-bottom', iNE: 'IN-ine' },
    fallbackInner: 'IN-fill',
  };
  // (x, y). The island spans x 2..4, y 2..3 inside a border ring.
  assert.equal(wallKey(cfg, ROOM, 3, 2), 'IN-bottom', 'island top row: floor above -> internal bottom-cap');
  assert.equal(wallKey(cfg, ROOM, 3, 3), 'IN-top', 'island bottom row: floor below -> internal top-cap');
  // Pieces are named for where the wall BODY sits, so the island's bottom-left
  // cell (floor to its S and W) is the iNE nub.
  assert.equal(wallKey(cfg, ROOM, 2, 3), 'IN-ine', 'island corner -> the internal inner corner');
  assert.equal(wallKey(cfg, ROOM, 3, 0), AUTOTILE.palace.wall.top, 'the border above it stays OUTER');
  assert.equal(wallKey(cfg, ROOM, 0, 0), 'palace-fill', 'and the outer fallback is still the outer one');
}

// --- 7. thin runs: floor on opposite sides picks thinH / thinV ---
{
  const cfg = {
    floor: ['f'],
    wall: { top: 'top', bottom: 'bottom', left: 'left', right: 'right', thinH: 'RUN-H', thinV: 'RUN-V' },
    fallback: 'fill',
  };
  const hRun = geom([
    '.....',
    '.###.', // floor above and below -> an east-west run
    '.....',
  ]);
  assert.equal(wallKey(cfg, hRun, 2, 1), 'RUN-H', 'floor N and S -> the wall runs east-west');
  const vRun = geom([
    '..#..',
    '..#..',
    '..#..',
  ]);
  assert.equal(wallKey(cfg, vRun, 2, 1), 'RUN-V', 'floor E and W -> the wall runs north-south');
  // ...and without those keys it falls through to the old edge behaviour
  const plain = { ...cfg, wall: { top: 'top', bottom: 'bottom', left: 'left', right: 'right' } };
  assert.equal(wallKey(plain, hRun, 2, 1), 'top', 'no thinH declared -> unchanged from before');
}

// --- 8. floorEdge only fires beside an OUTER wall ---
{
  const cfg = {
    floor: ['plain'],
    wall: AUTOTILE.palace.wall,
    fallback: 'palace-fill',
    floorEdge: { n: 'E-n', e: 'E-e', s: 'E-s', w: 'E-w' },
  };
  assert.equal(floorVariant(cfg, ROOM, 3, 1), 'E-n', 'floor under the top border takes the n edge');
  assert.equal(floorVariant(cfg, ROOM, 1, 2), 'E-w', 'floor beside the left border takes the w edge');
  // (1,4) sits under the island and above the bottom border: the border wins
  // because the island is internal and edge floors belong to outer wall only.
  assert.equal(floorVariant(cfg, ROOM, 3, 4), 'E-s', 'the internal island does not claim an edge floor');
  const open = geom(['.....', '.....', '.....']);
  assert.equal(floorVariant(cfg, open, 2, 1), 'plain', 'floor touching no wall stays plain');
  const noEdge = { ...cfg, floorEdge: undefined };
  assert.equal(floorVariant(noEdge, ROOM, 3, 1), 'plain', 'no floorEdge declared -> unchanged');
}

// --- 9. the key enumeration covers the new sets (editor palette hygiene) ---
{
  const cfg = {
    floor: ['f'],
    wall: { top: 'w-top' },
    wallInner: { top: 'in-top', thinH: 'in-run' },
    floorEdge: { n: 'edge-n' },
    fallback: 'fill',
    fallbackInner: 'in-fill',
  };
  const keys = autotileKeys(cfg);
  for (const k of ['f', 'w-top', 'in-top', 'in-run', 'edge-n', 'fill', 'in-fill']) {
    assert.ok(keys.has(k), `${k} is claimed as geometry, not decor`);
  }
}

// --- 10. every shipped theme names only tiles that actually exist ---
// A key with no tile behind it renders a BLANK cell rather than failing, so
// this is the guard: check every theme's whole geometry set against the
// generated manifest.
{
  const { TILES } = await import('../src/assets-manifest.js');
  for (const [name, cfg] of Object.entries(AUTOTILE)) {
    for (const k of autotileKeys(cfg)) {
      assert.ok(k && typeof k === 'string' && !k.includes('undefined'), `${name}: bad key ${k}`);
      assert.ok(TILES[k], `${name} names '${k}', which has no tile in assets/tiles`);
    }
  }
}

// --- 11. the palace's internal set is complete enough to autotile a room ---
// Every piece the picker can reach for an internal wall must be declared, or a
// map with partitions gets holes.
{
  const inner = AUTOTILE.palace.wallInner;
  for (const k of ['top', 'bottom', 'left', 'right', 'thinH', 'thinV',
                   'iNW', 'iNE', 'iSW', 'iSE', 'endN', 'endE', 'endS', 'endW']) {
    assert.ok(inner[k], `palace wallInner is missing ${k}`);
  }
  // A one-cell-thick L partition, deliberately not touching the border (a wall
  // that does is outer by design). It exercises a corner, both runs and both
  // kinds of terminus.
  const room = geom([
    '#########',
    '#.......#',
    '#.####..#',
    '#.#.....#',
    '#.#.....#',
    '#.......#',
    '#########',
  ]);
  const outerKeys = new Set(Object.values(AUTOTILE.palace.wall));
  const seen = new Set();
  for (let y = 1; y < room.height - 1; y++) {
    for (let x = 1; x < room.width - 1; x++) {
      if (room.tiles[y][x] === 1) continue;
      const k = wallKey(AUTOTILE.palace, room, x, y);
      seen.add(k);
      assert.ok(k.startsWith('palace-in-'), `interior wall at ${x},${y} drew '${k}'`);
      assert.ok(!outerKeys.has(k), 'and never an outer-shell piece');
    }
  }
  // the cross should exercise runs, corners and at least one terminus
  assert.ok([...seen].some((k) => k.includes('run')), 'straight runs used');
  assert.ok([...seen].some((k) => k.includes('ci-')), 'corners used');
  assert.ok([...seen].some((k) => k.includes('end-')), 'a terminus used');
}

console.log('autotile.test.js: all assertions passed ✓');
