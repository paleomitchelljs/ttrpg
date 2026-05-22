import { useState } from 'react';
import { roll, type RollMode } from '../lib/dice';
import { clearRolls, pushRoll, useLatestRoll, useRollLog } from '../lib/rollLog';

interface QuickDie {
  faces: number;
  emoji: string;
}

const QUICK_DICE: QuickDie[] = [
  { faces: 4, emoji: '🔺' },
  { faces: 6, emoji: '🎲' },
  { faces: 8, emoji: '🔷' },
  { faces: 10, emoji: '🔟' },
  { faces: 12, emoji: '💎' },
  { faces: 20, emoji: '✨' },
];

export function DiceTab() {
  const [expr, setExpr] = useState('1d20');
  const [mode, setMode] = useState<RollMode>('normal');
  const [error, setError] = useState<string | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const log = useRollLog();
  const latest = useLatestRoll();

  function rollDie(faces: number) {
    try {
      const result = roll(`1d${faces}`, mode);
      pushRoll(result, `d${faces}`);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function rollExpr() {
    try {
      const result = roll(expr, mode);
      pushRoll(result, expr);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <h1>Dice</h1>

      {latest ? (
        <div className={`big-roll ${latest.isCrit ? 'crit' : latest.isFumble ? 'fumble' : ''}`}>
          <div className="big-roll-label">{latest.label ?? latest.expression}</div>
          <div className="big-roll-total">{latest.total}</div>
          <div className="big-roll-detail">{latest.breakdown}</div>
        </div>
      ) : (
        <div className="big-roll placeholder-roll">
          <div className="big-roll-label">Tap a die to roll</div>
        </div>
      )}

      <div className="dice-grid">
        {QUICK_DICE.map((d) => (
          <button key={d.faces} className="dice-tile" onClick={() => rollDie(d.faces)}>
            <div className="dice-tile-emoji">{d.emoji}</div>
            <div className="dice-tile-label">d{d.faces}</div>
          </button>
        ))}
      </div>

      <div className="row" style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
        <div className="mode-toggle" role="radiogroup" aria-label="Roll mode">
          <button
            className={`mode-button ${mode === 'disadvantage' ? 'active' : ''}`}
            onClick={() => setMode('disadvantage')}
          >
            👎 Bad luck
          </button>
          <button
            className={`mode-button ${mode === 'normal' ? 'active' : ''}`}
            onClick={() => setMode('normal')}
          >
            Normal
          </button>
          <button
            className={`mode-button ${mode === 'advantage' ? 'active' : ''}`}
            onClick={() => setMode('advantage')}
          >
            👍 Lucky
          </button>
        </div>
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="ghost" onClick={() => setShowCustom((v) => !v)}>
          {showCustom ? 'Hide custom roll' : 'Custom roll…'}
        </button>
        {log.length > 0 && (
          <button className="ghost" onClick={clearRolls}>Clear history</button>
        )}
      </div>

      {showCustom && (
        <div className="card col">
          <label>Expression (e.g. <code>2d6+3</code>)</label>
          <div className="row">
            <input
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') rollExpr(); }}
              className="grow"
              style={{ fontFamily: 'var(--font-mono)' }}
            />
            <button className="primary" onClick={rollExpr}>Roll</button>
          </div>
          {error && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>}
        </div>
      )}

      {log.length > 0 && (
        <div className="card">
          <div className="big-label" style={{ marginBottom: '0.5rem' }}>History</div>
          <div>
            {log.map((r) => {
              const cls = r.isCrit ? 'crit' : r.isFumble ? 'fumble' : '';
              return (
                <div key={r.id} className={`roll-line ${cls}`}>
                  <span className="expr">{r.label ?? r.expression}</span>
                  <span className="breakdown">{r.breakdown}</span>
                  <span className="total">{r.total}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
