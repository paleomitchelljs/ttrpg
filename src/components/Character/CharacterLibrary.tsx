import { useEffect, useState } from 'react';
import { useArtUrl, useCharacters, emitCharactersChanged } from '../../lib/hooks';
import { getAncestry } from '../../lib/shadowdark/ancestries';
import { getClass } from '../../lib/shadowdark/classes';
import { characterCombatProfile } from '../../lib/shadowdark/combat';
import type { Character } from '../../lib/shadowdark/types';
import { deleteCharacter, exportCharacters, importCharacters, saveCharacter } from '../../lib/storage';
import { newCharacterId } from '../../lib/shadowdark/character';

interface Props {
  onSelect: (character: Character) => void;
  onCreateNew: () => void;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'hero';
}

function downloadJson(json: string, filename: string) {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function CharacterLibrary({ onSelect, onCreateNew }: Props) {
  const { characters, loading, refresh } = useCharacters();
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status]);

  async function downloadAll() {
    const json = await exportCharacters();
    downloadJson(json, `shadowdark-heroes-${new Date().toISOString().slice(0, 10)}.json`);
    setStatus({ text: `Downloaded ${characters.length} hero${characters.length === 1 ? '' : 'es'}.` });
  }

  async function downloadOne(c: Character) {
    const json = await exportCharacters([c.id]);
    downloadJson(json, `hero-${slug(c.name)}.json`);
  }

  function uploadHeroes() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      if (!files.length) return;
      let total = 0;
      const errors: string[] = [];
      for (const file of files) {
        try {
          total += await importCharacters(await file.text());
        } catch (e) {
          errors.push(`${file.name}: ${e instanceof Error ? e.message : e}`);
        }
      }
      emitCharactersChanged();
      await refresh();
      const got = `Loaded ${total} hero${total === 1 ? '' : 'es'}`;
      if (errors.length) {
        setStatus({ text: `${got}; ${errors.length} file(s) failed.`, error: true });
        alert(`Some files could not be loaded:\n\n${errors.join('\n')}`);
      } else {
        setStatus({ text: `${got}.` });
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
      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
        <h1 style={{ margin: 0 }} className="grow">Characters</h1>
        <button className="ghost" onClick={uploadHeroes} title="Load heroes from one or more files">
          Upload heroes
        </button>
        <button className="ghost" onClick={downloadAll} disabled={characters.length === 0} title="Download all heroes as one file">
          Download all
        </button>
        <button className="primary" onClick={onCreateNew}>+ New Character</button>
      </div>

      {status && (
        <div className="muted" style={{ marginTop: '-0.6rem', fontSize: '0.85rem', color: status.error ? 'var(--danger)' : undefined }}>
          {status.text}
        </div>
      )}

      {loading ? (
        <div className="placeholder">Loading…</div>
      ) : characters.length === 0 ? (
        <div className="card placeholder">
          No characters yet.<br />
          <button className="primary" onClick={onCreateNew} style={{ marginTop: '1rem' }}>
            Roll your first character
          </button>
          <div className="muted" style={{ marginTop: '0.75rem', fontSize: '0.85rem' }}>
            …or <button className="ghost" style={{ fontSize: '0.8rem' }} onClick={uploadHeroes}>upload heroes</button> you saved earlier.
          </div>
        </div>
      ) : (
        <div className="library-grid">
          {characters.map((c) => (
            <LibraryCard
              key={c.id}
              character={c}
              onOpen={() => onSelect(c)}
              onDuplicate={() => duplicate(c)}
              onDownload={() => downloadOne(c)}
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
  onDownload,
  onDelete,
}: {
  character: Character;
  onOpen: () => void;
  onDuplicate: () => void;
  onDownload: () => void;
  onDelete: () => void;
}) {
  const url = useArtUrl(character.portraitArtId);
  const ancestry = getAncestry(character.ancestryId);
  const cls = getClass(character.classId);
  const ac = characterCombatProfile(character).ac;
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
          HP {character.hp.current}/{character.hp.max} · AC {ac}
        </div>
      </div>
      <div className="row" style={{ gap: '0.3rem' }}>
        <button className="ghost grow" style={{ fontSize: '0.75rem' }} onClick={onDuplicate}>
          Duplicate
        </button>
        <button className="ghost" style={{ fontSize: '0.75rem' }} onClick={onDownload} title="Download this hero">
          Download
        </button>
        <button className="ghost" style={{ fontSize: '0.75rem', color: 'var(--danger)' }} onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}
