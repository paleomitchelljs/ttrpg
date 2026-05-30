// The play view for an active text adventure: party HUD, scrolling transcript,
// tappable action chips, and a typed command line. All game logic lives in the
// engine; this component only renders state and forwards commands.

import { useEffect, useRef, useState } from 'react';
import { useArtUrl } from '../../lib/hooks';
import {
  activeMember,
  currentRoom,
  exitLabel,
  livingEnemies,
  roomItems,
} from '../../lib/adventure/engine';
import type { Adventure, GameState, PartyMemberState } from '../../lib/adventure/types';

interface Props {
  adventure: Adventure;
  state: GameState;
  onCommand: (cmd: string) => void;
  onExit: () => void;
  onFinish: () => void;
}

export function AdventurePlayer({ adventure, state, onCommand, onExit, onFinish }: Props) {
  const [input, setInput] = useState('');
  const [showMap, setShowMap] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const room = currentRoom(state, adventure);
  const inCombat = state.mode === 'combat';
  const over = state.mode === 'over';
  const enemies = livingEnemies(state);
  const items = roomItems(state, room);
  const active = activeMember(state);
  const REASON_TAGS = new Set([
    'humanoid', 'goblinoid', 'gnoll', 'kobold', 'leader', 'boss', 'named-character',
    'hero', 'caster', 'fiend', 'druid', 'wizard', 'fighter', 'dragon', 'vampire',
  ]);
  const canNegotiate = !!room.encounter?.parley || enemies.some((e) => e.tags.some((t) => REASON_TAGS.has(t)));

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [state.transcript.length]);

  useEffect(() => {
    if (!showMap) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowMap(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showMap]);

  function submit() {
    const cmd = input.trim();
    if (!cmd) return;
    onCommand(cmd);
    setInput('');
  }

  function chip(label: string, cmd: string, extraClass = '') {
    return (
      <button key={`${label}:${cmd}`} className={`adv-chip ${extraClass}`} onClick={() => onCommand(cmd)}>
        {label}
      </button>
    );
  }

  return (
    <div className="col adv-play" style={{ gap: '0.9rem' }}>
      <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <div className="col grow" style={{ gap: 0 }}>
          <div className="big-label">{room.name}</div>
          <div className="muted" style={{ fontSize: '0.8rem' }}>
            {adventure.title} · {inCombat ? `Combat — round ${state.combat?.round ?? 1}` : over ? 'Finished' : 'Exploring'}
          </div>
        </div>
        {adventure.mapImage && (
          <button className="ghost" onClick={() => setShowMap(true)}>Map</button>
        )}
        <button className="ghost" onClick={onExit}>Save &amp; exit</button>
      </div>

      <div className="adv-party-hud">
        {state.party.map((m, i) => (
          <MemberChip
            key={m.id}
            member={m}
            active={inCombat && i === state.activeIndex}
            onClick={() => onCommand(`select ${m.name}`)}
          />
        ))}
      </div>

      <div className="adv-transcript">
        {state.transcript.map((msg) => (
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
                {active ? `${active.name}: attack` : 'Attack'}
              </span>
              {enemies.map((e) =>
                chip(`${e.name} (${e.hp.current}/${e.hp.max})`, `attack ${e.name}`, 'adv-chip-foe'),
              )}
              {canNegotiate && chip('Negotiate', 'negotiate', 'adv-chip-talk')}
              {chip('Flee', 'flee', 'adv-chip-warn')}
              {chip('Look', 'look')}
              {chip('Who', 'who')}
            </>
          ) : (
            <>
              {room.exits.map((ex) => chip(exitLabel(ex), `go ${ex.dir}`, 'adv-chip-exit'))}
              {items.map((it) => chip(`Take ${it.name}`, `take ${it.name}`))}
              {room.npcs.map((n) => chip(`Talk to ${n.name}`, `talk ${n.keywords[0] ?? n.name}`))}
              {chip('Look', 'look')}
              {chip('Search', 'search')}
              {chip('Inventory', 'inventory')}
              {chip('Who', 'who')}
              {(room.safe || (room.encounter?.flag ? state.flags.includes(room.encounter.flag) : !room.encounter)) &&
                !state.rested.includes(room.id) &&
                chip('Rest', 'rest', 'adv-chip-rest')}
            </>
          )}
        </div>
      )}

      {over ? (
        <div className={`card adv-end adv-end-${state.outcome}`}>
          <div className="big-label">{state.outcome === 'win' ? 'Victory!' : 'Defeated'}</div>
          <p className="muted" style={{ margin: '0.4rem 0' }}>
            {state.outcome === 'win'
              ? 'Your party conquered the adventure.'
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
          <button className="primary" onClick={submit}>Send</button>
        </div>
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
