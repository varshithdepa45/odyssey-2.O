# Odyssey

A Sherlock Holmes-flavoured campus codehunt. Detective agencies (teams) sign in, read a riddle, find the location on campus, and enter the passcode they discover there to decrypt the next case file. A live leaderboard ranks every agency, and a public intel feed — The Wire — lets them help or mislead each other.

## How it plays

1. **Sign in** (Firebase email/password) and **name your agency**. One agency per account.
2. **Vault** — the open clue sits in the decryption vault; the rest are sealed. Enter the passcode found at the scene to breach it (+100 pts) and decrypt the next one.
3. **The Wire** — a live terminal feed. Any enrolled agency can post intel and optionally attach a map pin. Nothing marks a post as true, so pins can be bluffs.
4. **Map** — your unlocked clues (green = open target, blue = breached) plus every pinned Wire post (amber diamonds). Sealed clues never appear.
5. **Leaderboard** — live from Firestore, ranked by points; ties go to whoever solved their latest clue first.

## Running it

There is no build step. Serve the folder over HTTP and open `index.html`:

```bash
python3 -m http.server 8000
```

Passcode checking uses `crypto.subtle`, which browsers only expose on `https://` or `localhost`.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page shell, fonts, Tailwind/Leaflet/Babel CDN tags |
| `src/app.jsx` | The whole app (React, loaded as an ES module) |
| `src/styles.css` | HUD theme, 3D tilt, backdrop, terminal, vault, map pins |

## Setting up a hunt

See [FIREBASE_SETUP.md](FIREBASE_SETUP.md) for the Firestore schema, security rules, and how to add clues.

## 3D and motion

- `Tilt` in `src/app.jsx` is the cursor-tracking tilt wrapper. It writes `--rx`/`--ry`/`--mx`/`--my` on pointer move; `.tn-tilt` in `src/styles.css` turns them into the transform and glare. Children with `.tn-z1`–`.tn-z3` float above the tilting face.
- `CyberBackground` draws the particle field and feeds the cursor position to the grid and spotlight.
- The Leaflet map is intentionally not tilted: a 3D rotation on an ancestor makes Leaflet's clicks and drags land in the wrong place.
- All of it switches off under `prefers-reduced-motion`.

Set `MAP_CENTER` near the top of `src/app.jsx` to your campus; the map re-fits to your clue pins once they load.
