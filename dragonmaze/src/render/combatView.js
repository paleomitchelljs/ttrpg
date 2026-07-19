// Combat overlay: enemy cards with HP bars, the dragon's HP bar, a big d20
// readout, a plain-language scrolling log, and one big button per living
// target. Reads combat state; raises intents through the onAttack callback.

import { livingMonsters, dragonOf, isPlayerTurn } from '../engine/combat.js';

export function renderCombat(els, state, onAttack) {
  const combat = state.run?.combat?.combat;
  if (!combat) return;
  const dragon = dragonOf(combat);

  // enemy cards
  els.enemies.replaceChildren(
    ...combat.order
      .filter((c) => c.kind !== 'dragon')
      .map((m) => {
        const card = document.createElement('div');
        card.className = 'enemy-card' + (m.hp.current <= 0 ? ' dead' : '');
        card.innerHTML = `
          <div class="enemy-face">${m.hp.current <= 0 ? '☠️' : m.emoji}</div>
          <div class="enemy-name">${m.name}</div>
          ${hpBar(m)}`;
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
      btn.textContent = `🦷 Bite the ${m.name}!`;
      btn.addEventListener('click', () => onAttack(m.id));
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

/** Append narrated combat events to the log; returns text of the last d20. */
export function narrateCombatEvents(els, events) {
  for (const ev of events) {
    const line = eventLine(ev);
    if (line) appendLog(els.log, line.text, line.cls);
    if (ev.type === 'attack') {
      els.die.textContent = `🎲 ${ev.natural}`;
      els.die.className = 'big-die' + (ev.crit ? ' crit' : ev.fumble ? ' fumble' : '');
    }
  }
  els.log.scrollTop = els.log.scrollHeight;
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
      const dice = `(${ev.natural}${ev.toHit >= 0 ? '+' : ''}${ev.toHit} vs AC ${ev.targetAc})`;
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
    case 'death':
      return { text: `The ${ev.who} is defeated! (worth ${ev.goldValue} gold)`, cls: 'log-hit' };
    case 'victory':
      return { text: `Victory! You snatch up ${ev.gold} gold. 💰`, cls: 'log-start' };
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
