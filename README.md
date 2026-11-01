# Frog Pickleball · CPL 3.0 Team Hub

Stats, partner chemistry, scouting and a lineup builder for Frog Pickleball in the Cross Club Pickleball League (Chicago 3.0).

- **Data**: game results from crossclubpickleball.com (its public read-only data feed) + the team availability Google Sheet (3.0 tab).
- **Build**: `python3 scripts/build_data.py` → writes `site/data.json` (stdlib only, no installs). `--cache` reuses downloaded responses.
- **Site**: plain HTML/CSS/JS in `site/`. Preview locally: `cd site && python3 -m http.server` → http://localhost:8000
- **Hosting**: GitHub Pages. `.github/workflows/update.yml` rebuilds the data every 3 hours (hourly Thu–Sat, when opponent lineups get posted) and on every push, so sheet edits and new results show up automatically. Force a refresh from the repo's Actions tab → "Run workflow".

## Tweaks
In `scripts/build_data.py`:
- `ALIASES` — fix a sheet name that doesn't match the CPL roster name.
- `SHEET_GID` — the sheet tab to read (3.0 tab).
- `RIDGE` / `PAIR_SHRINK` — how cautious ratings/chemistry are with small samples.

New season: the script auto-picks the newest active Chicago 3.0 division; update `SHEET_GID` if the sheet tab changes.
