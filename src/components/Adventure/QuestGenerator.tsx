// Random quest storyboard for VERBAL play: rooms sampled from across every
// authored adventure, monsters pre-converted to Brick Quest hearts and beat
// numbers (see Rules tab). The GM reads it aloud, the Legos are the dungeon,
// and the Dice tab is the only roller. Nothing here touches the text engine.

import { useState } from 'react';
import {
  generateQuest,
  loadQuest,
  saveQuest,
  type QuestLength,
  type QuestMonster,
  type RandomQuest,
} from '../../lib/adventure/questgen';

/** Shadowdark DCs (~9–15) → Brick Quest's three targets (10 / 13 / 16). */
function brickTarget(dc?: number | null): number {
  if (!dc) return 10;
  return dc <= 11 ? 10 : dc <= 14 ? 13 : 16;
}

export function QuestGenerator() {
  const [quest, setQuest] = useState<RandomQuest | null>(() => loadQuest());
  const [length, setLength] = useState<QuestLength>('short');

  function generate() {
    const q = generateQuest(length);
    setQuest(q);
    saveQuest(q);
  }

  function discard() {
    setQuest(null);
    saveQuest(null);
  }

  return (
    <div className="col" style={{ gap: '0.75rem' }}>
      <div className="card col" style={{ gap: '0.6rem' }}>
        <div className="big-label">Roll a random quest</div>
        <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
          A fresh quest stitched from rooms across every adventure, ready to play out loud —
          you read, the table is the dungeon, the Dice tab rolls. Monsters come statted for{' '}
          <strong>Brick Quest</strong> (the kid rules on the Rules tab).
        </p>
        <div className="row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <div className="filter-pill-row">
            <button
              className={`filter-pill ${length === 'short' ? 'active' : ''}`}
              onClick={() => setLength('short')}
            >
              Short (4 rooms)
            </button>
            <button
              className={`filter-pill ${length === 'long' ? 'active' : ''}`}
              onClick={() => setLength('long')}
            >
              Long (7 rooms)
            </button>
          </div>
          <button className="primary" onClick={generate}>
            {quest ? 'Roll a new quest' : 'Roll a quest'}
          </button>
          {quest && (
            <button className="ghost danger" onClick={discard}>Discard</button>
          )}
        </div>
      </div>

      {quest && (
        <>
          <div className="card quest-goal">
            <div className="big-label">The quest</div>
            <p style={{ margin: '0.25rem 0 0', fontSize: '1.05rem' }}>{quest.goal}</p>
          </div>

          <details className="card quest-twist">
            <summary className="big-label">GM secret — read alone</summary>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.95rem' }}>{quest.twist}</p>
          </details>

          {quest.rooms.map((room, i) => (
            <div key={i} className={`card quest-room ${room.finale ? 'finale' : ''}`}>
              <div className="row" style={{ alignItems: 'baseline', gap: '0.5rem' }}>
                <span className="quest-room-number">{i + 1}</span>
                <div className="big-label grow">{room.title}</div>
                {room.finale && <span className="mini-tag">boss room</span>}
              </div>
              <div className="muted" style={{ fontSize: '0.75rem' }}>from {room.from}</div>
              <p className="quest-room-prose">{room.prose}</p>

              {room.monsters.length > 0 && (
                <div className="col" style={{ gap: '0.3rem' }}>
                  {room.monsters.map((m, j) => (
                    <MonsterLine key={j} monster={m} />
                  ))}
                </div>
              )}

              {room.trap && (
                <div className="quest-block">
                  <div className="quest-block-title">Trap: {room.trap.name}</div>
                  <div className="muted" style={{ fontSize: '0.85rem' }}>
                    {room.trap.trigger} — {room.trap.effect}
                  </div>
                  <div style={{ fontSize: '0.85rem' }}>
                    Spot it: <strong>Wisdom, beat {brickTarget(room.trap.detectDc)}</strong> ·
                    Dodge or disarm it: <strong>Dexterity, beat {brickTarget(room.trap.disarmDc)}</strong> ·
                    If it gets someone, they lose 1 heart.
                  </div>
                </div>
              )}

              {room.treasure && (
                <div className="quest-block">
                  <div className="row" style={{ alignItems: 'center', gap: '0.5rem' }}>
                    {room.treasure.icon && (
                      <img
                        src={`${import.meta.env.BASE_URL}${room.treasure.icon}`}
                        alt=""
                        className="treasure-icon"
                      />
                    )}
                    <div className="quest-block-title">Treasure: {room.treasure.name}</div>
                  </div>
                  {room.treasure.notes && (
                    <div className="muted" style={{ fontSize: '0.85rem' }}>{room.treasure.notes}</div>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Remember the rules of the table: every fight can be talked through, snuck past, or
            fled — and knocked-out heroes wake up when the fight ends.
          </div>
        </>
      )}
    </div>
  );
}

function MonsterLine({ monster }: { monster: QuestMonster }) {
  return (
    <div className="quest-monster">
      {monster.icon && (
        <img src={`${import.meta.env.BASE_URL}${monster.icon}`} alt="" className="monster-icon" />
      )}
      <span className="quest-monster-name">
        {monster.count > 1 ? `${monster.count}× ` : ''}
        {monster.name}
      </span>
      <span className="quest-monster-stats">
        <span className="quest-hearts">{'♥'.repeat(monster.hearts)}</span>
        {monster.count > 1 ? ' each' : ''} · hit it on {monster.beat}+
        {monster.magic ? ' · magic (attacks Warding)' : ''}
        {monster.boss ? ' · acts twice each round' : ''}
      </span>
    </div>
  );
}
