import type { RollResult } from '../../lib/dice';

interface Props {
  rolls: RollResult[];
  emptyMessage?: string;
}

export function RollLog({ rolls, emptyMessage = 'No rolls yet.' }: Props) {
  if (rolls.length === 0) {
    return <div className="placeholder">{emptyMessage}</div>;
  }
  return (
    <div>
      {rolls.map((r, i) => {
        const cls = r.isCrit ? 'crit' : r.isFumble ? 'fumble' : '';
        return (
          <div key={i} className={`roll-line ${cls}`}>
            <span className="expr">
              {r.expression}
              {r.mode !== 'normal' ? ` (${r.mode})` : ''}
            </span>
            <span className="breakdown">{r.breakdown}</span>
            <span className="total">{r.total}</span>
          </div>
        );
      })}
    </div>
  );
}
