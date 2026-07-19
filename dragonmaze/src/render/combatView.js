// Combat presentation. Combat logic resolves instantly in the engine; this
// module replays each event batch dramatically, in order: the dragon's d20s
// get a full-screen BG3-style cinematic (tumbling die, modifier chips, AC
// plate, verdict banner — matching the main portal's DiceOverlay), monster
// rolls play as a compact corner toast, and everything lands in the log.
// While a batch is replaying, the action buttons are locked.

import { livingMonsters, dragonOf, isPlayerTurn } from '../engine/combat.js';
import { spritePath } from './mapView.js';
import { SPRITES } from '../assets-manifest.js';

const DRAGON_FIRE_IMG = './assets/dragon-fire.png';
const DRAGON_FLY_STRIP = SPRITES['dragon-fly'];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- queue
const batches = [];
let processing = false;

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
      els.log.replaceChildren();
      els.overlay.hidden = false;
      const names = ev.monsters.map((m) => `${m.emoji} ${m.name}`).join(', ');
      appendLog(els.log, `Danger! ${names} block${ev.monsters.length === 1 ? 's' : ''} your path!`, 'log-start');
      return delay(400);
    }
    case 'initiative':
      appendLog(els.log, `Initiative: ${ev.order.map((o) => `${o.name} ${o.initiative}`).join(' · ')}`, 'log-dim');
      return delay(300);
    case 'round':
      appendLog(els.log, `— Round ${ev.round} —`, 'log-dim');
      return delay(200);
    case 'attack': {
      if (ev.attackerKind === 'dragon') await playCinematic(bitePayload(ev));
      else await playToast(ev);
      await attackBeat(els, ev);
      const line = attackLine(ev);
      appendLog(els.log, line.text, line.cls);
      return delay(150);
    }
    case 'breath': {
      await playCinematic(breathPayload(ev));
      appendLog(els.log, `You unleash a torrent of flame! (${ev.total} fire damage, save DC ${ev.dc})`, 'log-start');
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
    case 'morale':
      appendLog(
        els.log,
        ev.pass
          ? `The ${ev.who} grits its teeth and stands firm. (${ev.total} vs ${ev.dc})`
          : `The ${ev.who} panics! 😱 (${ev.total} vs ${ev.dc})`,
        ev.pass ? 'log-dim' : 'log-start'
      );
      return delay(350);
    case 'flee': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('fleeing');
      appendLog(els.log, `The ${ev.who} flees into the dark! 💨`, 'log-miss');
      return delay(450);
    }
    case 'recharge':
      appendLog(
        els.log,
        ev.ready ? `🔥 Your fire roils back to life!` : `Your flames sputter… (recharge ${ev.roll}, needs 5+)`,
        ev.ready ? 'log-start' : 'log-dim'
      );
      return delay(250);
    case 'death': {
      const card = cardOf(els, ev.id);
      if (card) card.classList.add('dying');
      appendLog(els.log, `The ${ev.who} is defeated! (worth ${ev.goldValue} gold)`, 'log-hit');
      return delay(500);
    }
    case 'victory':
      appendLog(
        els.log,
        `Victory! You snatch up ${ev.gold} gold. 💰${ev.fled ? ' The cowards that fled kept theirs!' : ''}`,
        'log-start'
      );
      return delay(700);
    case 'defeat':
      appendLog(els.log, `You have no strength left…`, 'log-hurt');
      return delay(600);
    default:
      return;
  }
}

// ---------------------------------------------------------------- beats
// Physical stage business after the dice: the attacker lunges (swapping to
// its attack frames), the victim flashes and its HP bar drops.

function cardOf(els, id) {
  return els.enemies.querySelector(`[data-id="${CSS.escape(id)}"]`);
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
  const dragonAttacks = ev.attackerKind === 'dragon';
  const attacker = dragonAttacks ? els.player : cardOf(els, ev.attackerId);
  const victim = dragonAttacks ? cardOf(els, ev.targetId) : els.player;
  if (attacker) {
    setStrip(attacker, 'attack');
    attacker.classList.add(dragonAttacks ? 'lunge-up' : 'lunge-down');
  }
  await delay(280);
  if (ev.hit && victim) {
    victim.classList.add('hit-flash');
    updateCardHp(victim, ev.targetHpAfter);
  }
  await delay(320);
  if (attacker) {
    attacker.classList.remove('lunge-up', 'lunge-down');
    setStrip(attacker, 'idle');
  }
  victim?.classList.remove('hit-flash');
}

async function breathBeat(els, ev) {
  const img = els.player.querySelector('.combat-sprite img');
  const spriteBox = els.player.querySelector('.combat-sprite');
  if (img) {
    img.src = DRAGON_FIRE_IMG;
    spriteBox.classList.remove('f4');
    spriteBox.classList.add('static');
  }
  els.player.classList.add('breathing');
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
  els.player.classList.remove('breathing');
  for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
  if (img) {
    img.src = DRAGON_FLY_STRIP;
    spriteBox.classList.add('f4');
    spriteBox.classList.remove('static');
  }
}

function attackLine(ev) {
  const you = ev.attackerKind === 'dragon';
  if (ev.crit) {
    return {
      text: you
        ? `CRITICAL! Your bite crunches the ${ev.target} for ${ev.damage}!`
        : `CRITICAL! The ${ev.attacker}'s ${ev.attackName} hits you for ${ev.damage}!`,
      cls: you ? 'log-hit' : 'log-hurt',
    };
  }
  if (!ev.hit) {
    return {
      text: you ? `Your bite misses the ${ev.target}.` : `The ${ev.attacker}'s ${ev.attackName} misses you.`,
      cls: 'log-miss',
    };
  }
  return {
    text: you
      ? `Your bite hits the ${ev.target} for ${ev.damage}!`
      : `The ${ev.attacker}'s ${ev.attackName} hits you for ${ev.damage}.`,
    cls: you ? 'log-hit' : 'log-hurt',
  };
}

// ---------------------------------------------------------------- payloads
function verdictFor(ev) {
  if (ev.crit) return { text: `CRITICAL HIT! ${ev.damage} damage!`, cls: 'crit' };
  if (ev.fumble) return { text: 'FUMBLE!', cls: 'fumble' };
  if (ev.hit) return { text: `HIT! ${ev.damage} damage!`, cls: 'good' };
  return { text: 'MISS', cls: 'bad' };
}

function bitePayload(ev) {
  const verdict = verdictFor(ev);
  return {
    title: `Bite the ${ev.target}!`,
    sides: 20,
    rolls: ev.dieRolls,
    kept: ev.natural,
    mode: ev.mode,
    parts: [{ label: 'bite', value: ev.toHit }],
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
      // advantage keeps only one die of a pair marked dropped
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
      { at: 2750, fn: null }, // done
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
      // fast-forward: settle everything, show verdict, then close on next tap
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
      <div class="roll-toast-title">${ev.attacker} — ${ev.attackName}!</div>
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

// ---------------------------------------------------------------- panel
export function renderCombat(els, state, handlers) {
  const combat = state.run?.combat?.combat;
  if (!combat) return;
  const dragon = dragonOf(combat);

  els.enemies.replaceChildren(
    ...combat.order
      .filter((c) => c.kind !== 'dragon')
      .map((m) => {
        const dead = m.hp.current <= 0;
        const card = document.createElement('div');
        card.className = 'enemy-card' + (dead ? ' dead' : '') + (m.fled ? ' fled' : '');
        card.dataset.id = m.id;
        card.dataset.hpmax = m.hp.max;
        if (m.anim) {
          card.dataset.idle = spritePath(m.anim.idle);
          card.dataset.attack = spritePath(m.anim.attack);
        }
        card.innerHTML = `
          ${faceHtml(m, dead)}
          <div class="enemy-name">${m.name}</div>
          ${m.fled ? '<div class="badge-flee">fled!</div>' : hpBar(m)}
          ${!dead && !m.fled && m.panicked ? '<div class="badge-panic">😱 panicked!</div>' : ''}`;
        return card;
      })
  );

  els.player.dataset.hpmax = dragon.hp.max;
  els.player.dataset.idle = DRAGON_FLY_STRIP;
  els.player.dataset.attack = DRAGON_FLY_STRIP;
  els.player.innerHTML = `
    <div class="combat-sprite sprite f4 player-sprite flip"><img src="${DRAGON_FLY_STRIP}" alt="Your dragon"></div>
    <div class="player-name">Your Dragon</div>
    ${hpBar(dragon)}`;

  const buttons = [];
  if (!combat.over && isPlayerTurn(combat)) {
    for (const m of livingMonsters(combat)) {
      const btn = document.createElement('button');
      btn.className = 'btn attack-btn';
      btn.textContent = `🦷 Bite the ${m.name}!${m.panicked ? ' ⭐' : ''}`;
      if (m.panicked) btn.title = 'Panicked prey — you attack with advantage!';
      btn.addEventListener('click', () => handlers.onAttack(m.id));
      buttons.push(btn);
    }
    if (dragon.breath) {
      const btn = document.createElement('button');
      btn.className = 'btn attack-btn breath-btn';
      if (combat.breathReady) {
        btn.textContent = '🔥 Fire Breath!';
        btn.title = `${dragon.breath.damage} fire damage to every enemy — they save vs DC ${dragon.breath.dc} for half`;
        btn.addEventListener('click', () => handlers.onBreath());
      } else {
        btn.textContent = '🔥 Recharging…';
        btn.disabled = true;
      }
      buttons.push(btn);
    }
  } else if (!combat.over) {
    const wait = document.createElement('div');
    wait.className = 'turn-note';
    wait.textContent = 'The monsters act…';
    buttons.push(wait);
  }
  els.actions.replaceChildren(...buttons);
}

function faceHtml(m, dead) {
  if (m.anim?.idle) {
    return `<div class="combat-sprite sprite f2"><img src="${spritePath(m.anim.idle)}" alt="${m.name}"></div>`;
  }
  return `<div class="enemy-face">${dead ? '☠️' : m.fled ? '💨' : m.emoji}</div>`;
}

function hpBar(c) {
  const pct = Math.max(0, Math.round((100 * c.hp.current) / c.hp.max));
  return `
    <div class="hp-bar"><div class="hp-fill${pct <= 35 ? ' low' : ''}" style="width:${pct}%"></div></div>
    <div class="hp-num">${c.hp.current} / ${c.hp.max} HP</div>`;
}

function appendLog(logEl, text, cls = '') {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
