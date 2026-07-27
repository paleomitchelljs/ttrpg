// Shared autotiler: turns a subregion's geometry (which cells are wall / floor /
// water) into the specific tile KEY each cell should draw. Pure — no DOM, no
// asset manifest — so both the game (mapView.js) and the zone editor render the
// exact same tileset from the same ASCII/geometry.
//
// A `d` here is the minimal shape the pickers need:
//   { width, height, tiles:[[0|1]], water?:[[bool]] }  (tiles: 1 = floor)
// Bitmask convention for neighbour tests: N=1 E=2 S=4 W=8.

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
};

export function floorVariant(cfg, x, y) {
  if (cfg.accent?.length && (x * 131 + y * 197) % 100 < 12) return cfg.accent[(x + y) % cfg.accent.length];
  return cfg.floor[(x * 3 + y) % cfg.floor.length];
}

export function waterKey(cfg, d, x, y) {
  const w = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && d.water?.[yy]?.[xx];
  const mask = (w(x, y - 1) ? 1 : 0) | (w(x + 1, y) ? 2 : 0) | (w(x, y + 1) ? 4 : 0) | (w(x - 1, y) ? 8 : 0);
  return cfg.waterTiles?.[mask] ?? cfg.water; // 0 (isolated) -> plain water pool
}

// Pick a wall piece from the 8 neighbours: inner corners (two adjacent edges
// are floor — a wall nub jutting into the room, e.g. a wall-island corner)
// first, then straight edges, then outer corners (only a diagonal is floor —
// the map's own boundary corners), else solid fill.
export function wallKey(cfg, d, x, y) {
  const f = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && d.tiles[yy][xx] === 1;
  const N = f(x, y - 1), E = f(x + 1, y), S = f(x, y + 1), W = f(x - 1, y);
  const NE = f(x + 1, y - 1), SE = f(x + 1, y + 1), SW = f(x - 1, y + 1), NW = f(x - 1, y - 1);
  const w = cfg.wall;
  if (S && E) return w.iNW; if (S && W) return w.iNE; if (N && E) return w.iSW; if (N && W) return w.iSE;
  if (S) return w.top; if (N) return w.bottom; if (E) return w.left; if (W) return w.right;
  if (SE) return w.nw; if (SW) return w.ne; if (NE) return w.sw; if (NW) return w.se;
  return cfg.fallback;
}

// The single tile key a cell draws: wall piece for a wall cell, floor/water
// variant for a floor cell. Matches how mapView splits paintWall vs paintFloor.
export function autotileKeyAt(cfg, d, x, y) {
  if (d.tiles[y][x] !== 1) return wallKey(cfg, d, x, y);
  return d.water?.[y]?.[x] && cfg.waterTiles ? waterKey(cfg, d, x, y) : floorVariant(cfg, x, y);
}

// Every tile key a theme's autotiler can emit — its whole geometry set. Used to
// keep these out of the decor palette and to strip redundant geometry-as-decor.
export function autotileKeys(cfg) {
  const keys = new Set([...(cfg.floor ?? []), ...(cfg.accent ?? [])]);
  if (cfg.water) keys.add(cfg.water);
  for (const k of Object.values(cfg.waterTiles ?? {})) keys.add(k);
  for (const k of Object.values(cfg.wall ?? {})) keys.add(k);
  if (cfg.fallback) keys.add(cfg.fallback);
  return keys;
}

// The union of every theme's geometry keys.
export function allAutotileKeys() {
  const keys = new Set();
  for (const cfg of Object.values(AUTOTILE)) for (const k of autotileKeys(cfg)) keys.add(k);
  return keys;
}
