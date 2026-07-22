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

// sentinel: "Spell" was chosen, so renderActions shows the spellbook submenu
const SPELL_MENU = Symbol('spell-menu');

// ---------------------------------------------------------------- queue
const batches = [];
let processing = false;

// The highlighted enemy: attacks and single-target spells go here. Click an
// enemy on the stage to change it; falls back to the first living monster.
let targetId = null;
// The highlighted ally: heals go here. Click a hero on the stage to change it;
// falls back to the most wounded.
let heroTargetId = null;

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
    for (const ev of events) {
      await presentEvent(els, ev);
      // 'combat-start' clears the stage; repopulate it at once so the party and
      // enemies are visible immediately, not only when the batch finishes.
      if (ev.type === 'combat-start') renderRoster(els, state);
    }
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
      // Clear the previous fight's stage so no defeated cards flash before the
      // new combatants render.
      els.enemies.replaceChildren();
      els.player.replaceChildren();
      els.actions.replaceChildren();
      els.overlay.hidden = false;
      const names = ev.monsters.map((m) => m.name);
      appendLog(
        els.log,
        ev.label
          ? `${ev.label}: ${listNames(names)} stand${names.length === 1 ? 's' : ''} before you!`
          : `Danger! ${listNames(names)} block${names.length === 1 ? 's' : ''} your path!`,
        'log-start'
      );
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
      const math = `(${ev.total} vs DC ${ev.dc}, on ${(ev.stat ?? 'cha').toUpperCase()})`;
      appendLog(
        els.log,
        ev.success
          ? `${ev.caster} casts ${ev.name}! ${math}`
          : `${ev.caster}'s ${ev.name} fizzles… the spell is spent for this fight. ${math}`,
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
      if (ev.drained) {
        const casterCard = cardOf(els, ev.casterId);
        if (casterCard) {
          casterCard.classList.add('heal-flash');
          updateCardHp(casterCard, ev.casterHpAfter);
        }
        appendLog(els.log, `Darkness tears at the ${ev.target} for ${ev.damage} — ${ev.caster} drinks ${ev.drained} of it!`, 'log-hit');
        await delay(500);
        casterCard?.classList.remove('heal-flash');
      } else {
        appendLog(els.log, `The bolt sears the ${ev.target} for ${ev.damage}!`, 'log-hit');
        await delay(450);
      }
      card?.classList.remove('hit-flash');
      return;
    }
    case 'dominated': {
      const card = cardOf(els, ev.targetId);
      if (card) card.classList.add('hit-flash');
      appendLog(els.log, `The ${ev.who}'s empty eyes dim — it turns to leave, dominated.`, 'log-start');
      await delay(500);
      card?.classList.remove('hit-flash');
      return;
    }
    case 'dominate-resisted':
      appendLog(els.log, `The ${ev.who} is no mindless thing — the domination slides off.`, 'log-miss');
      return delay(400);
    case 'bane':
      appendLog(els.log, `${ev.attacker}'s blade blazes against the ${ev.who}! (+2 undead bane)`, 'log-hit');
      return delay(250);
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
    case 'resist': {
      appendLog(els.log, `The ${ev.who} shrugs off half the ${ev.dtype === 'fire' ? 'flame' : 'blow'}!`, 'log-miss');
      return delay(250);
    }
    case 'vulnerable': {
      appendLog(els.log, `The ${ev.who} ${ev.dtype === 'fire' ? 'goes up like kindling' : 'takes it hard'} — double damage!`, 'log-hit');
      return delay(250);
    }
    case 'relentless': {
      const card = cardOf(els, ev.id);
      if (card) updateCardHp(card, 1);
      appendLog(els.log, `The ${ev.who} should have fallen… but it keeps coming!`, 'log-start');
      return delay(400);
    }
    case 'regenerate': {
      const card = cardOf(els, ev.id);
      if (card) {
        card.classList.add('heal-flash');
        updateCardHp(card, ev.hpAfter);
      }
      appendLog(els.log, `The ${ev.who}'s wounds knit closed. (+2 HP)`, 'log-dim');
      await delay(350);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'lifedrain': {
      const card = cardOf(els, ev.id);
      if (card) {
        card.classList.add('heal-flash');
        updateCardHp(card, ev.hpAfter);
      }
      appendLog(els.log, `The ${ev.who} drinks the wound — it heals ${ev.amount}!`, 'log-hurt');
      await delay(350);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'parley': {
      const verb = { threaten: 'growls a threat', persuade: 'talks fast', barter: 'offers a trade', work: 'asks for work' }[ev.mode] ?? 'parleys';
      appendLog(
        els.log,
        ev.success
          ? `${ev.actor} ${verb} — and they listen! (${ev.total} vs DC ${ev.dc})`
          : `${ev.actor} ${verb}… but they aren't having it. (${ev.total} vs DC ${ev.dc})`,
        ev.success ? 'log-start' : 'log-miss'
      );
      return delay(450);
    }
    case 'parley-rout':
      appendLog(els.log, `They break! The whole pack scatters before you!`, 'log-start');
      return delay(450);
    case 'parley-peace':
      appendLog(
        els.log,
        ev.mode === 'barter'
          ? 'A deal is struck — they withdraw with their price.'
          : ev.mode === 'work'
            ? 'Weapons lower. They have a job for you…'
            : 'Words win. They lower their weapons and withdraw.',
        'log-start'
      );
      return delay(500);
    case 'parley-paid':
      appendLog(els.log, `You hand over ${ev.cost} gold.`, 'log-miss');
      return delay(300);
    case 'quest-received':
      appendLog(els.log, `Bounty accepted: slay ${ev.target} for ${ev.reward} gold!`, 'log-start');
      return delay(500);
    case 'quest-complete':
      appendLog(els.log, `Bounty fulfilled — ${ev.target} is slain! ${ev.reward} gold, and word of your deed spreads.`, 'log-start');
      return delay(600);
    case 'morale':
      appendLog(
        els.log,
        ev.pass
          ? `The ${ev.who} grits its teeth and stands firm. (${ev.total} vs ${ev.dc})`
          : `The ${ev.who} panics! (${ev.total} vs ${ev.dc})`,
        ev.pass ? 'log-dim' : 'log-start'
      );
      return delay(350);
    case 'intimidate': {
      const card = cardOf(els, ev.targetId);
      if (ev.fearless) {
        appendLog(els.log, `The ${ev.target} is fearless — threats roll off it.`, 'log-miss');
        return delay(400);
      }
      appendLog(
        els.log,
        ev.success
          ? `${ev.actor} cows the ${ev.target}! (${ev.total} vs DC ${ev.dc})`
          : `${ev.actor} tries to cow the ${ev.target}, but it holds. (${ev.total} vs DC ${ev.dc})`,
        ev.success ? 'log-start' : 'log-miss'
      );
      if (ev.success && card) card.classList.add('hit-flash');
      return delay(500);
    }
    case 'flee-combat':
      appendLog(els.log, 'You break off and flee the fight — the gold you carried scatters behind you!', 'log-hurt');
      return delay(500);
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
      return delay(800);
    }
    case 'hero-down': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('down');
      appendLog(els.log, `${ev.who} falls!`, 'log-hurt');
      return delay(500);
    }
    case 'item-drop':
      appendLog(els.log, `Among the spoils: ${ev.name} — ${ev.blurb}. Equip it from a character sheet!`, 'log-start');
      return delay(2400);
    case 'victory':
      appendLog(
        els.log,
        `Victory! You snatch up ${ev.gold} gold.${ev.fled ? ' The cowards that fled kept theirs!' : ''}`,
        'log-start'
      );
      return delay(2000);
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
    parts: ev.bonus ? [{ label: (ev.stat ?? 'cha').toUpperCase(), value: ev.bonus }] : [],
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

// Draw the combatants with no actions or click handlers — used the instant
// combat opens so the stage isn't blank while the opening beats replay.
function renderRoster(els, state) {
  const combat = state.run?.combat?.combat;
  if (!combat) return;
  els.enemies.replaceChildren(
    ...combat.order.filter((c) => c.kind === 'monster').map((m) => unitEl(m, 'enemy', null))
  );
  els.player.replaceChildren(...heroesOf(combat).map((h) => unitEl(h, 'hero', null)));
  // The target info strip is only meaningful while the player is choosing an
  // action; keep it empty during the opening beats and enemy turns.
  if (els.targetInfo) els.targetInfo.innerHTML = '';
}

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
        if (m.hp.current > 0 && !m.fled && m.id === targetId) unit.classList.add('targeted');
        // Tap a living enemy to make it the target; the info strip below the
        // log then shows what the party knows about it (no popup to dismiss).
        unit.addEventListener('click', () => {
          if (m.hp.current > 0 && !m.fled) { targetId = m.id; renderCombat(els, state, handlers); }
        });
        return unit;
      })
  );
  // keep the heal target valid: default to the most wounded living hero
  const allies = livingHeroes(combat);
  if (!allies.some((h) => h.id === heroTargetId)) {
    heroTargetId = allies.slice().sort((a, b) => a.hp.current / a.hp.max - b.hp.current / b.hp.max)[0]?.id ?? null;
  }
  els.player.replaceChildren(
    ...heroesOf(combat).map((h) => {
      const unit = unitEl(h, 'hero', activeId);
      if (h.hp.current > 0 && h.id === heroTargetId) unit.classList.add('ally-targeted');
      // Tap a living hero to make them the heal target.
      unit.addEventListener('click', () => {
        if (h.hp.current > 0) { heroTargetId = h.id; renderCombat(els, state, handlers); }
      });
      return unit;
    })
  );

  if (els.targetInfo) els.targetInfo.innerHTML = targetInfoHtml(combat);
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
  const pct = Math.max(0, Math.round((100 * c.hp.current) / c.hp.max));
  // No name on the card — tap a unit to inspect it (enemy detail is gated by the
  // party's knowledge roll). Keeps the cards compact for a full party on a phone.
  unit.innerHTML = `
    <div class="hp-num">${c.hp.current}/${c.hp.max}</div>
    ${faceHtml(c, dead)}
    ${c.fled
      ? '<div class="badge-flee">fled!</div>'
      : `<div class="hp-bar"><div class="hp-fill${pct <= 35 ? ' low' : ''}" style="width:${pct}%"></div></div>`}
    ${!dead && !c.fled && c.panicked ? '<div class="badge-panic">panicked!</div>' : ''}`;
  return unit;
}

const ABILITY_LABELS = {
  regenerate: 'regenerates',
  relentless: 'relentless',
  lifedrain: 'drains life',
};

function traitBadges(c) {
  const traits = [
    ...(c.resist ?? []).map((t) => `resists ${t}`),
    ...(c.vulnerable ?? []).map((t) => `fears ${t}`),
    ...(c.ability ? [ABILITY_LABELS[c.ability] ?? c.ability] : []),
  ];
  return traits.length ? `<div class="badge-trait">${traits.join(' · ')}</div>` : '';
}

function faceHtml(c, dead) {
  if (c.kind === 'dragon') {
    return `<div class="combat-sprite sprite f4 flip"><img src="${DRAGON_FLY_STRIP}" alt="${c.name}"></div>`;
  }
  if (c.anim?.idle) {
    // hero side art faces left natively; flip heroes to face the enemy column.
    // enemy art is mirrored by CSS unless it already faces left (facesLeft).
    const cls = c.kind === 'hero' ? ' flip' : c.facesLeft ? ' no-mirror' : '';
    return `<div class="combat-sprite sprite f2${cls}"><img src="${spritePath(c.anim.idle)}" alt="${c.name}"></div>`;
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
// The name to show a foe by — its real name once the party has identified it
// (lore tier >= 1), else a generic label.
function foeName(c, combat) {
  if (!c) return 'enemy';
  if (c.kind !== 'monster') return c.name;
  return (combat.lore?.[c.templateId] ?? 0) >= 1 ? c.name : 'creature';
}

const ABILITY_TEXT = {
  regenerate: 'regenerates',
  relentless: 'shrugs off killing blows',
  lifedrain: 'drains life',
};

// One-line readout of the current target, gated by the party's knowledge roll:
// nothing identified -> "Unknown creature"; identified -> name + AC; a strong
// roll (tier 2) also reveals weaknesses, resistances, and special tricks. Shows
// in a strip by the action buttons so switching targets never opens a popup.
function targetInfoHtml(combat) {
  const t = combat.order.find((u) => u.id === targetId);
  if (!t || t.kind !== 'monster' || t.hp.current <= 0 || t.fled) return '';
  const tier = combat.lore?.[t.templateId] ?? 0;
  if (tier <= 0) return '<span class="ti-name">Unknown creature</span>';
  const parts = [`AC ${t.ac}`];
  if (tier >= 2) {
    if (t.vulnerable?.length) parts.push(`<span class="ti-weak">weak: ${t.vulnerable.join(', ')}</span>`);
    if (t.resist?.length) parts.push(`resists ${t.resist.join(', ')}`);
    if (t.ability && ABILITY_TEXT[t.ability]) parts.push(ABILITY_TEXT[t.ability]);
  }
  return `<span class="ti-name">${t.name}</span> · ${parts.join(' · ')}`;
}

function renderActions(els, combat, handlers, view) {
  if (combat.over || !isPlayerTurn(combat)) {
    const wait = document.createElement('div');
    wait.className = 'turn-note';
    wait.textContent = combat.over ? '' : 'The monsters act…';
    els.actions.replaceChildren(wait);
    return;
  }
  const actor = currentCombatant(combat);

  // "Spell" was chosen: swap the row for the actor's spellbook. A menu (rather
  // than a cramped button label) has room for each spell's blurb and scales as
  // the book grows — later it can group or sort by school.
  if (view === SPELL_MENU) {
    const menu = document.createElement('div');
    menu.className = 'spell-menu';
    // A plain list of names in small buttons — no blurbs (they overran the box
    // on a phone). Back sits at the top so it's reachable without scrolling.
    const back = document.createElement('button');
    back.className = 'btn btn-small spell-back';
    back.textContent = '← Back';
    back.addEventListener('click', () => renderActions(els, combat, handlers, null));
    menu.appendChild(back);
    for (const id of actor.spells) {
      const s = spellById(id);
      const burned = actor.burned.includes(id);
      const btn = document.createElement('button');
      btn.className = 'btn btn-small spell-choice';
      btn.disabled = burned;
      btn.textContent = burned ? `${s.name} · spent` : s.name;
      btn.addEventListener('click', () => castSpell(combat, handlers, s));
      menu.appendChild(btn);
    }
    els.actions.replaceChildren(menu);
    return;
  }

  // Main action row: compact, uniform verbs. Which foe they hit is shown by the
  // ◆ target marker and the info strip, so the labels stay short.
  const target = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
  const row = document.createElement('div');
  row.className = 'action-row';

  if (target) {
    const strike = document.createElement('button');
    strike.className = 'btn act-btn';
    strike.textContent = actor.kind === 'dragon' ? 'Bite' : 'Strike';
    strike.title = `Attack the ${foeName(target, combat)}${target.panicked ? ' — panicked, advantage!' : ''}`;
    if (target.panicked) strike.classList.add('has-edge');
    strike.addEventListener('click', () => handlers.onAttack(target.id));
    row.appendChild(strike);
  }

  // The dragon's breath weapon and a caster's spellbook share the middle slot.
  if (actor.kind === 'dragon' && actor.breath) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn breath-btn';
    btn.textContent = 'Breath';
    if (combat.breathReady) {
      btn.title = `${actor.breath.damage} fire to every enemy — they save vs DC ${actor.breath.dc} for half`;
      btn.addEventListener('click', () => handlers.onBreath());
    } else {
      btn.title = 'Recharging…';
      btn.disabled = true;
    }
    row.appendChild(btn);
  }
  if (actor.spells.length) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn spell-btn';
    btn.textContent = 'Spell';
    btn.addEventListener('click', () => renderActions(els, combat, handlers, SPELL_MENU));
    row.appendChild(btn);
  }

  if (target) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn intimidate-btn';
    btn.textContent = 'Intimidate';
    btn.title = `A CHA check to panic the ${foeName(target, combat)} into fleeing`;
    btn.addEventListener('click', () => handlers.onIntimidate(target.id));
    row.appendChild(btn);
  }

  els.actions.replaceChildren(row);

  if (target && livingMonsters(combat).length > 1) {
    const note = document.createElement('div');
    note.className = 'target-note';
    note.textContent = 'tap an enemy to change target';
    els.actions.appendChild(note);
  }

  // Flee: bail on an unwinnable fight (costs the gold you're carrying). Kept
  // small and set apart so it isn't fat-fingered.
  const flee = document.createElement('button');
  flee.className = 'btn btn-small flee-btn';
  flee.textContent = 'Flee';
  flee.addEventListener('click', () => handlers.onFlee());
  els.actions.appendChild(flee);
}

// Cast straight from the menu: single-target spells use the current target /
// heal target the same way an attack does, so there's no extra targeting step.
function castSpell(combat, handlers, spell) {
  if (spell.target === 'enemy') {
    const t = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
    handlers.onCast(spell.id, t?.id ?? null);
    return;
  }
  const allies = heroesOf(combat);
  if (spell.target === 'all-enemies' || allies.length <= 1) {
    handlers.onCast(spell.id, allies[0]?.id ?? null);
  } else {
    handlers.onCast(spell.id, heroTargetId ?? allies[0]?.id ?? null);
  }
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
