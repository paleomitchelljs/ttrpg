// Combat presentation. Combat logic resolves instantly in the engine; this
// module replays each event batch dramatically, in order: hero d20s get a
// full-screen BG3-style cinematic (matching the portal's DiceOverlay),
// monster rolls play as a compact corner toast, and every beat lands
// physically on the battle stage — heroes lined up on the left facing the
// monsters on the right, attackers lunging across the gap. While a batch is
// replaying, the action buttons are locked.

import {
  livingMonsters,
  livingHeroes,
  heroesOf,
  dragonOf,
  isPlayerTurn,
  currentCombatant,
} from '../engine/combat.js';
import { spritePath } from './mapView.js';
import { SPRITES } from '../assets-manifest.js';
import { SPELLS, spellById } from '../../data/spells.js';

const DRAGON_FIRE_IMG = './assets/dragon-fire.png';
const DRAGON_FLY_STRIP = SPRITES['dragon-fly'];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- queue
const batches = [];
let processing = false;

// The highlighted enemy: attacks and single-target spells go here. Click an
// enemy on the stage to change it; falls back to the first living monster.
let targetId = null;

/** Enqueue an event batch for dramatic replay. Safe to call every emit. */
export function presentCombat(els, state, events, handlers) {
  batches.push({ state, events, handlers });
  if (!processing) void processBatches(els);
}

async function processBatches(els) {
  processing = true;
  while (batches.length) {
    const { state, events, handlers } = batches.shift();
    lockActions(els);
    for (const ev of events) await presentEvent(els, ev);
    const combat = state.run?.combat?.combat;
    if (combat && !combat.over) renderCombat(els, state, handlers);
    handlers.onBatchDone?.(events);
  }
  processing = false;
}

function lockActions(els) {
  const note = document.createElement('div');
  note.className = 'turn-note';
  note.textContent = '…';
  els.actions.replaceChildren(note);
}

// ---------------------------------------------------------------- events
async function presentEvent(els, ev) {
  switch (ev.type) {
    case 'combat-start': {
      targetId = null;
      els.log.replaceChildren();
      els.overlay.hidden = false;
      const names = ev.monsters.map((m) => m.name);
      appendLog(els.log, `Danger! ${listNames(names)} block${names.length === 1 ? 's' : ''} your path!`, 'log-start');
      return delay(400);
    }
    case 'initiative':
      appendLog(els.log, `Initiative: ${ev.order.map((o) => `${o.name} ${o.initiative}`).join(' · ')}`, 'log-dim');
      return delay(300);
    case 'round':
      appendLog(els.log, `— Round ${ev.round} —`, 'log-dim');
      return delay(200);
    case 'attack': {
      if (ev.attackerKind !== 'monster') await playCinematic(strikePayload(ev));
      else await playToast(ev);
      await attackBeat(els, ev);
      const line = attackLine(ev);
      appendLog(els.log, line.text, line.cls);
      return delay(150);
    }
    case 'breath': {
      await playCinematic(breathPayload(ev));
      appendLog(els.log, `The dragon unleashes a torrent of flame! (${ev.total} fire damage, save DC ${ev.dc})`, 'log-start');
      await breathBeat(els, ev);
      for (const r of ev.results) {
        appendLog(
          els.log,
          r.saved
            ? `The ${r.name} dives aside — only ${r.damage}! (save ${r.total} vs ${r.dc})`
            : `The ${r.name} is engulfed for ${r.damage}! (save ${r.total} vs ${r.dc})`,
          r.saved ? 'log-miss' : 'log-hit'
        );
        await delay(120);
      }
      return;
    }
    case 'spell-cast': {
      await playCinematic(spellPayload(ev));
      appendLog(
        els.log,
        ev.success
          ? `${ev.caster} casts ${ev.name}! (${ev.total} vs DC ${ev.dc})`
          : `${ev.caster}'s ${ev.name} fizzles… the spell is spent for this fight. (${ev.total} vs DC ${ev.dc})`,
        ev.success ? 'log-start' : 'log-miss'
      );
      return delay(200);
    }
    case 'spell-hit': {
      const card = cardOf(els, ev.targetId);
      if (card) {
        card.classList.add('hit-flash');
        updateCardHp(card, ev.hpAfter);
      }
      appendLog(els.log, `The bolt sears the ${ev.target} for ${ev.damage}!`, 'log-hit');
      await delay(450);
      card?.classList.remove('hit-flash');
      return;
    }
    case 'spell-heal': {
      const card = cardOf(els, ev.targetId);
      if (card) {
        card.classList.add('heal-flash');
        card.classList.remove('down');
        updateCardHp(card, ev.hpAfter);
      }
      appendLog(
        els.log,
        ev.revived
          ? `${ev.target} staggers back up with ${ev.amount} HP!`
          : `${ev.target} is healed for ${ev.amount}!`,
        'log-hit'
      );
      await delay(500);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'spell-wave': {
      appendLog(els.log, `A wave of flame rolls over the enemies! (${ev.total} damage, save DC ${ev.dc})`, 'log-start');
      for (const r of ev.results) {
        const card = cardOf(els, r.id);
        if (card) {
          card.classList.add('hit-flash');
          updateCardHp(card, r.hpAfter);
        }
        appendLog(
          els.log,
          r.saved ? `The ${r.name} ducks — ${r.damage}!` : `The ${r.name} burns for ${r.damage}!`,
          r.saved ? 'log-miss' : 'log-hit'
        );
        await delay(160);
      }
      await delay(300);
      for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
      return;
    }
    case 'morale':
      appendLog(
        els.log,
        ev.pass
          ? `The ${ev.who} grits its teeth and stands firm. (${ev.total} vs ${ev.dc})`
          : `The ${ev.who} panics! (${ev.total} vs ${ev.dc})`,
        ev.pass ? 'log-dim' : 'log-start'
      );
      return delay(350);
    case 'flee': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('fleeing');
      appendLog(els.log, `The ${ev.who} flees into the dark!`, 'log-miss');
      return delay(450);
    }
    case 'recharge':
      appendLog(
        els.log,
        ev.ready ? `The dragon's fire roils back to life!` : `The dragon's flames sputter… (recharge ${ev.roll}, needs 5+)`,
        ev.ready ? 'log-start' : 'log-dim'
      );
      return delay(250);
    case 'death': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('dying');
      appendLog(els.log, `The ${ev.who} is defeated! (worth ${ev.goldValue} gold)`, 'log-hit');
      return delay(500);
    }
    case 'hero-down': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('down');
      appendLog(els.log, `${ev.who} falls!`, 'log-hurt');
      return delay(500);
    }
    case 'victory':
      appendLog(
        els.log,
        `Victory! You snatch up ${ev.gold} gold.${ev.fled ? ' The cowards that fled kept theirs!' : ''}`,
        'log-start'
      );
      return delay(700);
    case 'defeat':
      appendLog(els.log, `The dragon has no strength left…`, 'log-hurt');
      return delay(600);
    default:
      return;
  }
}

function listNames(names) {
  const counts = new Map();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts.entries()]
    .map(([n, c]) => (c > 1 ? `${c} ${n}s` : `a ${n}`))
    .join(' and ');
}

function attackLine(ev) {
  const heroSide = ev.attackerKind !== 'monster';
  const verb = ev.attackerKind === 'dragon' ? 'bite' : ev.attackName;
  if (ev.crit) {
    return {
      text: heroSide
        ? `CRITICAL! ${ev.attacker}'s ${verb} crunches the ${ev.target} for ${ev.damage}!`
        : `CRITICAL! The ${ev.attacker}'s ${ev.attackName} hits ${ev.target} for ${ev.damage}!`,
      cls: heroSide ? 'log-hit' : 'log-hurt',
    };
  }
  if (!ev.hit) {
    return {
      text: heroSide
        ? `${ev.attacker}'s ${verb} misses the ${ev.target}.`
        : `The ${ev.attacker}'s ${ev.attackName} misses ${ev.target}.`,
      cls: 'log-miss',
    };
  }
  return {
    text: heroSide
      ? `${ev.attacker}'s ${verb} hits the ${ev.target} for ${ev.damage}!`
      : `The ${ev.attacker}'s ${ev.attackName} hits ${ev.target} for ${ev.damage}.`,
    cls: heroSide ? 'log-hit' : 'log-hurt',
  };
}

// ---------------------------------------------------------------- beats
function cardOf(els, id) {
  return els.overlay.querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function setStrip(cardEl, mode) {
  const sprite = cardEl?.querySelector('.combat-sprite img');
  if (!sprite) return;
  const src = cardEl.dataset[mode];
  if (src) sprite.src = src;
}

function updateCardHp(cardEl, hp) {
  if (!cardEl) return;
  const max = Number(cardEl.dataset.hpmax) || 1;
  const pct = Math.max(0, Math.round((100 * hp) / max));
  const fill = cardEl.querySelector('.hp-fill');
  const num = cardEl.querySelector('.hp-num');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.classList.toggle('low', pct <= 35);
  }
  if (num) num.textContent = `${hp} / ${max} HP`;
}

async function attackBeat(els, ev) {
  const attacker = cardOf(els, ev.attackerId);
  const victim = cardOf(els, ev.targetId);
  if (attacker) {
    setStrip(attacker, 'attack');
    attacker.classList.add('lunging');
  }
  await delay(280);
  if (ev.hit && victim) {
    victim.classList.add('hit-flash');
    updateCardHp(victim, ev.targetHpAfter);
  }
  await delay(320);
  if (attacker) {
    attacker.classList.remove('lunging');
    setStrip(attacker, 'idle');
  }
  victim?.classList.remove('hit-flash');
}

async function breathBeat(els, ev) {
  const dragonCard = els.player.querySelector('.unit.dragon');
  const img = dragonCard?.querySelector('.combat-sprite img');
  const spriteBox = dragonCard?.querySelector('.combat-sprite');
  if (img) {
    img.src = DRAGON_FIRE_IMG;
    spriteBox.classList.remove('f4');
    spriteBox.classList.add('static');
  }
  dragonCard?.classList.add('breathing');
  els.enemies.classList.add('scorched');
  await delay(500);
  for (const r of ev.results) {
    const card = cardOf(els, r.id);
    if (card) {
      card.classList.add('hit-flash');
      updateCardHp(card, r.hpAfter);
    }
    await delay(140);
  }
  await delay(400);
  els.enemies.classList.remove('scorched');
  dragonCard?.classList.remove('breathing');
  for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
  if (img) {
    img.src = DRAGON_FLY_STRIP;
    spriteBox.classList.add('f4');
    spriteBox.classList.remove('static');
  }
}

// ---------------------------------------------------------------- payloads
function verdictFor(ev) {
  if (ev.crit) return { text: `CRITICAL HIT! ${ev.damage} damage!`, cls: 'crit' };
  if (ev.fumble) return { text: 'FUMBLE!', cls: 'fumble' };
  if (ev.hit) return { text: `HIT! ${ev.damage} damage!`, cls: 'good' };
  return { text: 'MISS', cls: 'bad' };
}

function strikePayload(ev) {
  const verdict = verdictFor(ev);
  const verb = ev.attackerKind === 'dragon' ? 'Bite' : cap(ev.attackName);
  return {
    title: `${ev.attacker} — ${verb} the ${ev.target}!`,
    sides: 20,
    rolls: ev.dieRolls,
    kept: ev.natural,
    mode: ev.mode,
    parts: [{ label: 'attack', value: ev.toHit }],
    total: ev.total,
    targetLabel: `AC ${ev.targetAc}`,
    verdict: verdict.text,
    vclass: verdict.cls,
    nat: ev.crit ? 20 : ev.fumble ? 1 : 0,
  };
}

function breathPayload(ev) {
  return {
    title: 'Fire Breath!',
    sides: 6,
    rolls: ev.rolls,
    kept: null,
    mode: 'straight',
    parts: [],
    total: ev.total,
    targetLabel: `save DC ${ev.dc}`,
    verdict: `${ev.total} FIRE DAMAGE!`,
    vclass: 'crit',
    nat: 0,
  };
}

function spellPayload(ev) {
  return {
    title: `${ev.caster} casts ${ev.name}!`,
    sides: 20,
    rolls: [ev.natural],
    kept: ev.natural,
    mode: 'straight',
    parts: ev.bonus ? [{ label: 'magic', value: ev.bonus }] : [],
    total: ev.total,
    targetLabel: `DC ${ev.dc}`,
    verdict: ev.success ? 'CAST!' : 'FIZZLE…',
    vclass: ev.success ? 'good' : 'fumble',
    nat: ev.natural === 20 ? 20 : ev.natural === 1 ? 1 : 0,
  };
}

// ---------------------------------------------------------------- cinematic
function dieHtml(sides, small) {
  return `<div class="dice-die${small ? ' small' : ''} spinning">
    <span class="dice-die-num">?</span>
    <span class="dice-die-sides">d${sides}</span>
  </div>`;
}

function playCinematic(p) {
  return new Promise((resolve) => {
    const root = document.getElementById('dice-cinematic');
    const small = p.rolls.length > 2;
    root.className = 'dice-overlay';
    root.innerHTML = `
      <div class="dice-stage">
        <div class="dice-title">${p.title}</div>
        ${p.targetLabel ? `<div class="dice-target">vs ${p.targetLabel}</div>` : ''}
        <div class="dice-tray">${p.rolls.map(() => dieHtml(p.sides, small)).join('')}</div>
        ${p.mode === 'advantage' ? '<div class="dice-mode">▲ advantage — keep the best</div>' : ''}
        ${p.mode === 'disadvantage' ? '<div class="dice-mode">▼ disadvantage — keep the worst</div>' : ''}
        <div class="dice-parts">${p.parts
          .filter((x) => x.value !== 0)
          .map((x) => `<span class="dice-part${x.value < 0 ? ' neg' : ''}">${x.value >= 0 ? '+' : '−'}${Math.abs(x.value)} <em>${x.label}</em></span>`)
          .join('')}</div>
        <div class="dice-total">${p.total}</div>
        <div class="dice-verdict ${p.vclass}">${p.verdict}</div>
        <div class="dice-hint">tap to skip</div>
      </div>`;
    root.hidden = false;

    const dice = [...root.querySelectorAll('.dice-die')];
    const spin = setInterval(() => {
      for (const d of dice) {
        d.querySelector('.dice-die-num').textContent = 1 + Math.floor(Math.random() * p.sides);
      }
    }, 70);

    const settle = () => {
      clearInterval(spin);
      dice.forEach((d, i) => {
        d.classList.remove('spinning');
        d.classList.add('settled');
        d.querySelector('.dice-die-num').textContent = p.rolls[i];
        if (p.kept != null && p.rolls.length > 1 && p.rolls[i] !== p.kept) d.classList.add('dropped');
        if (p.nat === 20 && p.rolls[i] === 20) d.classList.add('nat20');
        if (p.nat === 1 && p.rolls[i] === 1) d.classList.add('nat1');
      });
      if (p.kept != null && p.rolls.length > 1 && p.rolls[0] === p.rolls[1]) {
        dice[1].classList.add('dropped');
        dice[0].classList.remove('dropped');
      }
    };
    const reveal = () => {
      root.querySelector('.dice-parts').classList.add('shown');
      root.querySelector('.dice-total').classList.add('shown');
    };
    const verdict = () => {
      root.querySelector('.dice-verdict').classList.add('shown');
      root.classList.add(p.vclass);
    };

    const steps = [
      { at: 800, fn: settle },
      { at: 1250, fn: reveal },
      { at: 1700, fn: verdict },
      { at: 2750, fn: null },
    ];
    let idx = 0;
    let timer = null;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearInterval(spin);
      clearTimeout(timer);
      root.hidden = true;
      root.onclick = null;
      resolve();
    };
    const schedule = (prevAt) => {
      if (idx >= steps.length) return finish();
      const step = steps[idx++];
      timer = setTimeout(() => {
        if (step.fn) step.fn();
        schedule(step.at);
        if (!step.fn) finish();
      }, step.at - prevAt);
    };
    schedule(0);
    root.onclick = () => {
      if (!root.querySelector('.dice-verdict').classList.contains('shown')) {
        clearTimeout(timer);
        settle();
        reveal();
        verdict();
        idx = steps.length;
        timer = setTimeout(finish, 900);
      } else {
        finish();
      }
    };
  });
}

// ---------------------------------------------------------------- toast
function playToast(ev) {
  return new Promise((resolve) => {
    const root = document.getElementById('roll-toast');
    const verdict = verdictFor(ev);
    root.className = 'roll-toast';
    root.innerHTML = `
      <div class="roll-toast-title">${ev.attacker} → ${ev.target}!</div>
      <div class="roll-toast-body">
        <div class="dice-die small spinning"><span class="dice-die-num">?</span><span class="dice-die-sides">d20</span></div>
        <div class="roll-toast-math"></div>
      </div>`;
    root.hidden = false;
    const die = root.querySelector('.dice-die');
    const num = die.querySelector('.dice-die-num');
    const spin = setInterval(() => {
      num.textContent = 1 + Math.floor(Math.random() * 20);
    }, 65);
    setTimeout(() => {
      clearInterval(spin);
      num.textContent = ev.natural;
      die.classList.remove('spinning');
      die.classList.add('settled');
      if (ev.crit) die.classList.add('nat20');
      if (ev.fumble) die.classList.add('nat1');
      root.classList.add(verdict.cls);
      root.querySelector('.roll-toast-math').innerHTML =
        `<span class="roll-toast-total">${ev.total}</span>
         <span class="roll-toast-target">vs AC ${ev.targetAc}</span>
         <span class="roll-toast-verdict ${verdict.cls}">${verdict.text}</span>`;
    }, 450);
    setTimeout(() => {
      root.hidden = true;
      resolve();
    }, 1500);
  });
}

// ---------------------------------------------------------------- stage
const ICONS = {
  fang: '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 1c1.5 2 1.6 5 3 12 1.4-7 1.5-10 3-12-1.2 1.1-4.8 1.1-6 0Z" fill="#fff"/></svg>',
  flame: '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1c1 3-3 4.5-3 8a3 3 0 0 0 6 .2C11 7 12.4 6.6 11.4 4 13.5 6 15 7.8 15 10A7 7 0 1 1 1 10C1 6.2 6 4.6 8 1Z" fill="#ffb03b"/></svg>',
  spark: '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l1.8 5.2L15 8l-5.2 1.8L8 15l-1.8-5.2L1 8l5.2-1.8Z" fill="#cbb3ff"/></svg>',
};

export function renderCombat(els, state, handlers) {
  const combat = state.run?.combat?.combat;
  if (!combat) return;
  const activeId = isPlayerTurn(combat) ? currentCombatant(combat).id : null;

  // keep the target valid: default to the first living monster
  const living = livingMonsters(combat);
  if (!living.some((m) => m.id === targetId)) targetId = living[0]?.id ?? null;

  els.enemies.replaceChildren(
    ...combat.order
      .filter((c) => c.kind === 'monster')
      .map((m) => {
        const unit = unitEl(m, 'enemy', activeId);
        if (m.hp.current > 0 && !m.fled) {
          if (m.id === targetId) unit.classList.add('targeted');
          unit.addEventListener('click', () => {
            targetId = m.id;
            renderCombat(els, state, handlers);
          });
        }
        return unit;
      })
  );
  els.player.replaceChildren(...heroesOf(combat).map((h) => unitEl(h, 'hero', activeId)));

  renderActions(els, combat, handlers, null);
}

function unitEl(c, side, activeId) {
  const dead = c.hp.current <= 0;
  const unit = document.createElement('div');
  unit.className = [
    'unit',
    side,
    c.kind === 'dragon' ? 'dragon' : '',
    side === 'enemy' && dead ? 'dead' : '',
    side === 'hero' && dead ? 'down' : '',
    c.fled ? 'fled' : '',
    c.id === activeId ? 'active' : '',
  ].filter(Boolean).join(' ');
  unit.dataset.id = c.id;
  unit.dataset.hpmax = c.hp.max;
  if (c.kind === 'dragon') {
    unit.dataset.idle = DRAGON_FLY_STRIP;
    unit.dataset.attack = DRAGON_FLY_STRIP;
  } else if (c.anim) {
    unit.dataset.idle = spritePath(c.anim.idle);
    unit.dataset.attack = spritePath(c.anim.attack);
  }
  const plate = `
    <div class="plate">
      <div class="unit-name">${c.name}</div>
      ${c.fled ? '<div class="badge-flee">fled!</div>' : hpBar(c)}
      ${!dead && !c.fled && c.panicked ? '<div class="badge-panic">panicked!</div>' : ''}
    </div>`;
  const face = faceHtml(c, dead);
  // heroes: sprite then plate; enemies: plate then sprite (mirrored layout)
  unit.innerHTML = side === 'hero' ? face + plate : plate + face;
  return unit;
}

function faceHtml(c, dead) {
  if (c.kind === 'dragon') {
    return `<div class="combat-sprite sprite f4 flip"><img src="${DRAGON_FLY_STRIP}" alt="${c.name}"></div>`;
  }
  if (c.anim?.idle) {
    // hero side art faces left natively; flip heroes to face the enemy column
    const flip = c.kind === 'hero' ? ' flip' : '';
    return `<div class="combat-sprite sprite f2${flip}"><img src="${spritePath(c.anim.idle)}" alt="${c.name}"></div>`;
  }
  return `<div class="enemy-face">${dead ? '☠' : c.emoji}</div>`;
}

function hpBar(c) {
  const pct = Math.max(0, Math.round((100 * c.hp.current) / c.hp.max));
  return `
    <div class="hp-bar"><div class="hp-fill${pct <= 35 ? ' low' : ''}" style="width:${pct}%"></div></div>
    <div class="hp-num">${c.hp.current} / ${c.hp.max} HP</div>`;
}

// ---------------------------------------------------------------- actions
function renderActions(els, combat, handlers, targetSpell) {
  if (combat.over || !isPlayerTurn(combat)) {
    const wait = document.createElement('div');
    wait.className = 'turn-note';
    wait.textContent = combat.over ? '' : 'The monsters act…';
    els.actions.replaceChildren(wait);
    return;
  }
  const actor = currentCombatant(combat);

  // Second step of casting: pick the spell's target.
  if (targetSpell) {
    const buttons = [];
    const targets =
      targetSpell.target === 'enemy' ? livingMonsters(combat) : heroesOf(combat);
    for (const t of targets) {
      const btn = document.createElement('button');
      btn.className = 'btn attack-btn spell-btn';
      btn.innerHTML = `${ICONS.spark}<span>${targetSpell.name} → ${t.name}</span>`;
      btn.addEventListener('click', () => handlers.onCast(targetSpell.id, t.id));
      buttons.push(btn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'btn btn-small';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => renderActions(els, combat, handlers, null));
    buttons.push(cancel);
    els.actions.replaceChildren(...buttons);
    return;
  }

  const buttons = [];
  const verb = actor.kind === 'dragon' ? 'Bite' : 'Strike';
  const target = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
  if (target) {
    const btn = document.createElement('button');
    btn.className = 'btn attack-btn';
    btn.innerHTML = `${ICONS.fang}<span>${verb} the ${target.name}!${target.panicked ? ' (advantage!)' : ''}</span>`;
    btn.addEventListener('click', () => handlers.onAttack(target.id));
    buttons.push(btn);
    if (livingMonsters(combat).length > 1) {
      const note = document.createElement('div');
      note.className = 'target-note';
      note.textContent = 'tap an enemy to change target';
      buttons.push(note);
    }
  }
  if (actor.kind === 'dragon' && actor.breath) {
    const btn = document.createElement('button');
    btn.className = 'btn attack-btn breath-btn';
    if (combat.breathReady) {
      btn.innerHTML = `${ICONS.flame}<span>Fire Breath!</span>`;
      btn.title = `${actor.breath.damage} fire damage to every enemy — they save vs DC ${actor.breath.dc} for half`;
      btn.addEventListener('click', () => handlers.onBreath());
    } else {
      btn.innerHTML = `${ICONS.flame}<span>Recharging…</span>`;
      btn.disabled = true;
    }
    buttons.push(btn);
  }
  if (actor.spells.length) {
    const sel = document.createElement('select');
    sel.className = 'spell-select';
    sel.innerHTML =
      `<option value="">Cast a spell…</option>` +
      actor.spells
        .map((id) => {
          const s = spellById(id);
          const burned = actor.burned.includes(id);
          return `<option value="${id}" ${burned ? 'disabled' : ''}>${s.name} — ${s.blurb}${burned ? ' (spent)' : ''}</option>`;
        })
        .join('');
    sel.addEventListener('change', () => {
      const spell = spellById(sel.value);
      if (!spell) return;
      sel.value = '';
      if (spell.target === 'enemy') {
        // single-target spells hit the highlighted enemy, same as attacks
        const target = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
        handlers.onCast(spell.id, target?.id ?? null);
        return;
      }
      const targets = heroesOf(combat);
      if (spell.target === 'all-enemies' || targets.length <= 1) {
        handlers.onCast(spell.id, targets[0]?.id ?? null);
      } else {
        renderActions(els, combat, handlers, spell);
      }
    });
    buttons.push(sel);
  }
  els.actions.replaceChildren(...buttons);
}

function appendLog(logEl, text, cls = '') {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
