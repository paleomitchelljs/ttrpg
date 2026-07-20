// Screens, HUD, overlays, exploration log. Dumb DOM helpers only — all
// decisions live in gameState; main.js wires intents.

import { zoneById } from '../../data/zones.js';
import { FAMILIARS, familiarById } from '../../data/familiars.js';
import { ITEMS, SLOTS, itemById } from '../../data/items.js';
import { spellById } from '../../data/spells.js';
import { COMPANIONS } from '../../data/party.js';
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
  const hp = run.dragon ? run.dragon.hp : run.party[0]?.hp ?? { current: 0, max: 1 };
  chip('hud-hp', `${hp.current}/${hp.max}`);
  el('hud-hp').classList.toggle('danger', hp.current <= Math.ceil(hp.max / 3));
  chip('hud-tier', run.dragon ? cap(run.dragon.tier) : 'The Party');
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
  // party summary + panel (all companions live in the panel now)
  const party = state.meta.party ?? [];
  const named = party.map((id) => allCompanions(state).find((c) => c.id === id)?.name ?? id);
  el('party-summary').textContent = party.length
    ? `Party: ${named.join(', ')}`
    : 'No companions — the dragon delves alone.';
  renderPartyPanel(state);

  // zone picker
  const pick = state.meta.zone;
  for (const btn of document.querySelectorAll('.zone-btn')) {
    btn.classList.toggle('selected', (pick?.zoneId ?? '') === btn.dataset.zone);
  }
  const zone = pick ? zoneById(pick.zoneId) : null;
  el('zone-sub').hidden = true; // zones are entered at their gate; doors do the rest
  el('zone-blurb').textContent = zone
    ? zone.blurb
    : 'An ever-changing maze, deeper and richer with every delve.';

  // delve mode
  for (const btn of document.querySelectorAll('.mode-btn')) {
    btn.classList.toggle('selected', (state.meta.mode ?? 'dragon') === btn.dataset.mode);
  }

  // familiar picker: only found familiars unlock; the rest stay mysteries
  const owned = state.meta.familiarsOwned ?? [];
  const active = state.meta.familiar ?? '';
  const box = el('familiar-buttons');
  const mkBtn = (fam) => {
    const btn = document.createElement('button');
    btn.className = 'zone-btn familiar-btn';
    if (fam && !owned.includes(fam.id)) {
      btn.textContent = '???';
      btn.disabled = true;
      btn.classList.add('locked');
    } else {
      btn.textContent = fam ? fam.name : 'None';
      btn.dataset.fam = fam?.id ?? '';
      btn.classList.toggle('selected', active === (fam?.id ?? ''));
    }
    return btn;
  };
  box.replaceChildren(mkBtn(null), ...FAMILIARS.map(mkBtn));
  const fam = familiarById(active);
  el('familiar-blurb').textContent = fam
    ? fam.blurb
    : owned.length
      ? 'delve alone, unencumbered by pets'
      : 'familiars hide somewhere in the dungeons — find their dens';
}

const PARTY_CAP = 4;

function allCompanions(state) {
  return [...COMPANIONS, ...(state.meta.customCharacters ?? [])];
}

/** The party-selection panel: every companion as a selectable card. */
export function renderPartyPanel(state) {
  const party = state.meta.party ?? [];
  const alone = state.meta.mode === 'party';
  el('party-count').textContent =
    `${party.length} / ${PARTY_CAP} chosen — ${alone ? 'the party delves without the dragon' : 'alongside the dragon'}`;
  el('party-list').replaceChildren(
    ...allCompanions(state).map((c) => {
      const chosen = party.includes(c.id);
      const card = document.createElement('div');
      card.className = 'party-card' + (chosen ? ' chosen' : '');
      card.dataset.cid = c.id;
      const magic = c.spells?.length
        ? `Casts on ${(c.castStat ?? 'cha').toUpperCase()} — ${c.spells.map((id) => spellById(id)?.name).filter(Boolean).join(', ')}`
        : 'No magic — pure steel';
      card.innerHTML = `
        <span class="party-card-check">${chosen ? '✓' : ''}</span>
        <span class="party-card-face sprite f2 flip"><img src="${SPRITES[c.anim.idle]}" alt=""></span>
        <span class="party-card-info">
          <span class="party-card-name">${c.name}${c.imported ? ' <span class="imported-tag">(imported)</span>' : ''}</span>
          <span class="party-card-role">${c.role ?? 'Adventurer'} · AC ${c.ac} · ${c.hpMax} HP · ${c.attacks[0].damage}</span>
          <span class="party-card-spells">${magic}</span>
        </span>
        <button class="party-card-sheet zone-btn" data-sheet="${c.id}">Sheet</button>`;
      return card;
    })
  );
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
    ? `<h3>Spells <span class="cast-stat">(cast on ${(subject.castStat ?? 'cha').toUpperCase()})</span></h3><ul>${subject.spells.map((s) => `<li>${s.name} — ${s.blurb}</li>`).join('')}</ul>`
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
    ${subject.renown?.length ? `<h3>Renown</h3><ul>${subject.renown.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}
    ${subject.traits?.length ? `<h3>Traits</h3><ul>${subject.traits.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
    ${growthHtml(subject)}
    ${equipmentHtml(subject)}`;
  showOverlay('sheet-overlay', true);
}

function growthHtml(subject) {
  if (!subject.growth) return '';
  const g = subject.growth;
  let html = `<h3>Level ${g.level}</h3><p class="sheet-blurb">${g.xp} XP${g.next ? ` — next level at ${g.next}` : ' — at the summit'}</p>`;
  if (g.pending > 0) {
    const spellOpts = g.learnable
      .map((sp) => `<button class="zone-btn advance-btn" data-advance="spell" data-spell="${sp.id}">Learn ${sp.name}</button>`)
      .join('');
    html += `
      <p class="sheet-blurb">Level up! Choose ${g.pending} advance${g.pending > 1 ? 's' : ''}:</p>
      <div class="zone-buttons">
        <button class="zone-btn advance-btn" data-advance="hp">+2 max HP</button>
        <button class="zone-btn advance-btn" data-advance="attack">+1 to hit</button>
        <button class="zone-btn advance-btn" data-advance="ac">+1 AC</button>
        ${spellOpts}
      </div>`;
  }
  return html;
}

function equipmentHtml(subject) {
  if (!subject.equip) return '';
  const { charKey, slots, taken } = subject.equip;
  const rows = SLOTS.map((slot) => {
    const current = slots[slot] ?? '';
    const options = ITEMS.filter((i) => i.slot === slot && subject.equip.inventory.includes(i.id));
    const opts = [
      `<option value="">— nothing —</option>`,
      ...options.map((i) => `<option value="${i.id}" ${i.id === current ? 'selected' : ''}>${i.name} — ${i.blurb}${taken[i.id] && taken[i.id] !== charKey ? ' (worn by another)' : ''}</option>`),
    ].join('');
    return `<label class="equip-row">${slot}: <select class="spell-select equip-select" data-char="${charKey}" data-slot="${slot}">${opts}</select></label>`;
  }).join('');
  return `<h3>Equipment</h3><div class="equip-grid">${rows}</div>
    <p class="sheet-blurb">changes take effect at the next labyrinth</p>`;
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
