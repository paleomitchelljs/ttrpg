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
import { consumableById } from '../../data/consumables.js';

const DRAGON_FIRE_IMG = './assets/dragon-fire.png';
const DRAGON_IDLE_STRIP = SPRITES['dragon-idle'];
const DRAGON_ATTACK_STRIP = SPRITES['dragon-attack'];

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// sentinel: "Spell" was chosen, so renderActions shows the spellbook submenu
const SPELL_MENU = Symbol('spell-menu');
// sentinel: "Item" was chosen, so renderActions shows the pouch submenu
const ITEM_MENU = Symbol('item-menu');

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
      appendLog(els.log, `Round ${ev.round}`, 'log-dim');
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
            ? `The ${r.name} dives aside; only ${r.damage}! (save ${r.total} vs ${r.dc})`
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
          : ev.recovered
            ? `${ev.caster}'s ${ev.name} gutters, but Arcane Recovery keeps it ready to try again! ${math}`
            : `${ev.caster}'s ${ev.name} fizzles… the spell is lost until you rest. ${math}`,
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
        appendLog(els.log, `Darkness tears at the ${ev.target} for ${ev.damage}, and ${ev.caster} drinks ${ev.drained} of it!`, 'log-hit');
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
      if (card) card.classList.add('heal-flash');
      appendLog(els.log, `The ${ev.who} bends to your will and fights at your side now!${ev.goldValue ? ` (its ${ev.goldValue} gold is yours)` : ''}`, 'log-start');
      await delay(600);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'dominate-resisted':
      appendLog(els.log,
        ev.reason === 'boss' ? `The ${ev.who} is far too strong to bend; your will breaks on it.`
        : ev.reason === 'full' ? `You already command a thrall, so the ${ev.who} slips free.`
        : `The ${ev.who} shakes off your grip.`, 'log-miss');
      return delay(400);
    case 'summoned':
      appendLog(els.log, `${ev.caster} conjures a ${ev.name}; it takes the field at your side!`, 'log-start');
      return delay(500);
    case 'summon-full':
      appendLog(els.log, `${ev.caster} already commands a minion, so the conjuration fizzles.`, 'log-miss');
      return delay(300);
    case 'minion-down':
      appendLog(els.log, `Your ${ev.who} is cut down.`, 'log-hurt');
      return delay(300);
    case 'familiar-dismiss':
      appendLog(els.log, `Your ${ev.who} winks out, giving up its place.`, 'log-dim');
      return delay(300);
    case 'spell-mishap': {
      const card = cardOf(els, ev.casterId);
      if (ev.kind === 'backlash') {
        if (card) { card.classList.add('hit-flash'); updateCardHp(card, ev.hpAfter); }
        appendLog(els.log, `Wild magic lashes back at ${ev.caster} for ${ev.damage}!`, 'log-hurt');
        await delay(400);
        card?.classList.remove('hit-flash');
        return;
      }
      appendLog(els.log, `The backlash leaves ${ev.caster} reeling and dazed!`, 'log-miss');
      return delay(300);
    }
    case 'monster-cast':
      appendLog(els.log, ev.success
        ? `The ${ev.caster} works ${ev.name}! (${ev.total} vs DC ${ev.dc})`
        : `The ${ev.caster}'s ${ev.name} sputters out. (${ev.total} vs DC ${ev.dc})`,
        ev.success ? 'log-start' : 'log-miss');
      return delay(250);
    case 'monster-spell-hit': {
      const card = cardOf(els, ev.targetId);
      if (card) { card.classList.add('hit-flash'); updateCardHp(card, ev.hpAfter); }
      appendLog(els.log, ev.kind === 'drain'
        ? `Dark power drains ${ev.target} for ${ev.damage}!`
        : `Searing force blasts ${ev.target} for ${ev.damage}!`, 'log-hurt');
      await delay(450);
      card?.classList.remove('hit-flash');
      return;
    }
    case 'monster-heal': {
      const card = cardOf(els, ev.targetId);
      if (card) { card.classList.add('heal-flash'); updateCardHp(card, ev.hpAfter); }
      appendLog(els.log, `The ${ev.caster} knits the ${ev.target}'s wounds (+${ev.amount}).`, 'log-start');
      await delay(400);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'monster-daze':
      appendLog(els.log, `The ${ev.caster} fixes ${ev.target} with a baleful stare, dazing them!`, 'log-miss');
      return delay(300);
    case 'luck-offer':
      appendLog(els.log, `${ev.actor} has a luck token. Reroll?`, 'log-dim');
      return delay(150);
    case 'luck-spent':
      appendLog(els.log, `${ev.actor} cashes in a luck token for a second chance!`, 'log-start');
      return delay(350);
    case 'spell-recovered':
      appendLog(els.log, `${ev.caster}'s Arcane Recovery keeps ${ev.spellId ? 'the spell' : 'it'} ready to try again.`, 'log-start');
      return delay(250);
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
          r.saved ? `The ${r.name} ducks; only ${r.damage}!` : `The ${r.name} burns for ${r.damage}!`,
          r.saved ? 'log-miss' : 'log-hit'
        );
        await delay(160);
      }
      await delay(300);
      for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
      return;
    }
    case 'item-use':
      appendLog(els.log, `${ev.actor} reaches for ${ev.name}.`, 'log-start');
      return delay(220);
    case 'item-heal': {
      const card = cardOf(els, ev.targetId);
      if (card) { card.classList.add('heal-flash'); card.classList.remove('down'); updateCardHp(card, ev.hpAfter); }
      appendLog(els.log, ev.revived ? `${ev.target} staggers back up with ${ev.amount} HP!` : `${ev.target} drinks it down for ${ev.amount} HP!`, 'log-hit');
      await delay(500); card?.classList.remove('heal-flash');
      return;
    }
    case 'item-ward': {
      const card = cardOf(els, ev.targetId);
      if (card) card.classList.add('heal-flash');
      appendLog(els.log, `A ward wreathes ${ev.target}, soaking the next ${ev.amount} damage.`, 'log-start');
      await delay(450); card?.classList.remove('heal-flash');
      return;
    }
    case 'item-restore':
      appendLog(els.log, ev.count > 0
        ? `${ev.target}'s mind clears; ${ev.count} spent spell${ev.count > 1 ? 's' : ''} ready again!`
        : `${ev.target} had nothing spent to recover.`, ev.count > 0 ? 'log-hit' : 'log-miss');
      return delay(350);
    case 'item-hit': {
      const card = cardOf(els, ev.targetId);
      if (card) { card.classList.add('hit-flash'); updateCardHp(card, ev.hpAfter); }
      appendLog(els.log, `The flask shatters on the ${ev.target} for ${ev.damage} ${ev.dtype} damage!`, 'log-hit');
      await delay(450); card?.classList.remove('hit-flash');
      return;
    }
    case 'item-wave': {
      appendLog(els.log, `The flask bursts over the whole pack!${ev.dc ? ` (${ev.total}, save DC ${ev.dc})` : ''}`, 'log-start');
      for (const r of ev.results) {
        const card = cardOf(els, r.id);
        if (card) { card.classList.add('hit-flash'); updateCardHp(card, r.hpAfter); }
        appendLog(els.log, r.saved ? `The ${r.name} twists aside; only ${r.damage}!` : `The ${r.name} is seared for ${r.damage}!`, r.saved ? 'log-miss' : 'log-hit');
        await delay(160);
      }
      await delay(300);
      for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
      return;
    }
    case 'ward':
      appendLog(els.log, `The ward absorbs ${ev.soaked}${ev.tempLeft > 0 ? ` (${ev.tempLeft} left)` : ', and shatters'}.`, 'log-miss');
      return delay(200);
    case 'condition-applied': {
      const card = cardOf(els, ev.targetId);
      const good = ev.cond === 'warded';
      if (card) card.classList.add(good ? 'heal-flash' : 'hit-flash');
      appendLog(els.log,
        good ? `${ev.target} is warded, harder to hit for a while.`
        : ev.cond === 'greased' ? `The ${ev.target} loses its footing on the grease, off-balance!`
        : ev.cond === 'burning' ? `The ${ev.target} is set alight!`
        : `${ev.target} is afflicted.`, good ? 'log-hit' : 'log-start');
      await delay(320); card?.classList.remove('heal-flash', 'hit-flash');
      return;
    }
    case 'condition-dot': {
      const card = cardOf(els, ev.id);
      if (card) { card.classList.add('hit-flash'); updateCardHp(card, ev.hpAfter); }
      appendLog(els.log, `The ${ev.who} burns for ${ev.amount}!`, 'log-hit');
      await delay(300); card?.classList.remove('hit-flash');
      return;
    }
    case 'condition-end':
      return; // expiry is silent
    case 'sweep': {
      appendLog(els.log, `${ev.actor} sweeps through the enemies!`, 'log-start');
      for (const r of ev.results) {
        const card = cardOf(els, r.id);
        if (card && r.hit) {
          card.classList.add('hit-flash');
          updateCardHp(card, r.hpAfter);
        }
        appendLog(
          els.log,
          r.hit ? `The ${r.name} is cut for ${r.damage}!` : `The ${r.name} slips the blow.`,
          r.hit ? 'log-hit' : 'log-miss'
        );
        await delay(140);
      }
      await delay(250);
      for (const card of els.enemies.querySelectorAll('.hit-flash')) card.classList.remove('hit-flash');
      return;
    }
    case 'resist': {
      appendLog(els.log, `The ${ev.who} shrugs off half the ${ev.dtype === 'fire' ? 'flame' : 'blow'}!`, 'log-miss');
      return delay(250);
    }
    case 'vulnerable': {
      appendLog(els.log, `The ${ev.who} ${ev.dtype === 'fire' ? 'goes up like kindling' : 'takes it hard'}, double damage!`, 'log-hit');
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
      appendLog(els.log, `The ${ev.who} drinks the wound and heals ${ev.amount}!`, 'log-hurt');
      await delay(350);
      card?.classList.remove('heal-flash');
      return;
    }
    case 'parley': {
      const verb = { threaten: 'growls a threat', persuade: 'talks fast', barter: 'offers a trade', work: 'asks for work' }[ev.mode] ?? 'parleys';
      appendLog(
        els.log,
        ev.success
          ? `${ev.actor} ${verb}, and they listen! (${ev.total} vs DC ${ev.dc})`
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
          ? 'A deal is struck; they withdraw with their price.'
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
      appendLog(els.log, `Bounty fulfilled! ${ev.target} is slain! ${ev.reward} gold, and word of your deed spreads.`, 'log-start');
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
        appendLog(els.log, `The ${ev.target} is fearless; threats roll off it.`, 'log-miss');
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
      appendLog(els.log, 'You break off and flee the fight; the gold you carried scatters behind you!', 'log-hurt');
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
      appendLog(els.log, `Among the spoils: ${ev.name}: ${ev.blurb}. Equip it from a character sheet!`, 'log-start');
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
  // Faction-based: a dominated foe keeps kind 'monster' but fights on our side.
  const heroSide = ev.attackerSide != null ? ev.attackerSide !== 'foe' : ev.attackerKind !== 'monster';
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
    spriteBox.classList.remove('f2', 'f4');
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
    img.src = DRAGON_IDLE_STRIP;
    spriteBox.classList.remove('static', 'f4');
    spriteBox.classList.add('f2');
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
  const verb = ev.attackerKind === 'dragon' ? 'bites' : 'strikes';
  return {
    title: `${ev.attacker} ${verb} the ${ev.target}!`,
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
        ${p.mode === 'advantage' ? '<div class="dice-mode">▲ advantage, keep the best</div>' : ''}
        ${p.mode === 'disadvantage' ? '<div class="dice-mode">▼ disadvantage, keep the worst</div>' : ''}
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
    ...combat.order.filter((c) => c.side === 'foe').map((m) => unitEl(m, 'enemy', null))
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
      .filter((c) => c.side === 'foe')
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
      if (h.inert) return unit; // familiars can't be healed or targeted
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
    c.inert ? 'inert familiar' : '',
    side === 'enemy' && dead ? 'dead' : '',
    side === 'hero' && dead ? 'down' : '',
    c.fled ? 'fled' : '',
    c.id === activeId ? 'active' : '',
  ].filter(Boolean).join(' ');
  unit.dataset.id = c.id;
  // A familiar is a passive companion sprite — no HP, no turn, no targeting.
  if (c.inert) {
    unit.innerHTML = `${faceHtml(c, false)}<div class="familiar-tag">✦ ${c.name}</div>`;
    return unit;
  }
  unit.dataset.hpmax = c.hp.max;
  if (c.kind === 'dragon') {
    unit.dataset.idle = DRAGON_IDLE_STRIP;
    unit.dataset.attack = DRAGON_ATTACK_STRIP;
  } else if (c.anim) {
    unit.dataset.idle = spritePath(c.anim.idle);
    unit.dataset.attack = spritePath(c.anim.attack);
  }
  const pct = Math.max(0, Math.round((100 * c.hp.current) / c.hp.max));
  // No name on the card — tap a unit to inspect it (enemy detail is gated by the
  // party's knowledge roll). Keeps the cards compact for a full party on a phone.
  unit.innerHTML = `
    <div class="hp-num">${c.hp.current}/${c.hp.max}</div>
    ${!dead && c.luck > 0 ? '<span class="badge-luck luck-emblem" title="a luck token: spend it to reroll a failed roll"></span>' : ''}
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
    return `<div class="combat-sprite sprite f2 flip"><img src="${DRAGON_IDLE_STRIP}" alt="${c.name}"></div>`;
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

  // A failed roll is waiting on a luck choice: show only Reroll / Keep.
  if (combat.pendingLuck) {
    const row = document.createElement('div');
    row.className = 'action-row luck-prompt';
    const reroll = document.createElement('button');
    reroll.className = 'btn act-btn luck-btn has-edge';
    reroll.innerHTML = '<span class="luck-emblem"></span>Reroll';
    reroll.title = `Spend ${actor.name}'s luck token to reroll (you keep the new result)`;
    reroll.addEventListener('click', () => handlers.onLuck());
    const keep = document.createElement('button');
    keep.className = 'btn act-btn';
    keep.textContent = 'Keep it';
    keep.title = 'Let the roll stand';
    keep.addEventListener('click', () => handlers.onDeclineLuck());
    row.append(reroll, keep);
    els.actions.replaceChildren(row);
    return;
  }

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

  // "Item" was chosen: the shared party pouch, grouped by kind with a count.
  if (view === ITEM_MENU) {
    const menu = document.createElement('div');
    menu.className = 'spell-menu';
    const back = document.createElement('button');
    back.className = 'btn btn-small spell-back';
    back.textContent = '← Back';
    back.addEventListener('click', () => renderActions(els, combat, handlers, null));
    menu.appendChild(back);
    const counts = {};
    for (const id of combat.consumables ?? []) counts[id] = (counts[id] ?? 0) + 1;
    for (const [id, n] of Object.entries(counts)) {
      const c = consumableById(id);
      if (!c) continue;
      const btn = document.createElement('button');
      btn.className = 'btn btn-small spell-choice';
      btn.textContent = `${c.name} ×${n}`;
      btn.title = c.blurb;
      btn.addEventListener('click', () => useConsumable(combat, handlers, c));
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
    strike.title = `Attack the ${foeName(target, combat)}${target.panicked ? ' (panicked, advantage!)' : ''}`;
    if (target.panicked) strike.classList.add('has-edge');
    strike.addEventListener('click', () => handlers.onAttack(target.id));
    row.appendChild(strike);
  }

  // Cleave (talent): a Sweep hitting every foe.
  if (target && actor.talents?.includes('cleave')) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn sweep-btn';
    btn.textContent = 'Sweep';
    btn.title = 'Strike every enemy for half your weapon damage';
    btn.addEventListener('click', () => handlers.onSweep());
    row.appendChild(btn);
  }

  // The dragon's breath weapon and a caster's spellbook share the middle slot.
  if (actor.kind === 'dragon' && actor.breath) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn breath-btn';
    btn.textContent = 'Breath';
    if (combat.breathReady) {
      btn.title = `${actor.breath.damage} fire to every enemy; they save vs DC ${actor.breath.dc} for half`;
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

  if (combat.consumables?.length) {
    const btn = document.createElement('button');
    btn.className = 'btn act-btn item-btn';
    btn.textContent = 'Item';
    btn.title = 'Use a potion or flask from the pouch';
    btn.addEventListener('click', () => renderActions(els, combat, handlers, ITEM_MENU));
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

// Use a consumable with the same targeting shorthand as attacks/casts: an
// offensive flask hits the current ◆ target; a potion goes to the highlighted
// ally (or the user). self / all-enemies resolve their own target in the engine.
function useConsumable(combat, handlers, c) {
  const t = c.use.target;
  if (t === 'enemy') {
    const foe = livingMonsters(combat).find((m) => m.id === targetId) ?? livingMonsters(combat)[0];
    handlers.onUseItem(c.id, foe?.id ?? null);
    return;
  }
  if (t === 'ally') {
    const allies = heroesOf(combat);
    handlers.onUseItem(c.id, heroTargetId ?? allies[0]?.id ?? null);
    return;
  }
  handlers.onUseItem(c.id, null);
}

function appendLog(logEl, text, cls = '') {
  const p = document.createElement('p');
  p.textContent = text;
  if (cls) p.className = cls;
  logEl.appendChild(p);
  while (logEl.children.length > 60) logEl.removeChild(logEl.firstChild);
  logEl.scrollTop = logEl.scrollHeight;
}
