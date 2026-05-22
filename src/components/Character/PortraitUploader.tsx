import { useRef } from 'react';
import { useArtUrl } from '../../lib/hooks';
import { deleteArt, saveArt } from '../../lib/storage';

interface Props {
  artId: string | undefined;
  onChange: (artId: string | undefined) => void;
}

export function PortraitUploader({ artId, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const url = useArtUrl(artId);

  async function handleFile(file: File) {
    const id = await saveArt(file);
    if (artId) {
      try { await deleteArt(artId); } catch { /* ignore */ }
    }
    onChange(id);
  }

  async function clear() {
    if (artId) {
      try { await deleteArt(artId); } catch { /* ignore */ }
    }
    onChange(undefined);
  }

  return (
    <div className="col" style={{ alignItems: 'flex-start' }}>
      {url ? (
        <img src={url} alt="Portrait" className="portrait" />
      ) : (
        <div className="portrait">No portrait</div>
      )}
      <div className="row">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        <button onClick={() => inputRef.current?.click()}>
          {artId ? 'Replace' : 'Upload'}
        </button>
        {artId && (
          <button className="ghost" onClick={clear}>
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
