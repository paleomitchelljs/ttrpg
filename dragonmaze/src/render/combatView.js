// Combat overlay: enemy cards with HP bars, the dragon's HP bar, a big d20
// readout, a plain-language scrolling log, and one big button per living
// target plus the fire-breath button. Reads combat state; raises intents
// through the onAttack/onBreath callbacks.

import { livingMonsters, dragonOf, isPlayerTurn } from '../engine/combat.js';

export function renderCombat(els, state, { onAttack, onBreath }) {
  const combat = state.run?.combat?.combat;
  if (!combat) return;
  const dragon = dragonOf(combat);

  // enemy cards
  els.enemies.replaceChildren(
    ...combat.order
      .filter((c) => c.kind !== 'dragon')
      .map((m) => {
        const dead = m.hp.current <= 0;
        const card = document.createElement('div');
        card.className = 'enemy-card' + (dead ? ' dead' : '') + (m.fled ? ' fled' : '');
        card.innerHTML = `
          <div class="enemy-face">${dead ? '☠️' : m.fled ? '💨' : m.emoji}</div>
          <div class="enemy-name">${m.name}</div>
          ${m.fled ? '<div class="badge-flee">fled!</div>' : hpBar(m)}
          ${!dead && !m.fled && m.panicked ? '<div class="badge-panic">😱 panicked!</div>' : ''}`;
        return card;
      })
  );

  // dragon status
  els.player.innerHTML = `
    <div class="player-face">🐉</div>
    <div class="player-name">Your Dragon</div>
    ${hpBar(dragon)}`;

  // action buttons
  const buttons = [];
  if (!combat.over && isPlayerTurn(combat)) {
    for (const m of livingMonsters(combat)) {
      const btn = document.createElement('button');
      btn.className = 'btn attack-btn';
      btn.textContent = `🦷 Bite the ${m.name}!${m.panicked ? ' ⭐' : ''}`;
      if (m.panicked) btn.title = 'Panicked prey — you attack with advantage!';
      btn.addEventListener('click', () => onAttack(m.id));
      buttons.push(btn);
    }
    if (dragon.breath) {
      const btn = document.createElement('button');
      btn.className = 'btn attack-btn breath-btn';
      if (combat.breathReady) {
        btn.textContent = '🔥 Fire Breath!';
        btn.title = `${dragon.breath.damage} fire damage to every enemy — they save vs DC ${dragon.breath.dc} for half`;
        btn.addEventListener('click', () => onBreath());
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

function hpBar(c) {
  const pct = Math.max(0, Math.round((100 * c.hp.current) / c.hp.max));
  return `
    <div class="hp-bar"><div class="hp-fill${pct <= 35 ? ' low' : ''}" style="width:${pct}%"></div></div>
    <div class="hp-num">${c.hp.current} / ${c.hp.max} HP</div>`;
}

/** Append narrated combat events to the log and update the big die. */
export function narrateCombatEvents(els, events) {
  for (const ev of events) {
    if (ev.type === 'breath') {
      appendLog(els.log, `You unleash a torrent of flame! (${ev.total} fire damage, save DC ${ev.dc})`, 'log-start');
      for (const r of ev.results) {
        appendLog(
          els.log,
          r.saved
            ? `The ${r.name} dives aside — only ${r.damage}! (save ${r.total} vs ${r.dc})`
            : `The ${r.name} is engulfed for ${r.damage}! (save ${r.total} vs ${r.dc})`,
          r.saved ? 'log-miss' : 'log-hit'
        );
      }
      els.die.textContent = `🔥 ${ev.total}`;
      els.die.className = 'big-die crit';
      continue;
    }
    const line = eventLine(ev);
    if (line) appendLog(els.log, line.text, line.cls);
    if (ev.type === 'attack') {
      els.die.textContent = `🎲 ${ev.natural}`;
      els.die.className = 'big-die' + (ev.crit ? ' crit' : ev.fumble ? ' fumble' : '');
    }
  }
  els.log.scrollTop = els.log.scrollHeight;
}

function diceNote(ev) {
  const bonus = `${ev.toHit >= 0 ? '+' : ''}${ev.toHit}`;
  if (ev.mode === 'advantage') return `(${ev.dieRolls.join('|')} keep ${ev.natural}, ${bonus} vs AC ${ev.targetAc} — advantage!)`;
  if (ev.mode === 'disadvantage') return `(${ev.dieRolls.join('|')} keep ${ev.natural}, ${bonus} vs AC ${ev.targetAc} — disadvantage)`;
  return `(${ev.natural}${bonus} vs AC ${ev.targetAc})`;
}

function eventLine(ev) {
  switch (ev.type) {
    case 'combat-start': {
      const names = ev.monsters.map((m) => `${m.emoji} ${m.name}`).join(', ');
      return { text: `Danger! ${names} block${ev.monsters.length === 1 ? 's' : ''} your path!`, cls: 'log-start' };
    }
    case 'initiative':
      return { text: `Initiative: ${ev.order.map((o) => `${o.name} ${o.initiative}`).join(' · ')}`, cls: 'log-dim' };
    case 'round':
      return { text: `— Round ${ev.round} —`, cls: 'log-dim' };
    case 'attack': {
      const you = ev.attackerKind === 'dragon';
      const dice = diceNote(ev);
      if (ev.crit) {
        return {
          text: you
            ? `CRITICAL! Your bite crunches the ${ev.target} for ${ev.damage}! ${dice}`
            : `CRITICAL! The ${ev.attacker}'s ${ev.attackName} hits you for ${ev.damage}! ${dice}`,
          cls: you ? 'log-hit' : 'log-hurt',
        };
      }
      if (!ev.hit) {
        return {
          text: you
            ? `Your bite misses the ${ev.target}. ${dice}`
            : `The ${ev.attacker}'s ${ev.attackName} misses you. ${dice}`,
          cls: 'log-miss',
        };
      }
      return {
        text: you
          ? `Your bite hits the ${ev.target} for ${ev.damage}! ${dice}`
          : `The ${ev.attacker}'s ${ev.attackName} hits you for ${ev.damage}. ${dice}`,
        cls: you ? 'log-hit' : 'log-hurt',
      };
    }
    case 'morale':
      return ev.pass
        ? { text: `The ${ev.who} grits its teeth and stands firm. (${ev.total} vs ${ev.dc})`, cls: 'log-dim' }
        : { text: `The ${ev.who} panics! 😱 (${ev.total} vs ${ev.dc})`, cls: 'log-start' };
    case 'flee':
      return { text: `The ${ev.who} flees into the dark! 💨`, cls: 'log-miss' };
    case 'recharge':
      return ev.ready
        ? { text: `🔥 Your fire roils back to life!`, cls: 'log-start' }
        : { text: `Your flames sputter… (recharge ${ev.roll}, needs 5+)`, cls: 'log-dim' };
    case 'death':
      return { text: `The ${ev.who} is defeated! (worth ${ev.goldValue} gold)`, cls: 'log-hit' };
    case 'victory':
      return {
        text: `Victory! You snatch up ${ev.gold} gold. 💰${ev.fled ? ' The cowards that fled kept theirs!' : ''}`,
        cls: 'log-start',
      };
    case 'defeat':
      return { text: `You have no strength left…`, cls: 'log-hurt' };
    default:
      return null;
  }
}

function appendLog(logEl, text, cls = '') {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
}

export function clearCombatLog(els) {
  els.log.replaceChildren();
  els.die.textContent = '🎲';
  els.die.className = 'big-die';
}
