// Screens, HUD, overlays, exploration log. Dumb DOM helpers only — all
// decisions live in gameState; main.js wires intents.

import { zoneById } from '../../data/zones.js';
import { familiarById } from '../../data/familiars.js';
import { spellById } from '../../data/spells.js';
import { SPRITES } from '../assets-manifest.js';

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
  chip('hud-hp', `${hp.current}/${hp.max}`);
  el('hud-hp').classList.toggle('danger', hp.current <= Math.ceil(hp.max / 3));
  chip('hud-tier', cap(run.dragon.tier));
  chip('hud-depth', `Depth ${run.dungeon.depth}`);
  chip('hud-carried', `${run.unbankedGold}`);
  chip('hud-hoard', state.meta.hoardGold.toLocaleString());
  el('hoard-label').textContent = `Hoard: ${state.meta.hoardGold.toLocaleString()} gold`;
}

function chip(id, text) {
  el(id).querySelector('.chip-text').textContent = text;
}

export function updateTitle(state) {
  el('btn-continue').hidden = !state.hasSave;
  el('title-hoard').textContent = state.hasSave
    ? `Your hoard: ${state.meta.hoardGold.toLocaleString()} gold`
    : '';
  const party = state.meta.party ?? [];
  for (const box of document.querySelectorAll('.party-opt input')) {
    box.checked = party.includes(box.dataset.cid);
  }

  // zone picker
  const pick = state.meta.zone;
  for (const btn of document.querySelectorAll('.zone-btn')) {
    btn.classList.toggle('selected', (pick?.zoneId ?? '') === btn.dataset.zone);
  }
  const zone = pick ? zoneById(pick.zoneId) : null;
  const sub = el('zone-sub');
  sub.hidden = !zone;
  if (zone) {
    sub.innerHTML = zone.subregions
      .map((s, i) => `<option value="${i}" ${i === pick.subIndex ? 'selected' : ''}>${s.name}</option>`)
      .join('');
    el('zone-blurb').textContent = zone.subregions[pick.subIndex]?.blurb ?? zone.blurb;
  } else {
    el('zone-blurb').textContent = 'An ever-changing maze, deeper and richer with every delve.';
  }

  // familiar picker
  const fam = familiarById(state.meta.familiar);
  for (const btn of document.querySelectorAll('.familiar-btn')) {
    btn.classList.toggle('selected', (state.meta.familiar ?? '') === btn.dataset.fam);
  }
  el('familiar-blurb').textContent = fam ? fam.blurb : 'delve alone, unencumbered by pets';
}

/**
 * The character sheet overlay. subject:
 * { name, blurb, sprite (strip key or null), frames, flip, ac, hp, abilities,
 *   attacks, breath?, spells: [{name, blurb}], familiar?, traits? }
 */
export function showCharacterSheet(subject) {
  const abilityRow = Object.entries(subject.abilities)
    .map(([k, v]) => `<div class="sheet-stat"><span>${k.toUpperCase()}</span><b>${v >= 0 ? '+' : ''}${v}</b></div>`)
    .join('');
  const attacks = subject.attacks
    .map((a) => `<li>${cap(a.name)} — +${a.toHit} to hit, ${a.damage} damage</li>`)
    .join('');
  const spells = subject.spells.length
    ? `<h3>Spells</h3><ul>${subject.spells.map((s) => `<li>${s.name} — ${s.blurb}</li>`).join('')}</ul>`
    : '';
  el('sheet-body').innerHTML = `
    <div class="sheet-head">
      ${subject.sprite ? `<div class="sprite f${subject.frames ?? 2}${subject.flip ? ' flip' : ''} sheet-sprite"><img src="${subject.sprite}" alt=""></div>` : ''}
      <div>
        <h2>${subject.name}</h2>
        <p class="sheet-blurb">${subject.blurb}</p>
      </div>
    </div>
    <div class="sheet-vitals">
      <div class="sheet-stat"><span>AC</span><b>${subject.ac}</b></div>
      <div class="sheet-stat"><span>HP</span><b>${subject.hp}</b></div>
      ${abilityRow}
    </div>
    <h3>Attacks</h3><ul>${attacks}</ul>
    ${subject.breath ? `<h3>Fire Breath</h3><ul><li>${subject.breath.damage} fire damage to every enemy, save DC ${subject.breath.dc} for half; recharges on a 5+</li></ul>` : ''}
    ${spells}
    ${subject.familiar ? `<h3>Familiar</h3><ul><li>${subject.familiar.name} — ${subject.familiar.blurb}</li></ul>` : ''}
    ${subject.traits?.length ? `<h3>Traits</h3><ul>${subject.traits.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}`;
  showOverlay('sheet-overlay', true);
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
      <img class="growth-dragon" src="${growth.img}" alt="">
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
