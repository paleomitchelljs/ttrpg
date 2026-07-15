// The in-crawl map dialog, two views:
//  · "Explored" — the auto-generated room-graph minimap (works for every
//    adventure with zero authoring; only shows what the party has seen).
//  · "Reference" — the scanned dungeon map. If the adventure has calibrated
//    room regions, fog-of-war hides the unexplored parts (soft-edged SVG mask
//    over `state.visited`) and the party's portraits pin the current room.
//    A GM eye-toggle lifts the fog for table talk.
//
// Calibration (dev builds only): pick a room, click to drop its pin, drag to
// draw its reveal region, then copy the generated `map_calibration:` YAML
// block into the adventure file. Geometry is normalized 0–1, so it survives
// any display size.

import { useMemo, useRef, useState } from 'react';
import { useArtUrl } from '../../lib/hooks';
import type { Adventure, GameState, MapPoint, MapRect, PartyMemberState } from '../../lib/adventure/types';
import { DungeonMinimap } from './DungeonMinimap';

interface Props {
  adventure: Adventure;
  state: GameState;
  onClose: () => void;
}

type View = 'auto' | 'image';

export function MapOverlay({ adventure, state, onClose }: Props) {
  const hasImage = !!adventure.mapImage;
  const [view, setView] = useState<View>('auto');
  const [fogLifted, setFogLifted] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  return (
    <div className="map-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={`${adventure.title} map`}>
      <div className="map-overlay-inner" onClick={(e) => e.stopPropagation()}>
        <div className="map-overlay-header">
          <div className="big-label">{adventure.title} — map</div>
          <div className="map-view-tabs">
            <button className={`map-view-tab ${view === 'auto' ? 'active' : ''}`} onClick={() => setView('auto')}>
              Explored
            </button>
            {hasImage && (
              <button className={`map-view-tab ${view === 'image' ? 'active' : ''}`} onClick={() => setView('image')}>
                Reference
              </button>
            )}
          </div>
          <span className="grow" />
          {view === 'image' && adventure.rooms.some((r) => r.mapRegion) && (
            <button
              className={`ghost map-fog-toggle ${fogLifted ? 'lifted' : ''}`}
              onClick={() => setFogLifted((f) => !f)}
              title={fogLifted ? 'Lower the fog (player view)' : 'Lift the fog (GM view)'}
            >
              {fogLifted ? '🐵 GM view' : '🙈 fogged'}
            </button>
          )}
          {view === 'image' && import.meta.env.DEV && (
            <button className={`ghost ${calibrating ? 'danger' : ''}`} onClick={() => setCalibrating((c) => !c)}>
              {calibrating ? 'Done calibrating' : 'Calibrate'}
            </button>
          )}
          <button onClick={onClose} aria-label="Close map">✕</button>
        </div>
        {view === 'auto' ? (
          <DungeonMinimap adventure={adventure} state={state} />
        ) : calibrating ? (
          <Calibrator adventure={adventure} />
        ) : (
          <ReferenceMap adventure={adventure} state={state} fogLifted={fogLifted} />
        )}
      </div>
    </div>
  );
}

// ───────── reference map with fog + party pin ─────────

function ReferenceMap({ adventure, state, fogLifted }: { adventure: Adventure; state: GameState; fogLifted: boolean }) {
  const src = `${import.meta.env.BASE_URL}${adventure.mapImage}`;
  const calibrated = adventure.rooms.some((r) => r.mapRegion);
  const revealed = state.visited
    .map((id) => adventure.roomsById[id]?.mapRegion)
    .filter((r): r is MapRect => !!r);
  const fogOn = calibrated && !fogLifted;

  const room = adventure.roomsById[state.currentRoomId];
  const pin: MapPoint | undefined =
    room?.mapPin ??
    (room?.mapRegion
      ? { x: room.mapRegion.x + room.mapRegion.w / 2, y: room.mapRegion.y + room.mapRegion.h / 2 }
      : undefined);

  return (
    <div className="map-fog-wrap">
      <img className="map-overlay-img" src={src} alt={`${adventure.title} map`} />
      {fogOn && (
        <svg className="map-fog" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <filter id="fog-soft" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
            <mask id="fog-mask">
              <rect x="-10" y="-10" width="120" height="120" fill="white" />
              <g filter="url(#fog-soft)">
                {revealed.map((r, i) => (
                  <rect key={i} x={r.x * 100} y={r.y * 100} width={r.w * 100} height={r.h * 100} rx="1.5" fill="black" />
                ))}
              </g>
            </mask>
          </defs>
          <rect x="-10" y="-10" width="120" height="120" fill="#060509" opacity="0.95" mask="url(#fog-mask)" />
        </svg>
      )}
      {pin && (
        <div className="map-party-pin" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }} title={room?.name}>
          <span className="map-party-faces">
            {state.party.slice(0, 4).map((m) => (
              <PinFace key={m.id} member={m} />
            ))}
          </span>
          <span className="map-party-tip" />
        </div>
      )}
    </div>
  );
}

function PinFace({ member }: { member: PartyMemberState }) {
  const url = useArtUrl(member.portraitArtId);
  return url ? (
    <img className="map-pin-face" src={url} alt={member.name} title={member.name} />
  ) : (
    <span className="map-pin-face map-pin-face-fallback" title={member.name}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ───────── calibration tool (dev only) ─────────

interface CalEntry {
  pin?: MapPoint;
  region?: MapRect;
}

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

function Calibrator({ adventure }: { adventure: Adventure }) {
  const src = `${import.meta.env.BASE_URL}${adventure.mapImage}`;
  const [roomId, setRoomId] = useState(adventure.rooms[0]?.id ?? '');
  const [mode, setMode] = useState<'pin' | 'region'>('region');
  const [edits, setEdits] = useState<Map<string, CalEntry>>(new Map());
  const dragStart = useRef<MapPoint | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Effective geometry: authored YAML values overlaid with this session's edits.
  const entries = useMemo(() => {
    const out = new Map<string, CalEntry>();
    for (const r of adventure.rooms) {
      if (r.mapPin || r.mapRegion) out.set(r.id, { pin: r.mapPin, region: r.mapRegion });
    }
    for (const [id, e] of edits) out.set(id, { ...out.get(id), ...e });
    return out;
  }, [adventure, edits]);

  function norm(e: React.MouseEvent): MapPoint {
    const rect = wrapRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function commit(id: string, patch: CalEntry) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(id, { ...next.get(id), ...patch });
      return next;
    });
  }

  function onMouseDown(e: React.MouseEvent) {
    dragStart.current = norm(e);
  }

  function onMouseUp(e: React.MouseEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start || !roomId) return;
    const end = norm(e);
    const moved = Math.hypot(end.x - start.x, end.y - start.y) > 0.01;
    if (mode === 'pin' || !moved) {
      commit(roomId, { pin: end });
    } else {
      commit(roomId, {
        region: {
          x: Math.min(start.x, end.x),
          y: Math.min(start.y, end.y),
          w: Math.abs(end.x - start.x),
          h: Math.abs(end.y - start.y),
        },
      });
    }
  }

  const yaml = useMemo(() => {
    const lines = ['map_calibration:'];
    for (const room of adventure.rooms) {
      const e = entries.get(room.id);
      if (!e || (!e.pin && !e.region)) continue;
      const parts: string[] = [];
      if (e.pin) parts.push(`pin: [${fmt(e.pin.x)}, ${fmt(e.pin.y)}]`);
      if (e.region) parts.push(`region: [${fmt(e.region.x)}, ${fmt(e.region.y)}, ${fmt(e.region.w)}, ${fmt(e.region.h)}]`);
      lines.push(`  ${room.id}: { ${parts.join(', ')} }`);
    }
    return lines.join('\n');
  }, [adventure, entries]);

  return (
    <div className="col" style={{ gap: '0.6rem' }}>
      <div className="row" style={{ gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <select aria-label="Room to calibrate" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
          {adventure.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {entries.get(r.id)?.region ? '✓ ' : ''}{r.name}
            </option>
          ))}
        </select>
        <label className="muted" style={{ fontSize: '0.8rem' }}>
          <input type="radio" checked={mode === 'region'} onChange={() => setMode('region')} /> drag region
        </label>
        <label className="muted" style={{ fontSize: '0.8rem' }}>
          <input type="radio" checked={mode === 'pin'} onChange={() => setMode('pin')} /> click pin
        </label>
        <button className="ghost" onClick={() => navigator.clipboard.writeText(yaml)}>Copy YAML</button>
      </div>
      <div className="map-fog-wrap calibrating" ref={wrapRef} onMouseDown={onMouseDown} onMouseUp={onMouseUp}>
        <img className="map-overlay-img" src={src} alt="calibrating" draggable={false} />
        <svg className="map-fog" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {[...entries.entries()].map(([id, e]) => (
            <g key={id} className={id === roomId ? 'cal-active' : 'cal-idle'}>
              {e.region && (
                <rect x={e.region.x * 100} y={e.region.y * 100} width={e.region.w * 100} height={e.region.h * 100} className="cal-rect" />
              )}
              {e.pin && <circle cx={e.pin.x * 100} cy={e.pin.y * 100} r="0.8" className="cal-pin" />}
            </g>
          ))}
        </svg>
      </div>
      <textarea className="cal-yaml" readOnly value={yaml} rows={Math.min(14, yaml.split('\n').length + 1)} />
    </div>
  );
}
