import { useEffect, useState } from 'react';
import { CharacterCreator } from '../components/Character/CharacterCreator';
import { CharacterLibrary } from '../components/Character/CharacterLibrary';
import { CharacterSheet } from '../components/Character/CharacterSheet';
import { emitCharactersChanged } from '../lib/hooks';
import { deleteCharacter, getCharacter } from '../lib/storage';
import type { Character } from '../lib/shadowdark/types';

type View =
  | { kind: 'library' }
  | { kind: 'creating' }
  | { kind: 'editing'; character: Character }
  | { kind: 'viewing'; character: Character };

export function CharacterTab() {
  const [view, setView] = useState<View>({ kind: 'library' });

  // Refresh viewed/edited character if storage changes elsewhere.
  useEffect(() => {
    if (view.kind !== 'viewing') return;
    const handler = async () => {
      const fresh = await getCharacter(view.character.id);
      if (fresh) setView({ kind: 'viewing', character: fresh });
      else setView({ kind: 'library' });
    };
    window.addEventListener('portal:characters-changed', handler);
    return () => window.removeEventListener('portal:characters-changed', handler);
  }, [view]);

  if (view.kind === 'library') {
    return (
      <CharacterLibrary
        onSelect={(c) => setView({ kind: 'viewing', character: c })}
        onCreateNew={() => setView({ kind: 'creating' })}
      />
    );
  }

  if (view.kind === 'creating') {
    return (
      <CharacterCreator
        onSaved={(c) => setView({ kind: 'viewing', character: c })}
        onCancel={() => setView({ kind: 'library' })}
      />
    );
  }

  if (view.kind === 'editing') {
    return (
      <CharacterCreator
        initial={view.character}
        onSaved={(c) => setView({ kind: 'viewing', character: c })}
        onCancel={() => setView({ kind: 'viewing', character: view.character })}
      />
    );
  }

  return (
    <CharacterSheet
      character={view.character}
      onEdit={() => setView({ kind: 'editing', character: view.character })}
      onClose={() => setView({ kind: 'library' })}
      onDelete={async () => {
        if (!confirm(`Delete ${view.character.name}?`)) return;
        await deleteCharacter(view.character.id);
        emitCharactersChanged();
        setView({ kind: 'library' });
      }}
    />
  );
}
