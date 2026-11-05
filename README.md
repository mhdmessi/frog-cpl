# Frog Pickleball · CPL Team Hub (3.0 + 3.5)

Stats, partner chemistry, scouting and a lineup builder for both Frog Pickleball teams in the Cross Club Pickleball League (Chicago 3.0 and 3.5). Switch teams with the toggle at the top; links include `?team=3.5` so they open the right team.

- **Data**: game results from crossclubpickleball.com (its public read-only data feed) + the team availability Google Sheet (3.0 tab).
- **Build**: `python3 scripts/build_data.py` → writes `site/data-3.0.json`, `site/data-3.5.json`, `site/teams.json` (stdlib only, no installs). `--cache` reuses downloaded responses.
- **Site**: plain HTML/CSS/JS in `site/`. Preview locally: `cd site && python3 -m http.server` → http://localhost:8000
- **Live availability**: the page reads the sheet directly each time it opens (`liveSheet` in `site/app.js`), so Yes/No changes show up on reload. New players still need the rebuild (and a CPL roster entry) before they can be picked.
- **Sit-out requests**: a number after Yes in a sheet cell (`Yes 3`, `Yes - sit 3`, `sit 3`) means that player wants to sit out that many of the 8 games. The Game Plan also has a per-player "Sits N" picker (saved on that device).
- **Hosting**: GitHub Pages. `.github/workflows/update.yml` rebuilds the data every 2 hours Wed–Sat Chicago time (roster and lineup week) and every 3 hours Sun–Tue and on every push, so sheet edits and new results show up automatically. Force a refresh from the repo's Actions tab → "Run workflow".

## Tweaks
In `scripts/build_data.py`:
- `ALIASES` — fix a sheet name that doesn't match the CPL roster name.
- `TEAMS` — division → Google Sheet tab (gid). Add a line here to add another team.
- `RIDGE` / `PAIR_SHRINK` — how cautious ratings/chemistry are with small samples.

New season: the script auto-picks the newest active Chicago 3.0 division; update `SHEET_GID` if the sheet tab changes.
