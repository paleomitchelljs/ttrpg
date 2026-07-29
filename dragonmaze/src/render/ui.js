// Screens, HUD, overlays, exploration log. Dumb DOM helpers only — all
// decisions live in gameState; main.js wires intents.

import { zoneById } from '../../data/zones.js';
import { ITEMS, SLOTS, itemById } from '../../data/items.js';
import { spellById } from '../../data/spells.js';
import { COMPANIONS } from '../../data/party.js';
import { SPRITES, TILES } from '../assets-manifest.js';

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
  // party summary + panel (the dragon and all companions live in the panel now)
  const party = state.meta.party ?? [];
  const named = party.map((id) => allCompanions(state).find((c) => c.id === id)?.name ?? id);
  const withDragon = (state.meta.mode ?? 'dragon') === 'dragon';
  const roster = withDragon ? ['Red Dragon', ...named] : named;
  el('party-summary').textContent = roster.length
    ? `Delving: ${roster.join(', ')}`
    : 'The dragon delves alone.';
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

}

const PARTY_CAP = 4;

function allCompanions(state) {
  return [...COMPANIONS, ...(state.meta.customCharacters ?? [])];
}

/** The party-selection panel: every companion as a selectable card. */
export function renderPartyPanel(state) {
  const party = state.meta.party ?? [];
  const withDragon = (state.meta.mode ?? 'dragon') === 'dragon';
  el('party-count').textContent =
    `${withDragon ? 'The dragon leads' : 'The party goes alone'} · ${party.length}/${PARTY_CAP} companions`;

  // The dragon rides at the top of the same list as a togglable member.
  const dragonCard = document.createElement('div');
  dragonCard.className = 'party-card dragon-card' + (withDragon ? ' chosen' : '');
  dragonCard.dataset.dragon = '1';
  dragonCard.innerHTML = `
    <span class="party-card-check">${withDragon ? '✓' : ''}</span>
    <span class="party-card-face sprite f2 flip"><img src="${SPRITES['dragon-fly']}" alt=""></span>
    <span class="party-card-info">
      <span class="party-card-name">Red Dragon</span>
      <span class="party-card-role">You, the wyrm: fire breath &amp; bite</span>
      <span class="party-card-spells">Grows mightier as the hoard grows</span>
    </span>
    <button class="party-card-sheet zone-btn" data-sheet="dragon">Sheet</button>`;

  el('party-list').replaceChildren(
    dragonCard,
    ...allCompanions(state).map((c) => {
      const chosen = party.includes(c.id);
      const card = document.createElement('div');
      card.className = 'party-card' + (chosen ? ' chosen' : '');
      card.dataset.cid = c.id;
      const magic = c.spells?.length
        ? `Casts on ${(c.castStat ?? 'cha').toUpperCase()}: ${c.spells.map((id) => spellById(id)?.name).filter(Boolean).join(', ')}`
        : 'No magic, pure steel';
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
    .map((a) => `<li>${cap(a.name)}: +${a.toHit} to hit, ${a.damage} damage</li>`)
    .join('');
  const spells = subject.spells.length
    ? `<h3>Spells <span class="cast-stat">(cast on ${(subject.castStat ?? 'cha').toUpperCase()})</span></h3><ul>${subject.spells.map((s) => `<li>${s.name}: ${s.blurb}</li>`).join('')}</ul>`
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
    ${subject.familiar ? `<h3>Familiar</h3><ul><li>${subject.familiar.name}: ${subject.familiar.blurb}</li></ul>` : ''}
    ${subject.renown?.length ? `<h3>Renown</h3><ul>${subject.renown.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}
    ${subject.traits?.length ? `<h3>Traits</h3><ul>${subject.traits.map((t) => `<li>${t}</li>`).join('')}</ul>` : ''}
    ${growthHtml(subject)}
    ${equipmentHtml(subject)}`;
  showOverlay('sheet-overlay', true);
}

const ABILITY_ORDER = [['str', 'STR'], ['dex', 'DEX'], ['con', 'CON'], ['int', 'INT'], ['wis', 'WIS'], ['cha', 'CHA']];

function growthHtml(subject) {
  if (!subject.growth) return '';
  const g = subject.growth;
  let html = `<h3>Level ${g.level}</h3><p class="sheet-blurb">${g.xp} XP${g.next ? `, next level at ${g.next}` : ', at the summit'} · +${g.hpPerLevel} HP each level (automatic)</p>`;
  if (g.talents.length) html += `<p class="sheet-blurb">Talents: ${g.talents.join(', ')}</p>`;

  if (g.pendingAsi > 0) {
    const abil = ABILITY_ORDER.map(([k, label]) => {
      const v = g.abilities[k] ?? 0;
      const atCap = v >= g.abilityCap;
      return `<button class="zone-btn advance-btn" data-advance="asi" data-ability="${k}"${atCap ? ' disabled' : ''}>${label} ${v >= 0 ? '+' : ''}${v}${atCap ? ' (max)' : ` → +${v + 1}`}</button>`;
    }).join('');
    html += `
      <p class="sheet-blurb">Ability increase${g.pendingAsi > 1 ? ` ×${g.pendingAsi}` : ''}: raise one (STR: hit+dmg · DEX: hit+AC · CON: HP · INT/WIS/CHA: casting/talk):</p>
      <div class="zone-buttons">${abil}</div>`;
  }

  if (g.pendingTalent > 0) {
    // One advance per talent slot, chosen from a single grouped dropdown so the
    // list stays compact: a talent, a spell (casters), or a familiar. Each option
    // carries its own type, so `${type}:${id}` is all the confirm handler needs.
    const attr = (s) => (s || '').replace(/"/g, '&quot;');
    const opt = (type, id, label, blurb) =>
      `<option value="${type}:${id}"${blurb ? ` title="${attr(blurb)}"` : ''}>${label}</option>`;
    const group = (label, opts) => (opts ? `<optgroup label="${label}">${opts}</optgroup>` : '');
    const talents = group('Talents', g.talentOptions.map((t) => opt('talent', t.id, t.name, t.blurb)).join(''));
    const spells = group('Spells', g.learnable.map((sp) => opt('spell', sp.id, `Learn ${sp.name}`, sp.blurb)).join(''));
    const familiar = group('Familiar', (g.familiarOptions ?? []).map((f) => opt('familiar', f.id, f.name, f.blurb)).join(''));
    const kinds = ['a talent', g.learnable.length && 'a spell', g.familiarOptions?.length && 'a familiar'].filter(Boolean);
    html += `
      <p class="sheet-blurb">Talent${g.pendingTalent > 1 ? ` ×${g.pendingTalent}` : ''}: choose ${kinds.join(', ').replace(/, ([^,]*)$/, ' or $1')}:</p>
      <div class="advance-picker">
        <select class="advance-select" aria-label="Choose an advance">
          <option value="" disabled selected>Choose an advance…</option>
          ${talents}${spells}${familiar}
        </select>
        <button class="zone-btn advance-confirm" disabled>Confirm</button>
      </div>`;
  }
  return html;
}

function equipmentHtml(subject) {
  if (!subject.equip) return '';
  const { charKey, slots, taken } = subject.equip;
  // Click-to-equip chips that show the item's icon (art from assets/tiles) when
  // it has one; the equipped chip is highlighted, the "none" chip unequips.
  // The weapon slot's "base" (unequipped) chip shows the character's default
  // mundane weapon rather than "none", so every hero has a weapon in view.
  const baseWeapon = subject.equip.weapon;
  const chip = (slot, item) => {
    const equipped = item ? slots[slot] === item.id : !slots[slot];
    const wornByOther = item && taken[item.id] && taken[item.id] !== charKey;
    const isBaseWeapon = !item && slot === 'weapon' && baseWeapon;
    const icon = item?.tile && TILES[item.tile]
      ? `<img class="equip-ico" src="${TILES[item.tile]}" alt="">`
      : `<span class="equip-ico none">${item ? '▪' : isBaseWeapon ? '⚔' : '∅'}</span>`;
    const label = item ? item.name : isBaseWeapon ? baseWeapon : 'none';
    const title = item ? item.blurb.replace(/"/g, '') : isBaseWeapon ? `${baseWeapon}: your default weapon` : 'unequip';
    return `<button class="equip-chip${equipped ? ' on' : ''}${wornByOther ? ' worn' : ''}" data-char="${charKey}" data-slot="${slot}" data-item="${item?.id ?? ''}" title="${title}">${icon}<span class="equip-name">${label}${wornByOther ? ' · worn' : ''}</span></button>`;
  };
  const rows = SLOTS.map((slot) => {
    const options = ITEMS.filter((i) => i.slot === slot && subject.equip.inventory.includes(i.id));
    const chips = [chip(slot, null), ...options.map((i) => chip(slot, i))].join('');
    return `<div class="equip-row"><span class="equip-slot">${slot}</span><div class="equip-chips">${chips}</div></div>`;
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
