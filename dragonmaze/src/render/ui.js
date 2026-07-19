// Screens, HUD, overlays, exploration log. Dumb DOM helpers only — all
// decisions live in gameState; main.js wires intents.

export function el(id) {
  return document.getElementById(id);
}

export function showScreen(name) {
  el('screen-title').hidden = name !== 'title';
  el('screen-game').hidden = name !== 'game';
}

export function showOverlay(id, visible) {
  el(id).hidden = !visible;
}

export function updateHud(state) {
  const run = state.run;
  if (!run) return;
  const hp = run.dragon.hp;
  el('hud-hp').textContent = `❤️ ${hp.current}/${hp.max}`;
  el('hud-hp').classList.toggle('danger', hp.current <= Math.ceil(hp.max / 3));
  el('hud-tier').textContent = `🐉 ${cap(run.dragon.tier)}`;
  el('hud-depth').textContent = `🕳️ Depth ${run.dungeon.depth}`;
  el('hud-carried').textContent = `💰 ${run.unbankedGold}`;
  el('hud-hoard').textContent = `🏆 ${state.meta.hoardGold.toLocaleString()}`;
  el('hoard-label').textContent = `Hoard: ${state.meta.hoardGold.toLocaleString()} gold`;
}

export function updateTitle(state) {
  el('btn-continue').hidden = !state.hasSave;
  el('title-hoard').textContent = state.hasSave
    ? `Your hoard: ${state.meta.hoardGold.toLocaleString()} gold`
    : '';
}

export function logExplore(text, cls = '') {
  const log = el('explore-log');
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  log.appendChild(p);
  while (log.children.length > 40) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

export function clearExploreLog() {
  el('explore-log').replaceChildren();
}

export function showResult({ title, body, growth = null, actions }) {
  el('result-title').textContent = title;
  const growthEl = el('result-growth');
  growthEl.hidden = !growth;
  if (growth) {
    growthEl.innerHTML = `
      <div class="growth-dragon">${growth.emoji}</div>
      <div class="growth-text">${growth.text}</div>`;
  }
  el('result-body').textContent = body;
  const box = el('result-actions');
  box.replaceChildren(
    ...actions.map(({ label, onClick }) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = label;
      btn.addEventListener('click', onClick);
      return btn;
    })
  );
  showOverlay('result-overlay', true);
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
