// GM quick-roll tools: the random scene / treasure / trap rollers and the
// reference-map gallery that used to live on the standalone "Dungeons" tab.
// Preserved here (inside the Adventure portal) so nothing was lost when that
// tab was replaced.

import { useEffect, useState } from 'react';
import { rollScene, type Scene } from '../../lib/shadowdark/scenes';
import { rollTreasure, type Treasure, type TreasureTier } from '../../lib/shadowdark/treasure';
import { rollTrap, type Trap } from '../../lib/shadowdark/traps';
import { mapsBySource, type DungeonMap } from '../../lib/shadowdark/maps';
import { roll } from '../../lib/dice';

interface Roll {
  kind: 'scene' | 'treasure' | 'trap';
  scene?: Scene;
  treasure?: Treasure;
  trap?: Trap;
  valueRoll?: string;
}

export function QuickTools() {
  const [history, setHistory] = useState<Roll[]>([]);
  const [showMaps, setShowMaps] = useState(false);
  const [openMap, setOpenMap] = useState<DungeonMap | null>(null);
  const groupedMaps = mapsBySource();

  useEffect(() => {
    if (!openMap) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenMap(null);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openMap]);

  function pushScene() {
    const entry: Roll = { kind: 'scene', scene: rollScene() };
    setHistory((h) => [entry, ...h].slice(0, 20));
  }

  function pushTreasure(tier: TreasureTier) {
    const t = rollTreasure(tier);
    let valueRoll: string | undefined;
    if (t.value) {
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

  function pushTrap() {
    const entry: Roll = { kind: 'trap', trap: rollTrap() };
    setHistory((h) => [entry, ...h].slice(0, 20));
  }

  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="card col">
        <div className="big-label">Roll a room</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button className="primary" onClick={pushScene}>Roll a scene</button>
        </div>

        <div className="big-label" style={{ marginTop: '0.5rem' }}>Roll treasure</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button onClick={() => pushTreasure(1)}>Tier 1</button>
          <button onClick={() => pushTreasure(2)}>Tier 2</button>
          <button onClick={() => pushTreasure(3)}>Tier 3</button>
          <button onClick={() => pushTreasure(4)}>Tier 4 (epic)</button>
        </div>

        <div className="big-label" style={{ marginTop: '0.5rem' }}>Roll a trap</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
          <button onClick={pushTrap}>Trap</button>
        </div>

        {groupedMaps.length > 0 && (
          <>
            <div className="big-label" style={{ marginTop: '0.5rem' }}>Reference maps</div>
            <div className="row" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
              <button onClick={() => setShowMaps((s) => !s)}>
                {showMaps ? 'Hide maps' : 'Show maps'}
              </button>
            </div>
          </>
        )}
      </div>

      {showMaps && (
        <div className="col" style={{ gap: '1rem' }}>
          {groupedMaps.map((group) => (
            <div key={group.source} className="card col" style={{ gap: '0.6rem' }}>
              <div className="big-label">{group.source}</div>
              <div className="map-gallery">
                {group.maps.map((m) => (
                  <button key={m.id} className="map-thumb" onClick={() => setOpenMap(m)}>
                    <img src={`${import.meta.env.BASE_URL}${m.image}`} alt={m.name} loading="lazy" />
                    <div className="map-thumb-name">{m.name}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {openMap && (
        <div
          className="map-overlay"
          onClick={() => setOpenMap(null)}
          role="dialog"
          aria-modal="true"
          aria-label={openMap.name}
        >
          <div className="map-overlay-inner" onClick={(e) => e.stopPropagation()}>
            <div className="map-overlay-header">
              <div className="col" style={{ gap: '0.15rem' }}>
                <div className="big-label">{openMap.name}</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {openMap.source}
                  {openMap.sourcePage ? ` · p${openMap.sourcePage}` : ''}
                </div>
              </div>
              <button onClick={() => setOpenMap(null)} aria-label="Close map">✕</button>
            </div>
            <img
              className="map-overlay-img"
              src={`${import.meta.env.BASE_URL}${openMap.image}`}
              alt={openMap.name}
            />
            {openMap.description && (
              <p className="muted" style={{ margin: '0.4rem 0 0', fontSize: '0.9rem' }}>
                {openMap.description}
              </p>
            )}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="col" style={{ gap: '0.7rem' }}>
          {history.map((r, i) => (
            <div key={i} className="card scene-card">
              {r.kind === 'scene' && r.scene && (
                <>
                  <div className="big-label">{r.scene.name}</div>
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
                  <div className="row" style={{ alignItems: 'center', gap: '0.6rem' }}>
                    {r.treasure.icon && (
                      <img src={`${import.meta.env.BASE_URL}${r.treasure.icon}`} alt="" className="treasure-icon" />
                    )}
                    <div className="big-label grow">{r.treasure.name}</div>
                    {r.valueRoll && <div className="treasure-value">{r.valueRoll}</div>}
                  </div>
                  {r.treasure.notes && (
                    <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }} className="muted">
                      {r.treasure.notes}
                    </p>
                  )}
                </>
              )}
              {r.kind === 'trap' && r.trap && (
                <>
                  <div className="big-label">{r.trap.name}</div>
                  <div className="row muted" style={{ gap: '1rem', fontSize: '0.85rem' }}>
                    <span>Detect DC {r.trap.detectDc ?? '—'}</span>
                    <span>Disarm DC {r.trap.disarmDc ?? '—'}</span>
                  </div>
                  <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }}>
                    <strong>Trigger:</strong> {r.trap.trigger}
                  </p>
                  <p style={{ margin: '0.25rem 0', fontSize: '0.95rem' }}>
                    <strong>Effect:</strong> {r.trap.effect}
                  </p>
                  {r.trap.notes && (
                    <p style={{ margin: '0.25rem 0', fontSize: '0.9rem' }} className="muted">
                      {r.trap.notes}
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
