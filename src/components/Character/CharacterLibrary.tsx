import { useArtUrl, useCharacters, emitCharactersChanged } from '../../lib/hooks';
import { getAncestry } from '../../lib/shadowdark/ancestries';
import { getClass } from '../../lib/shadowdark/classes';
import type { Character } from '../../lib/shadowdark/types';
import { deleteCharacter, exportAll, importAll, saveCharacter } from '../../lib/storage';
import { newCharacterId } from '../../lib/shadowdark/character';

interface Props {
  onSelect: (character: Character) => void;
  onCreateNew: () => void;
}

export function CharacterLibrary({ onSelect, onCreateNew }: Props) {
  const { characters, loading, refresh } = useCharacters();

  async function handleExport() {
    const json = await exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shadowdark-portal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      try {
        await importAll(text);
        emitCharactersChanged();
        await refresh();
      } catch (e) {
        alert(`Import failed: ${e instanceof Error ? e.message : e}`);
      }
    };
    input.click();
  }

  async function duplicate(c: Character) {
    const copy: Character = {
      ...c,
      id: newCharacterId(),
      name: `${c.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveCharacter(copy);
    emitCharactersChanged();
  }

  async function remove(c: Character) {
    if (!confirm(`Delete ${c.name}?`)) return;
    await deleteCharacter(c.id);
    emitCharactersChanged();
  }

  return (
    <div className="col" style={{ gap: '1.25rem' }}>
      <div className="row">
        <h1 style={{ margin: 0 }} className="grow">Characters</h1>
        <button className="ghost" onClick={handleImport}>Import</button>
        <button className="ghost" onClick={handleExport} disabled={characters.length === 0}>
          Export
        </button>
        <button className="primary" onClick={onCreateNew}>+ New Character</button>
      </div>

      {loading ? (
        <div className="placeholder">Loading…</div>
      ) : characters.length === 0 ? (
        <div className="card placeholder">
          No characters yet.<br />
          <button className="primary" onClick={onCreateNew} style={{ marginTop: '1rem' }}>
            Roll your first character
          </button>
        </div>
      ) : (
        <div className="library-grid">
          {characters.map((c) => (
            <LibraryCard
              key={c.id}
              character={c}
              onOpen={() => onSelect(c)}
              onDuplicate={() => duplicate(c)}
              onDelete={() => remove(c)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryCard({
  character,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  character: Character;
  onOpen: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const url = useArtUrl(character.portraitArtId);
  const ancestry = getAncestry(character.ancestryId);
  const cls = getClass(character.classId);
  return (
    <div className="library-card">
      <div onClick={onOpen} className="col" style={{ cursor: 'pointer', gap: '0.5rem' }}>
        {url ? (
          <img src={url} alt={character.name} className="thumb" />
        ) : (
          <div className="thumb">No portrait</div>
        )}
        <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>{character.name}</div>
        <div className="meta">
          Lvl {character.level} {ancestry?.name ?? ''} {cls?.name ?? ''}
        </div>
        <div className="meta">
          HP {character.hp.current}/{character.hp.max} · AC {character.ac}
        </div>
      </div>
      <div className="row" style={{ gap: '0.3rem' }}>
        <button className="ghost grow" style={{ fontSize: '0.75rem' }} onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="ghost" style={{ fontSize: '0.75rem', color: 'var(--danger)' }} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
