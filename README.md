# RPG Portal

A browser-only TTRPG companion built around Shadowdark, made for playing at the table with kids — physical Legos are the miniatures and scenery, and the app handles the bookkeeping. It is a static site (hostable on GitHub Pages) with no backend: characters, encounters, and uploaded portrait art live in IndexedDB and never leave your browser.

It is deliberately **not** a virtual tabletop. No grid, no tokens, no fog of war — the Legos do that. The app answers "what do I roll?", "how many HP does the ogre have left?", and "what's in the next room?"

## Tabs

- **Heroes** — Roll up a Shadowdark Quickstart character (stats, ancestry, class, background, deity, spells, gear), reroll any section, or override any field by hand. Saved heroes get a big-button sheet: HP/AC/Attack HUD tiles, tap-to-roll attacks and stat checks (damage rolls automatically, so a kid sees the number to subtract), equipment slots that recompute AC. The library supports portraits, duplicate/delete, and per-hero or full-library JSON download/upload.
- **Monsters** — An encounter tracker. Tap monsters from the library into an encounter, tick HP up and down, tap an attack to roll it (with damage). One-tap random encounters by tier, scoped to the active pool.
- **Adventure** — Scripted, offline text adventures: pick one of 13 modules (the Sunless Citadel plus EverQuest classics like Permafrost, Kaesora, and the City of Mist), choose up to 4 heroes, and play with tappable action chips or typed commands. Light Shadowdark combat, spellcasting, parley with stacking bonuses, dungeon scaling to party level, and one autosave slot. A TPK never harms saved heroes — in-game HP is separate from the sheets. The same tab also has a **random quest generator** for playing out loud: it stitches a one-session storyboard (a goal, a GM-only twist, 4 or 7 rooms with read-aloud prose) from rooms sampled across every module, with monsters pre-statted for Brick Quest, plus rolled traps and treasure. The collapsible GM quick tools roll scenes, treasure, and traps, and open reference maps.
- **Dice** — Big dice tiles (d4–d20), Lucky/Bad luck (advantage/disadvantage) on d20s, custom expressions like `2d6+3`, crit/fumble highlighting, roll history shared with the rest of the app.
- **Rules** — Reference for 18 rulesets, from the live Shadowdark engine to open-license systems (5e SRD, Pathfinder, OSR retroclones, GURPS Lite, Fate, and more). Reference-only systems are labeled — engine play always resolves in Shadowdark. The exception is **Brick Quest**, the app's own kid ruleset for out-loud play: seven stats in attack/defense pairs (Sword/Shield, Spark/Ward) plus Wisdom, Dexterity, and Charisma for tricks, one d20 against three target numbers, hearts instead of hit points, and feats instead of classes. Knocked-out heroes always wake up.

## Data lives in YAML

All game content is hand-editable YAML under `src/data/` — no code changes needed to add content:

- `items.yaml`, `monsters.yaml`, `treasure.yaml`, `traps.yaml`, `scenes.yaml`, `spells.yaml`, `maps.yaml` — per-entry content, each tagged with `system`/`source_book` and theme tags.
- `adventures/*.yaml` — authored room graphs for the Adventure tab. Add a file, register it in `src/lib/adventure/data.ts`.
- `rules/*.yaml` — one file per ruleset for the Rules tab. Add a file, register it in `src/lib/rules.ts`.
- `active_pool.yaml` + `tags.yaml` — named filter pools and the tag taxonomy. The active pool decides what random scene/treasure/trap/encounter rolls can serve up (e.g. `shadowdark-only`, `everquest-classic`, `kid-easy`).

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

- **Heroes, encounters, and the adventure autosave** live in IndexedDB under the `shadowdark-portal` database.
- **Portrait images** are stored in IndexedDB as blobs (no localStorage size limits).
- Use **Download all** on the Heroes tab for a full JSON backup (heroes + art as base64); **Upload heroes** restores from one or more such files.

Clearing your browser's site data will erase everything — download a backup regularly.

## License

Shadowdark rules content is drawn from the freely available [Shadowdark Quickstart](https://www.thearcanelibrary.com/products/shadowdark-rpg-quickstart-set) by The Arcane Library, used for personal play. Other rulesets are summarized from their open/free licenses (OGL, ORC, CC) as noted per file in `src/data/rules/`. This project is not affiliated with or endorsed by any publisher.
