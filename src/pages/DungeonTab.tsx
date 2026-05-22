import { useState } from 'react';
import { rollScene, type Scene } from '../lib/shadowdark/scenes';
import { rollTreasure, type Treasure } from '../lib/shadowdark/treasure';
import { roll } from '../lib/dice';

interface Roll {
  kind: 'scene' | 'treasure';
  scene?: Scene;
  treasure?: Treasure;
  valueRoll?: string;
}

export function DungeonTab() {
  const [history, setHistory] = useState<Roll[]>([]);

  function pushScene() {
    const entry: Roll = { kind: 'scene', scene: rollScene() };
    setHistory((h) => [entry, ...h].slice(0, 20));
  }

  function pushTreasure(tier: 1 | 2 | 3) {
    const t = rollTreasure(tier);
    let valueRoll: string | undefined;
    if (t.value) {
      // If value is a dice expression like "5d6 cp", roll it and show the total.
      const match = t.value.match(/^(\d+d\d+(?:[+-]\d+)?)\s*(.*)$/);
      if (match) {
        try {
          const total = roll(match[1]).total;
          valueRoll = `${total} ${match[2]}`.trim();
        } catch {
          valueRoll = t.value;
        }
      } else {
        valueRoll = t.value;
      }
    }
    const entry: Roll = { kind: 'treasure', treasure: t, valueRoll };
    setHistory((h) => [entry, ...h].slice(0, 20));
  }

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1>Dungeons</h1>

      <div className="card col">
        <div className="big-label">Roll a room</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button className="primary" onClick={pushScene}>🗺️ Roll a scene</button>
        </div>

        <div className="big-label" style={{ marginTop: '0.5rem' }}>Roll treasure</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button onClick={() => pushTreasure(1)}>💰 Tier 1</button>
          <button onClick={() => pushTreasure(2)}>💎 Tier 2</button>
          <button onClick={() => pushTreasure(3)}>👑 Tier 3</button>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="card placeholder-tile">
          <div className="placeholder-icon">🗺️</div>
          <div className="placeholder-title">Nothing rolled yet.</div>
          <div className="placeholder-sub">
            Tap a button above to roll a room, a treasure, or both.
          </div>
        </div>
      ) : (
        <div className="col" style={{ gap: '0.7rem' }}>
          {history.map((r, i) => (
            <div key={i} className="card scene-card">
              {r.kind === 'scene' && r.scene && (
                <>
                  <div className="big-label">🗺️ {r.scene.name}</div>
                  <p style={{ margin: '0.25rem 0', fontSize: '1.05rem' }}>{r.scene.description}</p>
                  {r.scene.tags.length > 0 && (
                    <div className="row" style={{ gap: '0.25rem', flexWrap: 'wrap' }}>
                      {r.scene.tags.map((t) => (
                        <span key={t} className="mini-tag">{t}</span>
                      ))}
                    </div>
                  )}
                </>
              )}
              {r.kind === 'treasure' && r.treasure && (
                <>
                  <div className="row" style={{ alignItems: 'baseline' }}>
                    <div className="big-label grow">💰 {r.treasure.name}</div>
                    {r.valueRoll && <div className="treasure-value">{r.valueRoll}</div>}
                  </div>
                  {r.treasure.notes && (
                    <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }} className="muted">
                      {r.treasure.notes}
                    </p>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
