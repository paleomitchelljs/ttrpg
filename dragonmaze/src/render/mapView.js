// DOM CSS-grid map with fog of war. Visible = current tile + orthogonal
// neighbors; explored tiles stay dimly visible. Reads state only; clicks
// raise intents via the onTileClick callback wired in main.js.

import { monsterById } from '../../data/monsters.js';

export function renderMap(container, state) {
  const run = state.run;
  if (!run) {
    container.innerHTML = '';
    return;
  }
  const d = run.dungeon;
  const { x: px, y: py } = run.playerPos;
  container.style.gridTemplateColumns = `repeat(${d.width}, var(--tile))`;

  const frag = document.createDocumentFragment();
  for (let y = 0; y < d.height; y++) {
    for (let x = 0; x < d.width; x++) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.x = x;
      tile.dataset.y = y;
      const explored = run.explored[`${x},${y}`];
      const visible = Math.abs(x - px) + Math.abs(y - py) <= 1;
      if (!explored) {
        tile.classList.add('fog');
      } else {
        tile.classList.add(d.tiles[y][x] === 1 ? 'floor' : 'wall');
        if (!visible) tile.classList.add('dim');
        if (d.tiles[y][x] === 1) {
          tile.textContent = tileGlyph(run, x, y);
          if (Math.abs(x - px) + Math.abs(y - py) === 1 && d.tiles[y][x] === 1) {
            tile.classList.add('steppable');
          }
        }
      }
      frag.appendChild(tile);
    }
  }
  container.replaceChildren(frag);
}

function tileGlyph(run, x, y) {
  const d = run.dungeon;
  if (run.playerPos.x === x && run.playerPos.y === y) return '🐉';
  const enc = d.encounters.find((e) => e.x === x && e.y === y);
  if (enc) return monsterById(enc.monsterIds[0])?.emoji ?? '❓';
  if (d.loot.some((l) => l.x === x && l.y === y)) return '💰';
  if (d.exit.x === x && d.exit.y === y) return '🚪';
  return '';
}

export function bindMapClicks(container, onTileClick) {
  container.addEventListener('click', (ev) => {
    const tile = ev.target.closest('.tile');
    if (!tile) return;
    onTileClick(Number(tile.dataset.x), Number(tile.dataset.y));
  });
}
