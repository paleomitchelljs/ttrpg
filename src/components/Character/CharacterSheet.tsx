import { formatMod, statMod } from '../../lib/dice';
import { getAncestry } from '../../lib/shadowdark/ancestries';
import { getClass } from '../../lib/shadowdark/classes';
import { getSpell } from '../../lib/shadowdark/spells';
import { STAT_IDS } from '../../lib/shadowdark/types';
import type { Character } from '../../lib/shadowdark/types';
import { useArtUrl } from '../../lib/hooks';

interface Props {
  character: Character;
  onEdit: () => void;
  onClose: () => void;
  onDelete: () => void;
}

export function CharacterSheet({ character, onEdit, onClose, onDelete }: Props) {
  const ancestry = getAncestry(character.ancestryId);
  const cls = getClass(character.classId);
  const portraitUrl = useArtUrl(character.portraitArtId);

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <div className="row">
        <button className="ghost" onClick={onClose}>← Back</button>
        <h1 style={{ margin: 0 }} className="grow">
          {character.name}
        </h1>
        <button onClick={onEdit}>Edit</button>
        <button className="danger" onClick={onDelete}>Delete</button>
      </div>

      <div className="card sheet">
        {portraitUrl ? (
          <img src={portraitUrl} alt={character.name} className="portrait" />
        ) : (
          <div className="portrait">No portrait</div>
        )}
        <div className="col">
          <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
            <SheetField label="Ancestry" value={ancestry?.name ?? character.ancestryId} />
            <SheetField label="Class" value={cls?.name ?? character.classId} />
            <SheetField label="Level" value={character.level} />
            <SheetField label="Alignment" value={character.alignment} />
            <SheetField label="Background" value={character.background} />
            {character.deity && <SheetField label="Deity" value={character.deity} />}
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: '1.5rem' }}>
            <SheetField label="HP" value={`${character.hp.current} / ${character.hp.max}`} />
            <SheetField label="AC" value={character.ac} />
            <SheetField label="Gold" value={`${character.gold}gp`} />
            <SheetField label="XP" value={character.xp} />
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="section-title">Ability Scores</h2>
        <div className="stat-grid">
          {STAT_IDS.map((id) => (
            <div key={id} className="stat-block">
              <div className="name">{id}</div>
              <div className="score">{character.stats[id]}</div>
              <div className="mod">{formatMod(statMod(character.stats[id]))}</div>
            </div>
          ))}
        </div>
      </div>

      {ancestry && (
        <div className="card">
          <h2 className="section-title">{ancestry.name}</h2>
          <p className="muted" style={{ margin: '0 0 0.5rem 0' }}>{ancestry.description}</p>
          <p style={{ margin: 0 }}><strong>Trait.</strong> {ancestry.trait}</p>
          <p className="faint" style={{ margin: '0.3rem 0 0 0', fontSize: '0.85rem' }}>
            Languages: {ancestry.languages.join(', ')}
          </p>
        </div>
      )}

      {cls && (
        <div className="card">
          <h2 className="section-title">{cls.name}</h2>
          <p className="muted" style={{ margin: '0 0 0.5rem 0' }}>{cls.description}</p>
          <p className="faint" style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem' }}>
            Hit Die: d{cls.hitDie} · Weapons: {cls.weapons} · Armor: {cls.armor}
          </p>
          {cls.features.map((f) => (
            <p key={f.name} style={{ margin: '0.3rem 0' }}>
              <strong>{f.name}.</strong> {f.text}
            </p>
          ))}
        </div>
      )}

      {character.spells.length > 0 && (
        <div className="card">
          <h2 className="section-title">Spells</h2>
          {character.spells.map((name) => {
            const s = getSpell(name);
            if (!s) return <p key={name} style={{ margin: '0.3rem 0' }}>{name}</p>;
            return (
              <div key={name} style={{ marginBottom: '0.6rem' }}>
                <strong>{s.name}.</strong>{' '}
                <span className="faint">{s.range} · {s.duration}</span>{' '}
                {s.text}
              </div>
            );
          })}
        </div>
      )}

      {character.gear.length > 0 && (
        <div className="card">
          <h2 className="section-title">Gear</h2>
          <ul className="gear-list">
            {character.gear.map((item, i) => (
              <li key={`${item.name}-${i}`}>
                <span className="item-name">{item.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {character.notes && (
        <div className="card">
          <h2 className="section-title">Notes</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{character.notes}</p>
        </div>
      )}
    </div>
  );
}

function SheetField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--ink-dim)' }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem' }}>{value}</div>
    </div>
  );
}
