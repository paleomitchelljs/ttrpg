// DOM CSS-grid map with fog of war. Anywhere the dragon has been stays fully
// lit — only the unexplored dark remains. The player is a persistent animated
// token that glides between tiles (the grid re-renders freely underneath it);
// monsters with sprite strips idle-animate on their tiles.

import { monsterById } from '../../data/monsters.js';
import { companionById } from '../../data/party.js';
import { SPRITES } from '../assets-manifest.js';

export function spritePath(key) {
  return SPRITES[key];
}

// Which strip the player token shows for each heading. The side strip faces
// left natively; heading right flips it.
const DRAGON_FACING = {
  side: { key: 'dragon-fly', frames: 'f4' },
  down: { key: 'dragon-down', frames: 'f2' },
  up: { key: 'dragon-up', frames: 'f2' },
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

  const frag = document.createDocumentFragment();
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.x = x;
      tile.dataset.y = y;
      if (!run.explored[`${x},${y}`]) {
        tile.classList.add('fog');
      } else if (d.tiles[y][x] !== 1) {
        tile.classList.add('wall');
      } else {
        tile.classList.add('floor');
        fillTile(tile, run, x, y);
        if (Math.abs(x - px) + Math.abs(y - py) === 1) {
          tile.classList.add('steppable');
        }
      }
      frag.appendChild(tile);
    }
  }
  grid.replaceChildren(frag);
  tokenFacing = facingFor(state);
  syncTokenStrip(token);
  moveToken(token, px, py);
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
  const door = d.doors?.find((dr) => dr.x === x && dr.y === y);
  if (door) {
    tile.classList.add('door-tile');
    tile.textContent = door.to === 'surface' ? '⌂' : '◆';
    return;
  }
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
    tile.textContent = '💰';
    return;
  }
  if (d.exit.x === x && d.exit.y === y) tile.textContent = '🚪';
}

function moveToken(token, x, y) {
  token.hidden = false;
  // translate is in token-widths, i.e. tiles
  token.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
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
