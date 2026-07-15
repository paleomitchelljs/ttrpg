// Auto-generated explored map: lays the adventure's room graph out on a grid
// using exit directions (north pulls up, east pulls right…), then renders only
// what the party has seen — visited rooms by name, plus "?" stubs for doors
// they've noticed but not opened. Zero per-adventure authoring: any room-graph
// YAML, current or future, gets this map for free.
//
// Layout runs over the FULL graph (not just visited rooms) so node positions
// stay put as the party explores instead of reshuffling every few steps.

import { useMemo } from 'react';
import { useArtUrl } from '../../lib/hooks';
import { normalizeDir } from '../../lib/adventure/engine';
import type { Adventure, GameState, PartyMemberState } from '../../lib/adventure/types';

const CELL_W = 128;
const CELL_H = 96;
const NODE_W = 104;
const NODE_H = 58;

const DIR_VEC: Record<string, [number, number]> = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  up: [1, -1], down: [-1, 1], in: [1, 1], out: [-1, -1],
};

interface Placed {
  gx: number;
  gy: number;
}

/** Cells to probe, nearest first, when a room's preferred spot is taken. */
function* probe(gx: number, gy: number): Generator<[number, number]> {
  yield [gx, gy];
  for (let r = 1; r <= 4; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) yield [gx + dx, gy + dy];
      }
    }
  }
}

function layoutRooms(adv: Adventure): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  const taken = new Set<string>();
  const put = (id: string, gx: number, gy: number) => {
    for (const [x, y] of probe(gx, gy)) {
      if (!taken.has(`${x},${y}`)) {
        placed.set(id, { gx: x, gy: y });
        taken.add(`${x},${y}`);
        return;
      }
    }
  };
  put(adv.start, 0, 0);
  const queue = [adv.start];
  while (queue.length) {
    const id = queue.shift()!;
    const from = placed.get(id)!;
    const room = adv.roomsById[id];
    if (!room) continue;
    for (const exit of room.exits) {
      if (placed.has(exit.to) || !adv.roomsById[exit.to]) continue;
      const [dx, dy] = DIR_VEC[normalizeDir(exit.dir) ?? ''] ?? [1, 0];
      put(exit.to, from.gx + dx, from.gy + dy);
      queue.push(exit.to);
    }
  }
  // Any rooms unreachable from the start (shouldn't happen, but be safe).
  for (const room of adv.rooms) if (!placed.has(room.id)) put(room.id, 0, 0);
  return placed;
}

interface Edge {
  from: string;
  to: string;
  locked: boolean;
}

export function DungeonMinimap({ adventure, state }: { adventure: Adventure; state: GameState }) {
  const layout = useMemo(() => layoutRooms(adventure), [adventure]);
  const visited = new Set(state.visited);

  // Frontier: unexplored rooms the party has seen a door to.
  const frontier = new Set<string>();
  const edges: Edge[] = [];
  const seenPair = new Set<string>();
  for (const id of state.visited) {
    const room = adventure.roomsById[id];
    if (!room) continue;
    for (const exit of room.exits) {
      if (!adventure.roomsById[exit.to]) continue;
      if (!visited.has(exit.to)) frontier.add(exit.to);
      const key = [id, exit.to].sort().join('::');
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      edges.push({ from: id, to: exit.to, locked: !!exit.lockedBy && !state.flags.includes(exit.lockedBy) });
    }
  }

  const shown = [...visited, ...frontier].filter((id) => layout.has(id));
  if (!shown.length) return <div className="placeholder">Nowhere explored yet.</div>;

  const xs = shown.map((id) => layout.get(id)!.gx);
  const ys = shown.map((id) => layout.get(id)!.gy);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const cols = Math.max(...xs) - minX + 1;
  const rows = Math.max(...ys) - minY + 1;
  const width = cols * CELL_W;
  const height = rows * CELL_H;
  const center = (id: string) => {
    const p = layout.get(id)!;
    return { cx: (p.gx - minX) * CELL_W + CELL_W / 2, cy: (p.gy - minY) * CELL_H + CELL_H / 2 };
  };

  return (
    <div className="minimap-scroll">
      <div className="minimap" style={{ width, height }}>
        <svg className="minimap-edges" width={width} height={height}>
          {edges.map((e) => {
            const a = center(e.from);
            const b = center(e.to);
            return (
              <line
                key={`${e.from}->${e.to}`}
                x1={a.cx} y1={a.cy} x2={b.cx} y2={b.cy}
                className={`minimap-edge ${e.locked ? 'locked' : ''}`}
              />
            );
          })}
        </svg>
        {edges.filter((e) => e.locked).map((e) => {
          const a = center(e.from);
          const b = center(e.to);
          return (
            <span
              key={`lock:${e.from}->${e.to}`}
              className="minimap-lock"
              style={{ left: (a.cx + b.cx) / 2, top: (a.cy + b.cy) / 2 }}
              title="Locked"
            >
              🔒
            </span>
          );
        })}
        {shown.map((id) => {
          const room = adventure.roomsById[id];
          const { cx, cy } = center(id);
          if (!visited.has(id)) {
            return (
              <span key={id} className="minimap-node unknown" style={{ left: cx, top: cy }} title="Unexplored">
                ?
              </span>
            );
          }
          const current = id === state.currentRoomId;
          return (
            <span
              key={id}
              className={`minimap-node ${current ? 'current' : ''} ${room.objective ? 'objective' : ''}`}
              style={{ left: cx, top: cy, width: NODE_W, height: NODE_H }}
              title={room.name}
            >
              {room.objective && <span className="minimap-star">★</span>}
              <span className="minimap-name">{room.name}</span>
              {current && (
                <span className="minimap-party">
                  {state.party.slice(0, 4).map((m) => (
                    <PartyFace key={m.id} member={m} />
                  ))}
                </span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function PartyFace({ member }: { member: PartyMemberState }) {
  const url = useArtUrl(member.portraitArtId);
  return url ? (
    <img className="minimap-face" src={url} alt={member.name} title={member.name} />
  ) : (
    <span className="minimap-face minimap-face-fallback" title={member.name}>
      {member.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
