// Braided maze generation, fully deterministic from a seed string.
// Recursive-backtracker carve, then ~45% of dead ends get a wall knocked out
// to form loops. Loot goes in surviving dead ends; the exit is the cell
// farthest from the start; encounters land on cells away from the start.
//
// Cell grid (cellsWide × cellsHigh) maps onto a tile grid of
// (2w+1) × (2h+1): odd/odd tiles are rooms, even tiles between them are
// passages or walls. tiles[y][x] is 0 = wall, 1 = floor.

import { makeSeededRNG, randInt, shuffle } from '../engine/rng.js';
import { MAP } from '../engine/rules.js';
import { rollEncounter } from './encounters.js';
import { rollLoot } from './loot.js';

const DIRS = [
  { dir: 'N', dx: 0, dy: -1, opp: 'S' },
  { dir: 'S', dx: 0, dy: 1, opp: 'N' },
  { dir: 'E', dx: 1, dy: 0, opp: 'W' },
  { dir: 'W', dx: -1, dy: 0, opp: 'E' },
];

export function generateDungeon(seedString, depth = 1) {
  const rng = makeSeededRNG(`dungeon:${seedString}:${depth}`);
  const cw = MAP.cellsWide;
  const ch = MAP.cellsHigh;

  // --- carve a perfect maze with an iterative backtracker
  const open = Array.from({ length: ch }, () =>
    Array.from({ length: cw }, () => ({ N: false, S: false, E: false, W: false }))
  );
  const visited = Array.from({ length: ch }, () => Array(cw).fill(false));
  const inBounds = (x, y) => x >= 0 && x < cw && y >= 0 && y < ch;
  const stack = [[0, 0]];
  visited[0][0] = true;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = DIRS.filter(
      ({ dx, dy }) => inBounds(cx + dx, cy + dy) && !visited[cy + dy][cx + dx]
    );
    if (!options.length) {
      stack.pop();
      continue;
    }
    const { dir, dx, dy, opp } = options[randInt(rng, options.length)];
    open[cy][cx][dir] = true;
    open[cy + dy][cx + dx][opp] = true;
    visited[cy + dy][cx + dx] = true;
    stack.push([cx + dx, cy + dy]);
  }

  const openCount = (x, y) => DIRS.filter(({ dir }) => open[y][x][dir]).length;
  const allCells = [];
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) allCells.push([x, y]);

  // --- braid: open a random wall in ~braidChance of the dead ends
  const deadEnds = shuffle(allCells.filter(([x, y]) => openCount(x, y) === 1), rng);
  for (const [x, y] of deadEnds) {
    if (rng() >= MAP.braidChance) continue;
    const walls = DIRS.filter(
      ({ dir, dx, dy }) => !open[y][x][dir] && inBounds(x + dx, y + dy)
    );
    if (!walls.length) continue;
    const { dir, dx, dy, opp } = walls[randInt(rng, walls.length)];
    open[y][x][dir] = true;
    open[y + dy][x + dx][opp] = true;
  }

  // --- BFS cell distances from the start (0,0)
  const dist = Array.from({ length: ch }, () => Array(cw).fill(-1));
  dist[0][0] = 0;
  const queue = [[0, 0]];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const { dir, dx, dy } of DIRS) {
      if (open[y][x][dir] && dist[y + dy][x + dx] === -1) {
        dist[y + dy][x + dx] = dist[y][x] + 1;
        queue.push([x + dx, y + dy]);
      }
    }
  }

  // --- special cells: start, exit (farthest), loot (surviving dead ends)
  const start = [0, 0];
  let exit = [cw - 1, ch - 1];
  for (const [x, y] of allCells) {
    if (dist[y][x] > dist[exit[1]][exit[0]]) exit = [x, y];
  }
  const isSpecial = (x, y) =>
    (x === start[0] && y === start[1]) || (x === exit[0] && y === exit[1]);

  const lootCells = shuffle(
    allCells.filter(([x, y]) => openCount(x, y) === 1 && !isSpecial(x, y)),
    rng
  ).slice(0, MAP.lootMax);

  // --- encounters on ordinary cells far enough from the start
  const taken = new Set(lootCells.map(([x, y]) => `${x},${y}`));
  const encounterPool = shuffle(
    allCells.filter(
      ([x, y]) =>
        !isSpecial(x, y) &&
        !taken.has(`${x},${y}`) &&
        dist[y][x] >= MAP.minEncounterDistance
    ),
    rng
  );
  const encounterCount = MAP.encounterMin + randInt(rng, MAP.encounterMax - MAP.encounterMin + 1);
  const encounterCells = encounterPool.slice(0, encounterCount);

  // --- project cells onto the tile grid
  const width = cw * 2 + 1;
  const height = ch * 2 + 1;
  const tiles = Array.from({ length: height }, () => Array(width).fill(0));
  for (const [x, y] of allCells) {
    tiles[y * 2 + 1][x * 2 + 1] = 1;
    if (open[y][x].E) tiles[y * 2 + 1][x * 2 + 2] = 1;
    if (open[y][x].S) tiles[y * 2 + 2][x * 2 + 1] = 1;
  }
  const toTile = ([x, y]) => ({ x: x * 2 + 1, y: y * 2 + 1 });

  return {
    seed: seedString,
    depth,
    width,
    height,
    tiles,
    start: toTile(start),
    exit: toTile(exit),
    encounters: encounterCells.map((cell, i) => ({
      id: `enc-${i}`,
      ...toTile(cell),
      monsterIds: rollEncounter(depth, rng),
    })),
    loot: lootCells.map((cell, i) => ({
      id: `loot-${i}`,
      ...toTile(cell),
      ...rollLoot(rng),
    })),
  };
}
