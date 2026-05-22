import type { ReactNode } from 'react';

interface ChoiceItem {
  id: string;
  title: string;
  blurb?: ReactNode;
}

interface Props {
  items: ChoiceItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function ChoiceGrid({ items, selectedId, onSelect }: Props) {
  return (
    <div className="choice-grid">
      {items.map((it) => (
        <button
          key={it.id}
          className={`choice ${selectedId === it.id ? 'selected' : ''}`}
          onClick={() => onSelect(it.id)}
        >
          <h4>{it.title}</h4>
          {it.blurb && <p className="blurb">{it.blurb}</p>}
        </button>
      ))}
    </div>
  );
}
