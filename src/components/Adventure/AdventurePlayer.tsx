// The play view for an active dungeon crawl: party HUD, initiative tracker,
// enemy target cards, torch meter, scrolling transcript, tappable action chips,
// and a typed command line. All game logic lives in the engine; this component
// renders state, forwards commands, and — the showpiece — replays each recorded
// die roll as a BG3-style cinematic before revealing what happened.
//
// Reveal queue: engine messages arrive in a batch after each command. Text
// messages reveal immediately, but a message carrying a RollPayload pauses the
// queue while the dice play (full-screen for hero rolls, corner toast for
// enemies). "Fast dice" skips all theatrics.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useArtUrl } from '../../lib/hooks';
import { getSpell } from '../../lib/shadowdark/spells';
import {
  activeMember,
  currentRoom,
  exitLabel,
  inDarkness,
  livingEnemies,
  parleyOdds,
  roomItems,
  TORCH_LIFE,
} from '../../lib/adventure/engine';
import type {
  Adventure,
  EnemyState,
  GameMessage,
  GameState,
  PartyMemberState,
  TurnRef,
} from '../../lib/adventure/types';
import { DiceCinematic, RollToast } from '../Dice/DiceOverlay';

interface Props {
  adventure: Adventure;
  state: GameState;
  onCommand: (cmd: string) => void;
  onExit: () => void;
  onFinish: () => void;
}

const FAST_DICE_KEY = 'adv-fast-dice';

export function AdventurePlayer({ adventure, state, onCommand, onExit, onFinish }: Props) {
  const [input, setInput] = useState('');
  const [showMap, setShowMap] = useState(false);
  const [spell, setSpell] = useState('');
  const [fastDice, setFastDice] = useState(() => localStorage.getItem(FAST_DICE_KEY) === '1');
  const endRef = useRef<HTMLDivElement>(null);

  // ── reveal queue ──
  const lastId = state.transcript.length ? state.transcript[state.transcript.length - 1].id : 0;
  const [revealSeq, setRevealSeq] = useState(lastId); // resume shows history instantly
  const [pendingRoll, setPendingRoll] = useState<GameMessage | null>(null);

  useEffect(() => {
    if (pendingRoll) return;
    const queued = state.transcript.filter((m) => m.id > revealSeq);
    if (!queued.length) return;
    if (fastDice) {
      setRevealSeq(lastId);
      return;
    }
    const rollIdx = queued.findIndex((m) => m.roll);
    if (rollIdx === -1) {
      setRevealSeq(queued[queued.length - 1].id);
    } else if (rollIdx > 0) {
      setRevealSeq(queued[rollIdx - 1].id);
    } else {
      setPendingRoll(queued[0]);
    }
  }, [state.transcript, revealSeq, pendingRoll, fastDice, lastId]);

  const onRollDone = useCallback(() => {
    setPendingRoll((msg) => {
      if (msg) setRevealSeq(msg.id);
      return null;
    });
  }, []);

  const visible = useMemo(
    () => state.transcript.filter((m) => m.id <= revealSeq),
    [state.transcript, revealSeq],
  );
  const busy = pendingRoll !== null || revealSeq < lastId;

  // While dice are still playing, the HUD keeps showing the world as it was
  // before the command — otherwise a foe's card would vanish (or the victory
  // banner appear) before the die that did it even lands.
  const hudRef = useRef(state);
  if (!busy) hudRef.current = state;
  const hud = hudRef.current;

  const room = currentRoom(hud, adventure);
  const inCombat = hud.mode === 'combat';
  const over = hud.mode === 'over';
  const enemies = livingEnemies(hud);
  const items = roomItems(hud, room);
  const active = activeMember(hud);
  const light = hud.light ?? { lit: 0, spares: 0 };
  const dark = inDarkness(hud);

  // The active caster's still-castable spells, grouped by level for the dropdown.
  const castable = active ? active.spells.filter((sp) => !active.spentSpells.includes(sp)) : [];
  const spellsByLevel = (() => {
    const m = new Map<number, string[]>();
    for (const name of castable) {
      const tier = getSpell(name)?.tier ?? 1;
      if (!m.has(tier)) m.set(tier, []);
      m.get(tier)!.push(name);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  })();
  // Live parley forecast: whether anyone will talk, and the roll the legwork buys.
  const odds = inCombat ? parleyOdds(hud, adventure) : null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [visible.length]);

  useEffect(() => {
    if (!showMap) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowMap(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMap]);

  // Clear the spell selection when the active caster changes or combat ends.
  useEffect(() => {
    setSpell('');
  }, [hud.activeIndex, hud.mode]);

  function toggleFastDice() {
    setFastDice((f) => {
      localStorage.setItem(FAST_DICE_KEY, f ? '0' : '1');
      return !f;
    });
  }

  function run(cmd: string) {
    if (busy) return;
    onCommand(cmd);
  }

  function submit() {
    const cmd = input.trim();
    if (!cmd || busy) return;
    onCommand(cmd);
    setInput('');
  }

  function chip(label: string, cmd: string, extraClass = '') {
    return (
      <button key={`${label}:${cmd}`} className={`adv-chip ${extraClass}`} disabled={busy} onClick={() => run(cmd)}>
        {label}
      </button>
    );
  }

  const showLightChip = light.spares > 0 && light.lit <= TORCH_LIFE / 2;

  return (
    <div className="col adv-play" style={{ gap: '0.9rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div className="col grow" style={{ gap: 0 }}>
          <div className="big-label">{room.name}</div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {adventure.title} · {inCombat ? `Combat — round ${hud.combat?.round ?? 1}` : over ? 'Finished' : 'Exploring'}
            {hud.powerLevel > 1 ? ` · scaled to L${hud.powerLevel}` : ""}
          </div>
        </div>
        <TorchMeter lit={light.lit} spares={light.spares} />
        <button
          className={`ghost adv-dice-toggle ${fastDice ? '' : 'on'}`}
          onClick={toggleFastDice}
          title={fastDice ? 'Dice animations are off' : 'Dice animations are on'}
        >
          {fastDice ? '🎲 fast' : '🎲 cinematic'}
        </button>
        {adventure.mapImage && (
          <button className="ghost" onClick={() => setShowMap(true)}>Map</button>
        )}
        <button className="ghost" onClick={onExit}>Save &amp; exit</button>
      </div>

      <div className="adv-party-hud">
        {hud.party.map((m, i) => (
          <MemberChip
            key={m.id}
            member={m}
            active={inCombat && i === hud.activeIndex}
            onClick={() => run(`select ${m.name}`)}
          />
        ))}
      </div>

      {inCombat && hud.combat?.order?.length ? (
        <InitiativeTracker state={hud} />
      ) : null}

      {inCombat && enemies.length > 0 && (
        <div className="adv-foe-grid">
          {enemies.map((e) => (
            <FoeCard key={e.id} enemy={e} disabled={busy} onClick={() => run(`attack ${e.name}`)} />
          ))}
        </div>
      )}

      <div className={`adv-transcript ${dark ? 'dark' : ''}`}>
        {visible.map((msg) => (
          <p key={msg.id} className={`adv-line adv-${msg.kind}`}>
            {msg.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>

      {!over && (
        <div className="adv-actions">
          {inCombat ? (
            <>
              <span className="adv-action-label">
                {active ? `${active.name}'s turn` : 'Attack'}
              </span>
              {castable.length > 0 && (
                <span className="adv-spellcast">
                  <select aria-label="Choose a spell to cast" value={spell} onChange={(e) => setSpell(e.target.value)}>
                    <option value="">Cast a spell…</option>
                    {spellsByLevel.map(([tier, names]) => (
                      <optgroup key={tier} label={`Level ${tier}`}>
                        {names.map((n) => (
                          <option key={n} value={n}>{n}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="adv-chip adv-chip-spell"
                    disabled={!spell || busy}
                    onClick={() => {
                      if (!spell) return;
                      run(`cast ${spell}`);
                      setSpell('');
                    }}
                  >
                    Cast
                  </button>
                </span>
              )}
              {odds && (
                <span className="adv-parley">
                  {chip(
                    odds.gatedBy ? 'Negotiate' : odds.needs >= 21 ? 'Negotiate (nat 20)' : `Negotiate (${odds.needs}+)`,
                    'negotiate',
                    'adv-chip-talk',
                  )}
                  <span className="adv-parley-odds">
                    {odds.gatedBy
                      ? "they won't hear you yet"
                      : `1d20 + ${odds.total} vs ${odds.dc}${
                          odds.mods.length ? ` — ${odds.mods.map((m) => `${m.label} +${m.bonus}`).join(', ')}` : ''
                        }`}
                  </span>
                </span>
              )}
              {showLightChip && chip(`Light torch (${light.spares})`, 'light torch', 'adv-chip-torch')}
              {chip('Flee', 'flee', 'adv-chip-warn')}
              {chip('Look', 'look')}
            </>
          ) : (
            <>
              {room.exits.map((ex) => chip(exitLabel(ex), `go ${ex.dir}`, 'adv-chip-exit'))}
              {items.map((it) => chip(`Take ${it.name}`, `take ${it.name}`))}
              {room.npcs.map((n) => chip(`Talk to ${n.name}`, `talk ${n.keywords[0] ?? n.name}`))}
              {showLightChip && chip(`Light torch (${light.spares})`, 'light torch', 'adv-chip-torch')}
              {chip('Look', 'look')}
              {chip('Search', 'search')}
              {chip('Inventory', 'inventory')}
              {chip('Who', 'who')}
              {(room.safe || (room.encounter?.flag ? hud.flags.includes(room.encounter.flag) : !room.encounter)) &&
                !hud.rested.includes(room.id) &&
                chip('Rest', 'rest', 'adv-chip-rest')}
            </>
          )}
        </div>
      )}

      {over ? (
        <div className={`card adv-end adv-end-${hud.outcome}`}>
          <div className="big-label">{hud.outcome === "win" ? "Victory!" : "Defeated"}</div>
          <p className="muted" style={{ margin: '0.4rem 0' }}>
            {hud.outcome === "win"
              ? 'Quest complete! Your heroes march out with the loot and the glory.'
              : 'Your party fell — but your saved heroes are unharmed.'}
          </p>
          <button className="primary" onClick={onFinish}>Return to portal</button>
        </div>
      ) : (
        <div className="adv-cmdbar">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            placeholder={inCombat ? 'e.g. attack goblin' : 'e.g. go north, examine throne, take ring'}
            aria-label="Command"
            autoFocus
          />
          <button className="primary" onClick={submit} disabled={busy}>Send</button>
        </div>
      )}

      {pendingRoll?.roll && (
        pendingRoll.roll.side === 'hero' ? (
          <DiceCinematic payload={pendingRoll.roll} onDone={onRollDone} />
        ) : (
          <RollToast payload={pendingRoll.roll} onDone={onRollDone} />
        )
      )}

      {showMap && adventure.mapImage && (
        <div
          className="map-overlay"
          onClick={() => setShowMap(false)}
          role="dialog"
          aria-modal="true"
          aria-label={`${adventure.title} map`}
        >
          <div className="map-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <div className="map-overlay-header">
              <div className="big-label">{adventure.title} — map</div>
              <button onClick={() => setShowMap(false)} aria-label="Close map">✕</button>
            </div>
            <img
              className="map-overlay-img"
              src={`${import.meta.env.BASE_URL}${adventure.mapImage}`}
              alt={`${adventure.title} map`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ───────── HUD pieces ─────────

function TorchMeter({ lit, spares }: { lit: number; spares: number }) {
  const pct = Math.max(0, Math.min(100, Math.round((lit / TORCH_LIFE) * 100)));
  const dark = lit <= 0;
  const low = !dark && lit <= 4;
  return (
    <div className={`torch-meter ${dark ? 'dark' : low ? 'low' : ''}`} title={dark ? 'Darkness!' : `Torch: ${lit}/${TORCH_LIFE}`}>
      <span className="torch-flame">{dark ? '🌑' : '🔥'}</span>
      <span className="torch-bar">
        <span className="torch-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="torch-spares">{dark ? 'DARK' : `×${spares}`}</span>
    </div>
  );
}

function InitiativeTracker({ state }: { state: GameState }) {
  const combat = state.combat!;
  const heroById = new Map(state.party.map((m) => [m.id, m]));
  const foeById = new Map(combat.enemies.map((e) => [e.id, e]));
  return (
    <div className="init-tracker" aria-label="Initiative order">
      <span className="init-label">Round {combat.round}</span>
      {combat.order.map((t, i) => {
        const hero = t.side === 'hero' ? heroById.get(t.refId) : undefined;
        const foe = t.side === 'enemy' ? foeById.get(t.refId) : undefined;
        const hp = hero?.hp ?? foe?.hp;
        return (
          <InitChip
            key={`${t.side}:${t.refId}`}
            turn={t}
            hero={hero}
            foe={foe}
            now={i === combat.turnIndex}
            dead={(hp?.current ?? 0) <= 0}
          />
        );
      })}
    </div>
  );
}

function InitChip({
  turn,
  hero,
  foe,
  now,
  dead,
}: {
  turn: TurnRef;
  hero?: PartyMemberState;
  foe?: EnemyState;
  now: boolean;
  dead: boolean;
}) {
  const portraitUrl = useArtUrl(hero?.portraitArtId);
  const iconUrl = foe?.icon ? `${import.meta.env.BASE_URL}${foe.icon}` : undefined;
  const faceUrl = portraitUrl ?? iconUrl;
  return (
    <span className={`init-chip ${turn.side} ${now ? 'now' : ''} ${dead ? 'dead' : ''}`}>
      {faceUrl ? (
        <img className="init-face" src={faceUrl} alt="" />
      ) : (
        <span className="init-face init-face-fallback">{turn.name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="init-num">{turn.init}</span>
      {turn.name}
    </span>
  );
}

function FoeCard({ enemy, disabled, onClick }: { enemy: EnemyState; disabled: boolean; onClick: () => void }) {
  const pct = Math.max(0, Math.round((enemy.hp.current / Math.max(1, enemy.hp.max)) * 100));
  return (
    <button className="foe-card" disabled={disabled} onClick={onClick} title={`Attack ${enemy.name}`}>
      {enemy.icon ? (
        <img className="foe-icon" src={`${import.meta.env.BASE_URL}${enemy.icon}`} alt="" />
      ) : (
        <span className="foe-icon placeholder">{enemy.name.slice(0, 1).toUpperCase()}</span>
      )}
      <span className="foe-body">
        <span className="foe-name">{enemy.name}</span>
        <span className="foe-hpbar">
          <span className="foe-hpfill" style={{ width: `${pct}%` }} />
        </span>
        <span className="foe-hp">{enemy.hp.current}/{enemy.hp.max} HP</span>
      </span>
      <span className="foe-ac" title={`Armor class ${enemy.ac}`}>🛡 {enemy.ac}</span>
      <span className="foe-attack-hint">⚔</span>
    </button>
  );
}

function MemberChip({
  member,
  active,
  onClick,
}: {
  member: PartyMemberState;
  active: boolean;
  onClick: () => void;
}) {
  const url = useArtUrl(member.portraitArtId);
  const down = member.hp.current <= 0;
  const pct = Math.max(0, Math.round((member.hp.current / Math.max(1, member.hp.max)) * 100));
  return (
    <button
      className={`adv-member ${active ? 'active' : ''} ${down ? 'down' : ''}`}
      onClick={onClick}
      title={`${member.name} — AC ${member.ac}, ${member.weaponName}`}
    >
      {url ? (
        <img src={url} alt={member.name} className="adv-member-portrait" />
      ) : (
        <div className="adv-member-portrait placeholder">{member.name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="adv-member-name">{member.name}</div>
      <div className="adv-member-hpbar">
        <div className="adv-member-hpfill" style={{ width: `${pct}%` }} />
      </div>
      <div className="adv-member-hp">{down ? 'DOWN' : `${member.hp.current}/${member.hp.max}`}</div>
    </button>
  );
}
