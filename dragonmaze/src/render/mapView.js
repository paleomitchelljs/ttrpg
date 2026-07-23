// DOM CSS-grid map with fog of war. Anywhere the dragon has been stays fully
// lit — only the unexplored dark remains. The player is a persistent animated
// token that glides between tiles (the grid re-renders freely underneath it);
// monsters with sprite strips idle-animate on their tiles.

import { monsterById } from '../../data/monsters.js';
import { companionById } from '../../data/party.js';
import { SPRITES, TILES } from '../assets-manifest.js';
import TILE_TAGS from '../../data/tile-tags.json' with { type: 'json' };

// Flat ground decor (grass, floor slabs) must NOT cast the raised-prop drop
// shadow — a shadow only reads right for things standing up off the ground
// (huts, statues, walls). Keyed off the tile's tags so newly sliced ground
// tiles are covered automatically.
const FLAT_KEYS = new Set(
  Object.entries(TILE_TAGS)
    .filter(([, v]) => (v.tags || []).some((t) => t === 'floor' || t === 'grass'))
    .map(([k]) => k),
);

export function spritePath(key) {
  return SPRITES[key];
}

// ---- autotiling ---------------------------------------------------------
// Some themes replace the flat "one wall + one floor" CSS background with a
// per-cell tileset: floor cells pick a floor variant, and wall cells pick a
// wall piece from a bitmask of which orthogonal neighbours are FLOOR, then
// draw that piece OVER a floor layer (the piece's floor-facing parts are
// transparent, so corners blend into the room). Bits: N=1 E=2 S=4 W=8.
const AUTOTILE = {
  sewer: {
    floor: ['sat-floor-0-0', 'sat-floor-1-0', 'sat-floor-2-0'],
    accent: ['sat-floor-3-0', 'sat-floor-4-0'], // occasional moss / crack
    // floor-neighbour mask -> wall piece. Only the strongly-read cases are
    // mapped (south front-faces + corners + side walls); the rest fall back to
    // solid fill. Tunable — add the richer corner pieces to extend it.
    wall: {
      0: 'sat-wall-6-0',   // interior / no floor neighbour: solid
      4: 'sat-wall-9-2',   // floor S: front face
      6: 'sat-wall-6-2',   // floor S+E: outer corner (wall in NW)
      12: 'sat-wall-8-2',  // floor S+W: outer corner (wall in NE)
      2: 'sat-wall-0-3',   // floor E: west-side wall
      8: 'sat-wall-w',     // floor W: east-side wall (mirror)
    },
    fallback: 'sat-wall-6-0',
  },
};
const bg = (keys) => keys.map((k) => `url("${TILES[k]}")`).join(', ');
function floorVariant(cfg, x, y) {
  if (cfg.accent?.length && (x * 131 + y * 197) % 100 < 12) return cfg.accent[(x + y) % cfg.accent.length];
  return cfg.floor[(x * 3 + y) % cfg.floor.length];
}
function wallMask(d, x, y) {
  const isFloor = (xx, yy) => yy >= 0 && yy < d.height && xx >= 0 && xx < d.width && d.tiles[yy][xx] === 1;
  return (isFloor(x, y - 1) ? 1 : 0) | (isFloor(x + 1, y) ? 2 : 0) | (isFloor(x, y + 1) ? 4 : 0) | (isFloor(x - 1, y) ? 8 : 0);
}
function paintFloor(tile, cfg, x, y) {
  tile.style.backgroundImage = bg([floorVariant(cfg, x, y)]);
  tile.style.backgroundSize = '100% 100%';
}
function paintWall(tile, cfg, d, x, y) {
  const wall = cfg.wall[wallMask(d, x, y)] ?? cfg.fallback;
  tile.style.backgroundImage = bg([wall, floorVariant(cfg, x, y)]); // wall over floor
  tile.style.backgroundSize = '100% 100%, 100% 100%';
}

// Which strip the player token shows for each heading. The side strip faces
// left natively; heading right flips it.
// The new dragon art is a single side view, so every heading shows the same
// 4-frame wing-flap strip (flipped left/right by heading); no top/bottom pose.
const DRAGON_FACING = {
  side: { key: 'dragon-fly', frames: 'f4' },
  down: { key: 'dragon-fly', frames: 'f4' },
  up: { key: 'dragon-fly', frames: 'f4' },
};

// The overworld token is the dragon — or, on party-only delves, the party's
// leader walking in its stead (same strip for every heading).
let tokenFacing = DRAGON_FACING;
let lastPos = null;

function facingFor(state) {
  const run = state.run;
  if (!run || run.dragon) return DRAGON_FACING;
  const leadId = run.party[0]?.id;
  const lead =
    companionById(leadId) ?? state.meta.customCharacters?.find((c) => c.id === leadId) ?? null;
  const key = lead?.walk ?? lead?.anim?.idle ?? 'dragon-fly';
  const strip = { key, frames: 'f2' };
  return { side: strip, down: strip, up: strip };
}

export function renderMap(container, state) {
  const grid = container.querySelector('#map-grid');
  const token = container.querySelector('#player-token');
  const run = state.run;
  if (!run) {
    grid.innerHTML = '';
    token.hidden = true;
    lastPos = null;
    return;
  }
  const d = run.dungeon;
  const { x: px, y: py } = run.playerPos;
  container.dataset.theme = d.theme ?? 'none';
  grid.style.gridTemplateColumns = `repeat(${d.width}, var(--tile))`;
  const auto = AUTOTILE[d.theme]; // per-cell tileset for this theme, if any

  const frag = document.createDocumentFragment();
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.x = x;
      tile.dataset.y = y;
      const door = d.doors?.find((dr) => dr.x === x && dr.y === y);
      const cleared = run.explored[`${x},${y}`];
      // A ring two tiles out, glimpsed under a light: show the terrain faintly
      // but none of its contents, and it isn't steppable until fully cleared.
      const dim = !cleared && run.dimSeen?.[`${x},${y}`];
      if (!cleared && !dim) {
        tile.classList.add('fog');
      } else if (door) {
        // A door embedded in the border wall; the side it opens onto is the
        // direction you walk to use it.
        if (dim) tile.classList.add('fog-dim');
        tile.classList.add('wall', 'door-tile');
        tile.dataset.dir = door.dir.dx > 0 ? 'e' : door.dir.dx < 0 ? 'w' : door.dir.dy > 0 ? 's' : 'n';
        const leaf = document.createElement('div');
        leaf.className = door.to === 'surface' ? 'door-leaf surface' : 'door-leaf';
        tile.appendChild(leaf);
        if (cleared && Math.abs(x - px) + Math.abs(y - py) === 1) tile.classList.add('steppable');
      } else if (d.tiles[y][x] !== 1) {
        if (dim) tile.classList.add('fog-dim');
        tile.classList.add('wall');
        if (auto) paintWall(tile, auto, d, x, y);
      } else {
        tile.classList.add('floor');
        if (auto) paintFloor(tile, auto, x, y);
        if (dim) {
          tile.classList.add('fog-dim');
        } else {
          // A floor tile on a linked border is a walk-off passage to the next
          // sub-area — cue it so it doesn't read as a dead end.
          if (x === d.width - 1 && d.edges?.e) tile.classList.add('edge-exit', 'edge-e');
          else if (x === 0 && d.edges?.w) tile.classList.add('edge-exit', 'edge-w');
          else if (y === d.height - 1 && d.edges?.s) tile.classList.add('edge-exit', 'edge-s');
          else if (y === 0 && d.edges?.n) tile.classList.add('edge-exit', 'edge-n');
          fillTile(tile, run, x, y);
          if (Math.abs(x - px) + Math.abs(y - py) === 1) {
            tile.classList.add('steppable');
          }
        }
      }
      frag.appendChild(tile);
    }
  }
  grid.replaceChildren(frag);
  renderProps(container, run);
  tokenFacing = facingFor(state);
  syncTokenStrip(token);
  moveToken(token, px, py);
}

// Decorative props (huts, statues, braziers, wells) are absolutely-positioned
// images over the grid, spanning w×h tiles, revealed once their anchor is seen.
function renderProps(container, run) {
  const layer = container.querySelector('#map-props');
  if (!layer) return;
  const d = run.dungeon;
  layer.style.width = `calc(var(--tile) * ${d.width})`;
  layer.style.height = `calc(var(--tile) * ${d.height})`;
  const frag = document.createDocumentFragment();
  for (const p of d.props ?? []) {
    const src = TILES[p.key];
    // Anchor on the cell the prop sits in, so fractionally-positioned props
    // (fine-nudged decor) still reveal with their tile.
    if (!src || !run.explored[`${Math.floor(p.x)},${Math.floor(p.y)}`]) continue;
    const el = document.createElement('div');
    el.className = 'map-prop' + (FLAT_KEYS.has(p.key) ? ' flat' : '');
    el.style.left = `calc(var(--tile) * ${p.x})`;
    el.style.top = `calc(var(--tile) * ${p.y})`;
    el.style.width = `calc(var(--tile) * ${p.w})`;
    el.style.height = `calc(var(--tile) * ${p.h})`;
    el.style.zIndex = (p.y + p.h) * 10; // depth = base row; tall props occlude what's behind
    el.innerHTML = `<img src="${src}" alt="">`;
    if (p.rot) el.firstElementChild.style.transform = `rotate(${p.rot}deg)`;
    frag.appendChild(el);
  }
  layer.replaceChildren(frag);
}

function syncTokenStrip(token) {
  const sprite = token.firstElementChild;
  const img = sprite.querySelector('img');
  const side = tokenFacing.side;
  const src = spritePath(side.key) ?? SPRITES['dragon-fly'];
  if (img.getAttribute('src') !== src && !sprite.classList.contains('mid-face')) {
    img.setAttribute('src', src);
    sprite.classList.remove('f2', 'f4');
    sprite.classList.add(side.frames);
  }
}

function fillTile(tile, run, x, y) {
  const d = run.dungeon;
  const enc = d.encounters.find((e) => e.x === x && e.y === y);
  if (enc) {
    const m = monsterById(enc.monsterIds[0]);
    if (m?.anim?.idle) {
      tile.innerHTML = `<div class="tile-sprite sprite f2"><img src="${spritePath(m.anim.idle)}" alt="${m.name}"></div>`;
    } else {
      tile.textContent = m?.emoji ?? '❓';
    }
    return;
  }
  if (d.loot.some((l) => l.x === x && l.y === y)) {
    // In the grass courtyard, a loot tile shows the loose-coins art; elsewhere
    // it's the coin glyph.
    if (d.theme === 'grass' && TILES['courtyard-gold-pile']) {
      tile.innerHTML = `<div class="tile-loot"><img src="${TILES['courtyard-gold-pile']}" alt="gold"></div>`;
    } else {
      tile.textContent = '💰';
    }
  }
}

function moveToken(token, x, y) {
  token.hidden = false;
  // translate is in token-widths, i.e. tiles
  token.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  // depth against props: a prop with base row R has z (R*10); the token at row y
  // sits in front of props based at or above it, behind those based lower.
  token.style.zIndex = (y + 1) * 10 + 5;
  if (lastPos) {
    const dx = x - lastPos.x;
    const dy = y - lastPos.y;
    if (dx !== 0 || dy !== 0) {
      setFacing(token, dx, dy);
      token.classList.add('moving');
      clearTimeout(moveToken._t);
      moveToken._t = setTimeout(() => token.classList.remove('moving'), 350);
    }
  }
  lastPos = { x, y };
}

function setFacing(token, dx, dy) {
  const sprite = token.firstElementChild;
  const img = sprite.querySelector('img');
  const facing = dx !== 0 ? tokenFacing.side : dy > 0 ? tokenFacing.down : tokenFacing.up;
  sprite.classList.toggle('flip', dx > 0);
  const src = spritePath(facing.key);
  if (img.getAttribute('src') !== src) {
    img.setAttribute('src', src);
    sprite.classList.remove('f2', 'f4');
    sprite.classList.add(facing.frames);
  }
}

export function bindMapClicks(container, onTileClick) {
  container.addEventListener('click', (ev) => {
    const tile = ev.target.closest('.tile');
    if (!tile) return;
    onTileClick(Number(tile.dataset.x), Number(tile.dataset.y));
  });
}
