// Shared autotiler: turns a subregion's geometry (which cells are wall / floor /
// water) into the specific tile KEY each cell should draw. Pure — no DOM, no
// asset manifest — so both the game (mapView.js) and the zone editor render the
// exact same tileset from the same ASCII/geometry.
//
// A `d` here is the minimal shape the pickers need:
//   { width, height, tiles:[[0|1]], water?:[[bool]] }  (tiles: 1 = floor)
// Bitmask convention for neighbour tests: N=1 E=2 S=4 W=8.
//
// OUTER vs INTERNAL walls. A theme may draw its perimeter differently from the
// partitions standing inside a room — the palace's outer shell is pillars and
// snake friezes, its internal walls are plain raised stone. Which one a cell is
// comes from the geometry, not the map text (see outerWalls): a wall cell that
// can be reached from the map's border through other wall cells belongs to the
// outer shell; a wall island standing free inside the room is internal. So no
// map needs re-authoring, and a spur growing off the perimeter reads as part of
// it, which is what you want.
//
// A theme opts in by declaring `wallInner` (and optionally `fallbackInner` /
// `floorEdge`). Without them every wall keeps using `wall`, so a theme that has
// only one set — and every map — renders exactly as before.

export const AUTOTILE = {
  sewer: {
    // Opaque rotation-based set: one corner + one wall from the HD sheet, each
    // pre-rotated to all four orientations, plus a plain floor and a solid fill.
    floor: ['sewer2-floor', 'sewer2-floor2'],
    accent: [],
    water: 'sewer2-water', // fallback for isolated water cells
    // Water-channel autotile: bitmask of which orthogonal neighbours are also
    // water (N=1 E=2 S=4 W=8) -> a rotated channel piece with stone banks.
    waterTiles: {
      15: 'sw-cross',
      14: 'sw-tee-esw', 7: 'sw-tee-nes', 11: 'sw-tee-new', 13: 'sw-tee-nsw',
      10: 'sw-str-h', 5: 'sw-str-v',
      9: 'sw-cor-nw', 3: 'sw-cor-ne', 6: 'sw-cor-se', 12: 'sw-cor-sw',
      2: 'sw-str-h', 8: 'sw-str-h', 1: 'sw-str-v', 4: 'sw-str-v', // ends -> straight
    },
    // Wall pieces named by which edge/corner is SOLID (so nw = wall in the NW,
    // opening toward the SE floor, etc.). Outer corners (c-*) are the map's own
    // boundary corners — a thin L of wall, mostly floor. Inner corners (ci-*)
    // are the wall-island / concave corners — a chunky wall nub jutting into
    // the room (ci-nw = the nub sits in the NW), used when two adjacent edges
    // are floor.
    wall: {
      top: 'sewer2-w-top', bottom: 'sewer2-w-bottom', left: 'sewer2-w-left', right: 'sewer2-w-right',
      nw: 'sewer2-c-nw', ne: 'sewer2-c-ne', sw: 'sewer2-c-sw', se: 'sewer2-c-se',
      iNW: 'sewer2-ci-nw', iNE: 'sewer2-ci-ne', iSW: 'sewer2-ci-sw', iSE: 'sewer2-ci-se',
    },
    fallback: 'sewer2-fill',
  },
  // The Lost Temple palace — one sheet, one look. art/palace-room-sheet.png is a
  // finished room, so the ring, the floor and the internal runs all come out of
  // it together (tools/slice_palace_room.py); a wall tile's baked floor-facing
  // edge therefore matches the floor beside it, which the older three-sheet mix
  // never managed.
  //
  // `palace-o-*` is the outer ring, `palace-r-*` the interior pieces. The two
  // share a brick, so the outer/inner split here buys the thin-wall vocabulary
  // (runs, elbows, ends) rather than a different material.
  palace: {
    floor: [
      'palace-r-floor-a', 'palace-r-floor-b', 'palace-r-floor-c', 'palace-r-floor-d', 'palace-r-floor-e',
      'palace-r-floor-f', 'palace-r-floor-g', 'palace-r-floor-h', 'palace-r-floor-i',
    ],
    accent: [],
    wall: {
      top: 'palace-o-top', bottom: 'palace-o-bottom', left: 'palace-o-left', right: 'palace-o-right',
      nw: 'palace-o-nw', ne: 'palace-o-ne', sw: 'palace-o-sw', se: 'palace-o-se',
      iNW: 'palace-r-ci-nw', iNE: 'palace-r-ci-ne', iSW: 'palace-r-ci-sw', iSE: 'palace-r-ci-se',
    },
    fallback: 'palace-r-fill',
    // The interior adds what a ring has no need of: one-cell runs, the elbows
    // they turn through, and termini. Its edge pieces are the ring's, since a
    // thick partition presents the same face as the shell does.
    wallInner: {
      top: 'palace-o-top', bottom: 'palace-o-bottom', left: 'palace-o-left', right: 'palace-o-right',
      nw: 'palace-r-fill', ne: 'palace-r-fill', sw: 'palace-r-fill', se: 'palace-r-fill',
      thinH: 'palace-r-run-h', thinV: 'palace-r-run-v',
      iNW: 'palace-r-ci-nw', iNE: 'palace-r-ci-ne', iSW: 'palace-r-ci-sw', iSE: 'palace-r-ci-se',
      elNW: 'palace-r-ci-nw', elNE: 'palace-r-ci-ne', elSW: 'palace-r-ci-sw', elSE: 'palace-r-ci-se',
      endN: 'palace-r-end-n', endE: 'palace-r-end-e', endS: 'palace-r-end-s', endW: 'palace-r-end-w',
    },
    fallbackInner: 'palace-r-fill',
  },
};

// Which wall cells are the map's outer shell: every wall reachable from the
// border through orthogonally-adjacent wall. Cached per geometry object — the
// game hands us the same `run.dungeon` every frame and the editor rebuilds its
// `d` on each render, so a WeakMap invalidates itself either way and keeps this
// derived grid out of the save file.
const OUTER_WALLS = new WeakMap();

export function outerWalls(d) {
  const hit = OUTER_WALLS.get(d);
  if (hit) return hit;
  const { width: W, height: H } = d;
  const outer = Array.from({ length: H }, () => new Array(W).fill(false));
  // A map may overrule the inference wholesale (subregion `wallStyle`). A
  // labyrinth whose every wall runs back to the border infers as ALL outer,
  // which would panel a corridor maze in ceremonial pillars; 'inner' says to
  // treat the lot as partitions instead.
  if (d.wallStyle === 'inner' || d.wallStyle === 'outer') {
    const all = d.wallStyle === 'outer';
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) outer[y][x] = all && d.tiles[y][x] !== 1;
    OUTER_WALLS.set(d, outer);
    return outer;
  }
  const stack = [];
  const seed = (x, y) => {
    if (d.tiles[y][x] !== 1 && !outer[y][x]) {
      outer[y][x] = true;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x > 0) seed(x - 1, y);
    if (x < W - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < H - 1) seed(x, y + 1);
  }
  OUTER_WALLS.set(d, outer);
  return outer;
}

/** True when this wall cell is an internal partition rather than outer shell. */
export function isInnerWall(d, x, y) {
  return d.tiles[y][x] !== 1 && !outerWalls(d)[y][x];
}

// The floor a cell draws. A floor tile that touches the OUTER wall can take its
// own variant (`floorEdge`, keyed by the side the wall is on) — the outer sheet
// bakes the wall's shadow into the stone beside it, so those tiles only belong
// against outer wall. Everything else gets the shuffled general floor.
export function floorVariant(cfg, d, x, y) {
  const edge = cfg.floorEdge && d && edgeFloorKey(cfg, d, x, y);
  if (edge) return edge;
  if (cfg.accent?.length && (x * 131 + y * 197) % 100 < 12) return cfg.accent[(x + y) % cfg.accent.length];
  return cfg.floor[(x * 3 + y) % cfg.floor.length];
}

function edgeFloorKey(cfg, d, x, y) {
  const outer = outerWalls(d);
  const o = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && outer[yy][xx];
  const e = cfg.floorEdge;
  // Named for the side the wall sits on, so `n` is floor with outer wall above.
  if (o(x, y - 1)) return e.n;
  if (o(x, y + 1)) return e.s;
  if (o(x - 1, y)) return e.w;
  if (o(x + 1, y)) return e.e;
  return null;
}

export function waterKey(cfg, d, x, y) {
  const w = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && d.water?.[yy]?.[xx];
  const mask = (w(x, y - 1) ? 1 : 0) | (w(x + 1, y) ? 2 : 0) | (w(x, y + 1) ? 4 : 0) | (w(x - 1, y) ? 8 : 0);
  return cfg.waterTiles?.[mask] ?? cfg.water; // 0 (isolated) -> plain water pool
}

// Pick a wall piece from the 8 neighbours, out of this cell's set (internal
// partition or outer shell — see outerWalls). Thin partitions come first: a
// wall with floor on BOTH opposite sides is a free-standing run, and the
// edge-based pieces below would draw it as a one-sided edge. Then inner corners
// (two adjacent edges are floor — a wall nub jutting into the room), straight
// edges, outer corners (only a diagonal is floor — the map's own boundary
// corners), else solid fill.
export function wallKey(cfg, d, x, y) {
  const f = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && d.tiles[yy][xx] === 1;
  const N = f(x, y - 1), E = f(x + 1, y), S = f(x, y + 1), W = f(x - 1, y);
  const NE = f(x + 1, y - 1), SE = f(x + 1, y + 1), SW = f(x - 1, y + 1), NW = f(x - 1, y - 1);
  const inner = cfg.wallInner && isInnerWall(d, x, y);
  const w = inner ? cfg.wallInner : cfg.wall;
  const fill = (inner ? cfg.fallbackInner : cfg.fallback) ?? cfg.fallback;
  // A one-cell-thick run: floor on two OPPOSITE sides, which the edge pieces
  // below can't express (they'd pick whichever side they test first and draw a
  // one-sided edge). Named for the way the wall runs: floor to the N and S
  // means the wall runs east-west.
  if (N && S && !E && !W && w.thinH) return w.thinH;
  if (E && W && !N && !S && w.thinV) return w.thinV;
  // A terminus: floor on three sides, so the wall runs off the fourth. Named
  // for the way the wall CONTINUES. Must be tested before the inner corners,
  // which would otherwise claim it (floor to the S and E matches iNW).
  if (E && W && N && !S && w.endS) return w.endS;
  if (E && W && S && !N && w.endN) return w.endN;
  if (N && S && E && !W && w.endW) return w.endW;
  if (N && S && W && !E && w.endE) return w.endE;
  // Two adjacent sides are floor, so the wall turns here. WHICH corner piece
  // depends on how thick the wall is: if the diagonal behind the bend is floor
  // too, this is a one-cell-thick wall turning (a thin elbow whose arms match
  // the straight runs); if it is wall, the cell is the corner of a thick mass
  // and wants the chunky quadrant piece.
  if (S && E) return NW && w.elNW ? w.elNW : w.iNW;
  if (S && W) return NE && w.elNE ? w.elNE : w.iNE;
  if (N && E) return SW && w.elSW ? w.elSW : w.iSW;
  if (N && W) return SE && w.elSE ? w.elSE : w.iSE;
  if (S) return w.top; if (N) return w.bottom; if (E) return w.left; if (W) return w.right;
  if (SE) return w.nw; if (SW) return w.ne; if (NE) return w.sw; if (NW) return w.se;
  return fill;
}

// The single tile key a cell draws: wall piece for a wall cell, floor/water
// variant for a floor cell. Matches how mapView splits paintWall vs paintFloor.
export function autotileKeyAt(cfg, d, x, y) {
  // A hand-pinned cell wins outright. The autotiler picks from geometry alone,
  // which is right nearly everywhere and occasionally wrong in a way no rule
  // will fix — a doorway that wants a specific jamb, a mass whose corner reads
  // badly. `baseTiles` (authored in the editor, stored per subregion in
  // placements.js) is the escape hatch: one cell, one key, no rule change.
  const pinned = d.baseTiles?.[`${x},${y}`];
  if (pinned) return pinned;
  if (d.tiles[y][x] !== 1) return wallKey(cfg, d, x, y);
  return d.water?.[y]?.[x] && cfg.waterTiles ? waterKey(cfg, d, x, y) : floorVariant(cfg, d, x, y);
}

// Every tile key a theme's autotiler can emit — its whole geometry set. Used to
// keep these out of the decor palette and to strip redundant geometry-as-decor.
export function autotileKeys(cfg) {
  const keys = new Set([...(cfg.floor ?? []), ...(cfg.accent ?? [])]);
  if (cfg.water) keys.add(cfg.water);
  for (const k of Object.values(cfg.waterTiles ?? {})) keys.add(k);
  for (const k of Object.values(cfg.wall ?? {})) keys.add(k);
  for (const k of Object.values(cfg.wallInner ?? {})) keys.add(k);
  for (const k of Object.values(cfg.floorEdge ?? {})) keys.add(k);
  if (cfg.fallback) keys.add(cfg.fallback);
  if (cfg.fallbackInner) keys.add(cfg.fallbackInner);
  return keys;
}

// The union of every theme's geometry keys.
export function allAutotileKeys() {
  const keys = new Set();
  for (const cfg of Object.values(AUTOTILE)) for (const k of autotileKeys(cfg)) keys.add(k);
  return keys;
}
