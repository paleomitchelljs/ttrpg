import { formatMod, roll3d6, statMod } from '../../lib/dice';
import { STAT_IDS, STAT_NAMES, type StatBlock } from '../../lib/shadowdark/types';

interface Props {
  stats: StatBlock;
  onChange: (stats: StatBlock) => void;
}

export function StatBlockEditor({ stats, onChange }: Props) {
  function rerollAll() {
    const next = { ...stats };
    for (const id of STAT_IDS) next[id] = roll3d6();
    onChange(next);
  }
  function rerollOne(id: typeof STAT_IDS[number]) {
    onChange({ ...stats, [id]: roll3d6() });
  }
  function setManual(id: typeof STAT_IDS[number], value: number) {
    if (Number.isNaN(value)) return;
    const clamped = Math.max(1, Math.min(20, Math.round(value)));
    onChange({ ...stats, [id]: clamped });
  }

  return (
    <div className="col">
      <div className="row">
        <button onClick={rerollAll}>Roll all (3d6 each)</button>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Click a stat to reroll just that one.
        </span>
      </div>
      <div className="stat-grid">
        {STAT_IDS.map((id) => (
          <div key={id} className="stat-block" title={STAT_NAMES[id]}>
            <div className="name">{id}</div>
            <input
              className="score"
              type="number"
              min={1}
              max={20}
              value={stats[id]}
              onChange={(e) => setManual(id, parseInt(e.target.value, 10))}
              style={{
                background: 'transparent',
                border: 'none',
                textAlign: 'center',
                width: '100%',
                padding: 0,
                fontFamily: 'var(--font-display)',
              }}
            />
            <div className="mod">{formatMod(statMod(stats[id]))}</div>
            <button
              className="ghost"
              onClick={() => rerollOne(id)}
              style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', marginTop: '0.3rem' }}
            >
              ↻
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
