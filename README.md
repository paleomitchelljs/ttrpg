# Shadowdark Portal

A browser-only TTRPG companion focused on Shadowdark, designed to be hostable as a static site on GitHub Pages. All data lives locally in IndexedDB — characters and uploaded portrait art never leave your browser.

## Features

- **Character creator** — Roll up a Shadowdark Quickstart character: stats (3d6×6), ancestry, class, alignment, background, deity (priests), starting spells (casters), gear, gold, HP. Reroll any section. Manual override on any field.
- **Character library** — Saved characters with portrait thumbnails. Duplicate, delete, export/import the full library as JSON.
- **Character sheet** — Full read-only display of a saved character with class features, ancestry trait, spell descriptions, and notes.
- **Dice tab** — Standalone roller with parser for expressions like `2d6+3`, advantage/disadvantage on d20s, crit/fumble highlighting, history.
- **Enemies / Dungeons** — Scaffolded for future expansion.

## Local development

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:5173`.

```bash
npm run build      # production build to ./dist
npm run preview    # preview the built bundle
npm run typecheck  # TypeScript check
```

## Deploying to GitHub Pages

1. Push this repo to GitHub.
2. In **Settings → Pages**, set the source to **GitHub Actions**.
3. (Optional) If deploying as a **project page** at `https://<user>.github.io/<repo>/`, go to **Settings → Secrets and variables → Actions → Variables** and add a repository variable named `VITE_BASE` with value `/<repo>/` (e.g. `/shadowdark/`). Leave it unset for user pages.
4. Push to `main` — the included workflow at `.github/workflows/deploy.yml` builds and deploys automatically.

## Storage

- **Characters** live in IndexedDB under the `shadowdark-portal` database.
- **Portrait images** are also stored in IndexedDB as blobs (no localStorage size limits).
- Use the **Export** button in the Characters tab to download a full JSON backup (characters + art as base64). **Import** restores from such a backup.

Clearing your browser's site data will erase everything — use Export regularly.

## Extending to other systems

The rules data lives in `src/lib/shadowdark/` as plain TypeScript modules (ancestries, classes, backgrounds, deities, gear, spells, names). To add another system, mirror that structure in a new namespace and switch on the active system in the character creator.

## License

Rules content here is drawn from the freely available [Shadowdark Quickstart](https://www.thearcanelibrary.com/products/shadowdark-rpg-quickstart-set) by The Arcane Library, used for personal play. This project is not affiliated with or endorsed by The Arcane Library.
