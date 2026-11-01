#!/usr/bin/env python3
"""Build site/data.json for the Frog Pickleball CPL dashboard.

Pulls:
  * CPL league data (the same public read-only feed crossclubpickleball.com uses)
  * The team's Google Sheet (roster + who opted in each week)

Computes player ratings, partner chemistry, scouting, and plain-English insights.
Standard library only, so it runs anywhere (including GitHub Actions) with no installs.

Usage:  python3 scripts/build_data.py            # live fetch
        python3 scripts/build_data.py --cache     # reuse .cache/ responses (dev)
"""
import csv
import difflib
import io
import json
import math
import os
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

# ---------------------------------------------------------------- config
REGION = "Chicago"
DIVISION = "3.0"
TEAM = "Frog Pickleball"
SHEET_ID = "1oryl5QhVVxbcyqrzd3Kizk7UMgui8Beq1uzTcYPBBPA"
SHEET_GID = "993438883"  # the "3.0" tab
API = "https://cplsecureapiproxy.azurewebsites.net/api/CPLSecureApiProxy/v0/api"

# Sheet name -> CPL "First Last" when automatic matching gets it wrong.
ALIASES = {
    # "Sheet Name": "Cpl Name",
}

RIDGE = 7.0      # how strongly ratings shrink toward average (bigger = more cautious)
PAIR_SHRINK = 3.0  # same idea for partner chemistry
MIN_PAIR_GAMES = 2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, ".cache")
USE_CACHE = "--cache" in sys.argv


# ---------------------------------------------------------------- fetching
def get(url, key):
    path = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9_.-]", "_", key))
    if USE_CACHE and os.path.exists(path):
        with open(path, "rb") as f:
            return f.read()
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "frog-cpl-dashboard", "Accept": "application/json, text/csv"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "wb") as f:
        f.write(body)
    return body


def resolve_refs(o, ids=None):
    """The API uses .NET $id/$ref JSON; turn it back into plain objects."""
    if ids is None:
        ids = {}
    if isinstance(o, dict):
        if "$ref" in o:
            return ids.get(o["$ref"], o)
        if "$id" in o:
            ids[o["$id"]] = o
        for k in list(o):
            o[k] = resolve_refs(o[k], ids)
        if set(o) <= {"$id", "$values"} and "$values" in o:
            return o["$values"]
    elif isinstance(o, list):
        for i, v in enumerate(o):
            o[i] = resolve_refs(v, ids)
    return o


def api(path, key=None):
    return resolve_refs(json.loads(get(API + path, key or path)))


# ---------------------------------------------------------------- helpers
def full_name(p):
    first = (p.get("firstName") or "").strip()
    last = (p.get("lastName") or "").strip()
    name = f"{first} {last}".strip()
    return " ".join(w if not w.isupper() and not w.islower() else w.capitalize() for w in name.split())


def norm(s):
    s = re.sub(r"\(.*?\)", " ", s or "")
    s = re.sub(r"[^a-z ]", " ", s.lower().replace("-", " "))
    return " ".join(s.split())


def pct(w, n):
    return round(100 * w / n, 1) if n else None


def win_prob(margin, sigma):
    return 1 / (1 + math.exp(-margin / sigma))


# ---------------------------------------------------------------- main build
def main():
    print("Finding division…")
    regions = api(f"/regions?latitude=41.88&longitude=-87.63", "regions")
    divisions = [d for r in regions if r["location"] == REGION for d in (r.get("divisions") or [])
                 if d["divisionName"] == DIVISION and d.get("active")]
    divisions.sort(key=lambda d: (d["seasonYear"], d["seasonNumber"]), reverse=True)
    div = divisions[0]
    div_id = div["divisionId"]
    season_label = f"Season {div['seasonNumber']} · {div['seasonYear']}"

    print("Downloading players, standings, matchups…")
    players = api(f"/divisions/{div_id}/players")
    standings = api(f"/divisions/{div_id}/standings")
    matchups = api(f"/divisions/{div_id}/matchups")
    try:
        playoff_matchups = api(f"/divisions/{div_id}/matchups?playoffs=true", f"matchups_playoffs_{div_id}")
    except Exception:  # noqa: BLE001
        playoff_matchups = []
    all_matchups = {m["matchupId"]: m for m in list(matchups) + list(playoff_matchups or [])}

    pmap = {p["playerId"]: p for p in players}
    team_of = {p["playerId"]: p.get("teamName") for p in players}
    team_ids = {}
    for m in all_matchups.values():
        team_ids[m["homeTeamId"]] = m["homeName"]
        team_ids[m["awayTeamId"]] = m["awayName"]
    frog_id = next(t for t, n in team_ids.items() if n == TEAM)

    # -------- every completed game in the division (needed for fair ratings)
    games = []
    played = [m for m in all_matchups.values() if (m.get("homePoints") or 0) + (m.get("awayPoints") or 0) > 0]
    print(f"Downloading {len(played)} completed matches…")
    match_meta = {}
    for m in sorted(played, key=lambda m: m["scheduledTime"]):
        detail = api(f"/divisions/{div_id}/matchups/{m['matchupId']}", f"matchup_{m['matchupId']}")
        lineups = detail.get("lineups") or {}
        rows = lineups.get("lineups") if isinstance(lineups, dict) else lineups
        # players who appear only in match detail (e.g. removed later)
        for ps in detail.get("matchupPlayerStats") or []:
            if ps["playerId"] not in pmap:
                pmap[ps["playerId"]] = dict(ps, duprRating=None, teamName=team_ids.get(ps.get("teamId")))
                team_of[ps["playerId"]] = team_ids.get(ps.get("teamId"))
        hw = aw = 0
        for g in rows or []:
            hs, as_ = g.get("homeScore"), g.get("awayScore")
            if hs is None or as_ is None or (hs == 0 and as_ == 0):
                continue
            if not all(g.get(k) for k in ("homePlayerId1", "homePlayerId2", "awayPlayerId1", "awayPlayerId2")):
                continue
            hw += hs > as_
            aw += as_ > hs
            games.append({
                "matchupId": m["matchupId"], "week": m["weekNumber"], "n": g["gameNumber"],
                "type": g["matchType"],
                "home": m["homeTeamId"], "away": m["awayTeamId"],
                "h": [g["homePlayerId1"], g["homePlayerId2"]], "a": [g["awayPlayerId1"], g["awayPlayerId2"]],
                "hs": hs, "as": as_,
            })
        match_meta[m["matchupId"]] = {"homeGames": hw, "awayGames": aw}

    # -------- does the match go to total points or games won?
    by_points = by_games = decided = 0
    for m in played:
        mm = match_meta[m["matchupId"]]
        if m["endResult"] not in ("home", "away"):
            continue
        pts_winner = "home" if m["homePoints"] > m["awayPoints"] else "away"
        g_winner = "home" if mm["homeGames"] > mm["awayGames"] else "away"
        if pts_winner != g_winner:
            decided += 1
            by_points += pts_winner == m["endResult"]
            by_games += g_winner == m["endResult"]
    scoring_rule = "points" if by_points > by_games else ("games" if by_games > by_points else "unknown")

    # -------- ratings: ridge regression on point margin, all division games
    # margin(game) ~= (r1 + r2) - (r3 + r4); r = points/game a player adds vs league average
    r, plays = fit_ratings(games)
    ids = sorted(r)

    def pred_margin(g):
        return sum(r[x] for x in g["h"]) - sum(r[x] for x in g["a"])

    # sigma for margin -> win probability, calibrated out-of-sample:
    # rate players WITHOUT match X, predict match X, repeat for every match.
    oos = []
    for mid in {g["matchupId"] for g in games}:
        train = [g for g in games if g["matchupId"] != mid]
        rt, _ = fit_ratings(train, iters=120)
        for g in games:
            if g["matchupId"] == mid:
                pm = sum(rt.get(x, 0) for x in g["h"]) - sum(rt.get(x, 0) for x in g["a"])
                oos.append((pm, g["hs"] - g["as"]))
    best = (None, -1e18)
    for sigma_try in [x / 4 for x in range(6, 80)]:
        ll = 0.0
        for pm, actual in oos:
            pw = min(max(win_prob(pm, sigma_try), 1e-6), 1 - 1e-6)
            ll += math.log(pw if actual > 0 else 1 - pw)
        if ll > best[1]:
            best = (sigma_try, ll)
    sigma = best[0]
    resid_sd = math.sqrt(sum((a - pm) ** 2 for pm, a in oos) / len(oos))
    oos_acc = round(100 * sum((pm > 0) == (a > 0) for pm, a in oos if pm != 0) / max(1, sum(pm != 0 for pm, _ in oos)), 1)

    # players with no CPL games yet: estimate from DUPR (fit across the division)
    xy = [(pmap[pid].get("duprRating"), r[pid]) for pid in ids
          if pid in pmap and pmap[pid].get("duprRating") and len(plays[pid]) >= 8]
    if len(xy) >= 10:
        mx = sum(x for x, _ in xy) / len(xy)
        my = sum(y for _, y in xy) / len(xy)
        slope = sum((x - mx) * (y - my) for x, y in xy) / sum((x - mx) ** 2 for x, _ in xy)
        dupr_fit = {"slope": round(slope, 2), "intercept": round(my - slope * mx, 2), "n": len(xy)}
    else:
        dupr_fit = None
    estimated = set()
    for pid, p in pmap.items():
        if pid not in r:
            d = p.get("duprRating")
            r[pid] = (dupr_fit["intercept"] + dupr_fit["slope"] * d) * 0.6 if (d and dupr_fit) else -1.0
            estimated.add(pid)

    # rank within division (min 6 games)
    ranked = sorted([pid for pid in ids if len(plays[pid]) >= 6], key=lambda p: -r[p])
    div_rank = {pid: i + 1 for i, pid in enumerate(ranked)}

    # -------- Frog games from our perspective
    fgames = []
    for g in games:
        if frog_id not in (g["home"], g["away"]):
            continue
        home = g["home"] == frog_id
        us, them = (g["h"], g["a"]) if home else (g["a"], g["h"])
        us_s, them_s = (g["hs"], g["as"]) if home else (g["as"], g["hs"])
        exp = pred_margin(g) * (1 if home else -1)
        fgames.append({
            "matchupId": g["matchupId"], "week": g["week"], "n": g["n"], "type": g["type"],
            "opp": team_ids[g["away"] if home else g["home"]],
            "us": us, "them": them, "usScore": us_s, "themScore": them_s,
            "won": us_s > them_s, "expMargin": round(exp, 1),
        })

    # player game logs (computed from games so they always match the data)
    def blank():
        return {"g": 0, "w": 0, "pf": 0, "pa": 0, "mixG": 0, "mixW": 0, "genG": 0, "genW": 0, "clG": 0, "clW": 0}
    pstat = defaultdict(blank)
    for g in fgames:
        close = abs(g["usScore"] - g["themScore"]) <= 3
        for pid in g["us"]:
            s = pstat[pid]
            s["g"] += 1
            s["w"] += g["won"]
            s["pf"] += g["usScore"]
            s["pa"] += g["themScore"]
            if g["type"] == "mixed":
                s["mixG"] += 1
                s["mixW"] += g["won"]
            else:
                s["genG"] += 1
                s["genW"] += g["won"]
            if close:
                s["clG"] += 1
                s["clW"] += g["won"]

    # -------- partner chemistry
    pairs = {}
    for g in fgames:
        key = tuple(sorted(g["us"]))
        p = pairs.setdefault(key, {"a": key[0], "b": key[1], "type": g["type"], "g": 0, "w": 0, "pf": 0, "pa": 0, "resid": 0.0, "weeks": set()})
        p["g"] += 1
        p["w"] += g["won"]
        p["pf"] += g["usScore"]
        p["pa"] += g["themScore"]
        p["resid"] += (g["usScore"] - g["themScore"]) - g["expMargin"]
        p["weeks"].add(g["week"])
    pair_list = []
    for p in pairs.values():
        syn = p["resid"] / (p["g"] + PAIR_SHRINK)
        strength = r.get(p["a"], 0) + r.get(p["b"], 0) + syn
        pair_list.append({
            "a": p["a"], "b": p["b"], "type": p["type"], "g": p["g"], "w": p["w"], "l": p["g"] - p["w"],
            "pf": p["pf"], "pa": p["pa"], "diff": round((p["pf"] - p["pa"]) / p["g"], 1),
            "chem": round(syn, 2), "strength": round(strength, 2),
            "winProb": round(win_prob(strength, sigma), 3), "weeks": sorted(p["weeks"]),
        })
    pair_list.sort(key=lambda p: -p["strength"])

    # -------- every pair in the division (needed to rate opponents' pairs)
    lp = defaultdict(lambda: [0, 0.0])
    for g in games:
        pm = pred_margin(g)
        for side, sgn in ((g["h"], 1), (g["a"], -1)):
            k = "|".join(sorted(side))
            lp[k][0] += 1
            lp[k][1] += sgn * ((g["hs"] - g["as"]) - pm)
    all_pairs = {k: round(r.get(k.split("|")[0], 0) + r.get(k.split("|")[1], 0) + v[1] / (v[0] + PAIR_SHRINK), 2)
                 for k, v in lp.items()}

    # -------- every team's game-by-game lineups (scorecards) + strength by game type
    lineups_by_team = defaultdict(list)
    type_use = defaultdict(lambda: defaultdict(list))  # team -> type -> [pair strengths used]
    for mid in match_meta:
        m = all_matchups[mid]
        rows_ = sorted([g for g in games if g["matchupId"] == mid], key=lambda g: g["n"])
        for side in ("home", "away"):
            team_name = m["homeName"] if side == "home" else m["awayName"]
            mine, theirs = ("h", "a") if side == "home" else ("a", "h")
            sc_mine, sc_theirs = ("hs", "as") if side == "home" else ("as", "hs")
            lineups_by_team[team_name].append({
                "week": m["weekNumber"], "opp": m["awayName"] if side == "home" else m["homeName"],
                "games": [[g["n"], g[mine], g[theirs], g[sc_mine], g[sc_theirs]] for g in rows_],
            })
            for g in rows_:
                type_use[team_name][g["type"]].append(all_pairs["|".join(sorted(g[mine]))])
    for v in lineups_by_team.values():
        v.sort(key=lambda x: x["week"])
    type_strength = {t: {ty: round(sum(v) / len(v), 2) for ty, v in tv.items()} for t, tv in type_use.items()}
    # full spread of pairs each team fields per game type (13 quantiles) — planning against the
    # average alone is overconfident because strong pairs show up too
    def quantiles(v, k=13):
        v = sorted(v)
        return [round(v[min(len(v) - 1, int((i + 0.5) * len(v) / k))], 2) for i in range(k)]
    type_dist = {t: {ty: quantiles(v) for ty, v in tv.items()} for t, tv in type_use.items()}

    # games each player got per match (playing time)
    playing_time = defaultdict(dict)
    for g in fgames:
        for pid in g["us"]:
            playing_time[g["week"]][pid] = playing_time[g["week"]].get(pid, 0) + 1

    # -------- Google Sheet availability
    print("Reading Google Sheet…")
    raw = get(f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv&gid={SHEET_GID}", f"sheet_{SHEET_GID}.csv")
    rows = list(csv.reader(io.StringIO(raw.decode("utf-8"))))
    sheet = parse_sheet(rows)

    frog_players = [p for pid, p in pmap.items() if team_of.get(pid) == TEAM or pid in pstat]
    name_to_pid, unmatched = match_names(sheet["players"], frog_players)

    # -------- schedule from CPL (source of truth) + sheet availability
    sched = []
    for m in sorted([m for m in all_matchups.values() if frog_id in (m["homeTeamId"], m["awayTeamId"])],
                    key=lambda m: m["scheduledTime"]):
        home = m["homeTeamId"] == frog_id
        mm = match_meta.get(m["matchupId"], {})
        done = (m.get("homePoints") or 0) + (m.get("awayPoints") or 0) > 0
        us_pts, them_pts = (m["homePoints"], m["awayPoints"]) if home else (m["awayPoints"], m["homePoints"])
        us_g, them_g = (mm.get("homeGames"), mm.get("awayGames")) if home else (mm.get("awayGames"), mm.get("homeGames"))
        result = None
        if done and m.get("endResult") in ("home", "away"):
            result = "W" if (m["endResult"] == "home") == home else "L"
        wk = sheet["weeks"].get(m["weekNumber"], {})
        sched.append({
            "week": m["weekNumber"], "matchupId": m["matchupId"], "time": m["scheduledTime"],
            "opp": m["awayName"] if home else m["homeName"], "home": home, "playoffs": bool(m.get("playoffs")),
            "done": done, "result": result, "usPts": us_pts if done else None, "themPts": them_pts if done else None,
            "usGames": us_g if done else None, "themGames": them_g if done else None,
            "address": m.get("address") or wk.get("address"),
            "avail": {name_to_pid.get(n, "sheet:" + n): v for n, v in wk.get("avail", {}).items()},
        })

    # -------- lineups already posted for upcoming matches (opponents post 1-2 days before)
    posted = {}
    for srow in sched:
        if srow["done"]:
            continue
        try:
            det = api(f"/divisions/{div_id}/matchups/{srow['matchupId']}", f"upcoming_{srow['matchupId']}_{int(time.time() // 1800)}")
        except Exception:  # noqa: BLE001
            continue
        lu = det.get("lineups") or {}
        raw_rows = lu.get("lineups") if isinstance(lu, dict) else lu
        entry = {"us": [None] * 32, "them": [None] * 32}
        for g in raw_rows or []:
            n = g.get("gameNumber")
            if n is None or not 0 <= n < 32:
                continue
            hp = [g.get("homePlayerId1"), g.get("homePlayerId2")]
            ap = [g.get("awayPlayerId1"), g.get("awayPlayerId2")]
            us_p, them_p = (hp, ap) if srow["home"] else (ap, hp)
            entry["us"][n] = us_p if all(us_p) else None
            entry["them"][n] = them_p if all(them_p) else None
        for side in entry.values():
            for pr in side:
                for pid in pr or []:
                    r.setdefault(pid, -1.0)
        if any(entry["us"]) or any(entry["them"]):
            posted[srow["matchupId"]] = entry

    # -------- player table
    out_players = []
    pid_to_sheet = {v: k for k, v in name_to_pid.items()}
    for p in frog_players:
        pid = p["playerId"]
        s = pstat.get(pid, blank())
        out_players.append({
            "id": pid, "name": full_name(p), "gender": p.get("gender"),
            "dupr": p.get("duprRating"), "duprId": p.get("dupr"), "duprProbation": p.get("duprProbation"),
            "isSub": bool(p.get("isSub")), "isCaptain": bool(p.get("isCaptain")), "subCount": p.get("subCount") or 0,
            "sheetName": pid_to_sheet.get(pid),
            "rating": round(r[pid], 2) if pid in r else None, "ratingEst": pid in estimated, "divRank": div_rank.get(pid), "divRanked": len(ranked),
            "g": s["g"], "w": s["w"], "l": s["g"] - s["w"], "winPct": pct(s["w"], s["g"]),
            "ppg": round(s["pf"] / s["g"], 1) if s["g"] else None,
            "diff": round((s["pf"] - s["pa"]) / s["g"], 1) if s["g"] else None,
            "mixG": s["mixG"], "mixW": s["mixW"], "genG": s["genG"], "genW": s["genW"],
            "clG": s["clG"], "clW": s["clW"],
        })
    out_players.sort(key=lambda p: (p["rating"] is None, -(p["rating"] or 0)))

    # sheet-only people (no CPL record yet)
    sheet_only = [n for n in sheet["players"] if n not in name_to_pid]

    # -------- league table + opponent scouting
    stand = sorted(standings, key=lambda t: t.get("ranking") or 99)
    out_stand = [{
        "team": t["teamName"], "rank": t.get("ranking"), "record": t.get("record"), "w": t.get("wins"), "l": t.get("losses"),
        "gameRecord": t.get("gameRecord"), "gameWinRate": t.get("gameWinRate"), "pointDiff": t.get("teamPointDiff"),
        "mixed": t.get("mixedRecord"), "mens": t.get("mensRecord"), "womens": t.get("womensRecord"),
        "mixedRate": t.get("mixedWinRate"), "mensRate": t.get("menWinRate"), "womensRate": t.get("womenWinRate"),
        "clutch": t.get("clutchRecord"), "ppg": t.get("averagePointsPerGame"), "isUs": t["teamName"] == TEAM,
    } for t in stand]

    scouting = {}
    for team_name in {s["opp"] for s in sched}:
        tid = next((t for t, n in team_ids.items() if n == team_name), None)
        tgames = [g for g in games if tid in (g["home"], g["away"])]
        cnt = defaultdict(int)
        tpairs = {}
        for g in tgames:
            side = g["h"] if g["home"] == tid else g["a"]
            won = (g["hs"] > g["as"]) == (g["home"] == tid)
            for pid in side:
                cnt[pid] += 1
            key = tuple(sorted(side))
            tp = tpairs.setdefault(key, {"g": 0, "w": 0, "type": g["type"], "diff": 0})
            tp["g"] += 1
            tp["w"] += won
            tp["diff"] += (g["hs"] - g["as"]) * (1 if g["home"] == tid else -1)
        roster = sorted(cnt, key=lambda x: -cnt[x])
        tot = sum(cnt.values()) or 1
        avg_pair = 2 * sum(r.get(x, 0) * c for x, c in cnt.items()) / tot
        scouting[team_name] = {
            "avgPair": round(avg_pair, 2),
            "players": [{"name": full_name(pmap[x]), "gender": pmap[x].get("gender"), "games": cnt[x],
                         "rating": round(r.get(x, 0), 2), "dupr": pmap[x].get("duprRating")}
                        for x in sorted(roster, key=lambda x: -r.get(x, 0))],
            "pairs": sorted([{"ids": list(k), "names": [full_name(pmap[a]) for a in k], "type": v["type"], "g": v["g"], "w": v["w"],
                              "diff": round(v["diff"] / v["g"], 1), "strength": all_pairs.get("|".join(k), 0)}
                             for k, v in tpairs.items() if v["g"] >= 2], key=lambda x: -x["strength"]),
            "typeStrength": type_strength.get(team_name, {}),
            "notes": scout_notes(team_name, type_strength, tpairs, cnt, r, pmap, lineups_by_team.get(team_name, [])),
            "h2h": [{"week": s["week"], "result": s["result"], "us": s["usPts"], "them": s["themPts"],
                     "usGames": s["usGames"], "themGames": s["themGames"]}
                    for s in sched if s["opp"] == team_name and s["done"]],
        }

    data = {
        "generated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
        "team": TEAM, "division": f"{REGION} {DIVISION}", "season": season_label,
        "scoringRule": scoring_rule, "scoringEvidence": {"disagreements": decided, "byPoints": by_points, "byGames": by_games},
        "model": {"ridge": RIDGE, "pairShrink": PAIR_SHRINK, "sigma": sigma, "residSd": round(resid_sd, 2), "oosAccuracy": oos_acc, "games": len(games), "duprFit": dupr_fit},
        "standings": out_stand, "schedule": sched, "players": out_players, "pairs": pair_list,
        "games": [{**g, "them": [full_name(pmap[x]) if x in pmap else "?" for x in g["them"]]} for g in fgames],
        "allPairs": all_pairs, "typeStrength": type_strength, "typeDist": type_dist,
        "league": {pid: {"n": full_name(p), "g": "M" if p.get("gender") == "Male" else "W", "t": team_of.get(pid), "r": round(r.get(pid, -1.0), 2),
                         "d": p.get("duprRating")} for pid, p in pmap.items()},
        "lineups": lineups_by_team, "posted": posted,
        "playingTime": playing_time,
        "sheetOnly": sheet_only, "unmatched": unmatched, "scouting": scouting,
        "sheetUrl": f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit#gid={SHEET_GID}",
    }
    data["insights"] = insights(data, sigma)

    os.makedirs(os.path.join(ROOT, "site"), exist_ok=True)
    with open(os.path.join(ROOT, "site", "data.json"), "w") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"Wrote site/data.json: {len(games)} division games, {len(fgames)} Frog games, "
          f"{len(out_players)} players, {len(pair_list)} pairs, scoring rule = {scoring_rule}")
    if unmatched:
        print("  Sheet names not matched to CPL:", ", ".join(unmatched))


def scout_notes(team, type_strength, tpairs, cnt, r, pmap, lineups):
    """Plain-English takeaways about an opponent."""
    notes = []
    firsts = defaultdict(int)
    for x in cnt:
        firsts[full_name(pmap[x]).split()[0]] += 1

    def short(x):
        parts = full_name(pmap[x]).split()
        return f"{parts[0]} {parts[1][0]}." if firsts[parts[0]] > 1 and len(parts) > 1 else parts[0]
    ts, us = type_strength.get(team, {}), type_strength.get(TEAM, {})
    label = {"mixed": "mixed", "male": "men's", "female": "women's"}
    if ts and us:
        gaps = sorted(((ts[t] - us.get(t, 0), t) for t in ts), key=lambda x: x[0])
        best_for_us, worst_for_us = gaps[0], gaps[-1]
        notes.append(f"Our best shot is {label[best_for_us[1]]} games: their typical {label[best_for_us[1]]} pair is "
                     + (f"{abs(best_for_us[0]):.1f} pts/game weaker than ours." if best_for_us[0] < 0 else f"only {best_for_us[0]:.1f} pts/game stronger than ours."))
        if worst_for_us[0] > 1:
            notes.append(f"Toughest area: {label[worst_for_us[1]]} (their pairs are ~{worst_for_us[0]:.1f} pts/game stronger).")
    good = sorted([(v["w"] / v["g"], v["g"], k, v) for k, v in tpairs.items() if v["g"] >= 3], key=lambda x: (-x[0], -x[1]))
    if good and good[0][0] >= 0.6:
        _, _, k, v = good[0]
        notes.append(f"Their go-to pair: {' + '.join(short(x) for x in k)} ({v['w']}-{v['g'] - v['w']} together).")
    bad = [x for x in good if x[0] <= 0.34]
    if bad:
        _, _, k, v = bad[-1]
        notes.append(f"They keep using {' + '.join(short(x) for x in k)} even though they're {v['w']}-{v['g'] - v['w']} together — a pair to target.")
    if lineups:
        per = defaultdict(list)
        for lu in lineups:
            c = defaultdict(int)
            for _, mine, _, _, _ in lu["games"]:
                for pid in mine:
                    c[pid] += 1
            for pid, n in c.items():
                per[pid].append(n)
        core = sorted(per, key=lambda x: -sum(per[x]))[:3]
        notes.append("Players they lean on most: " + ", ".join(f"{short(x)} (~{sum(per[x]) / len(per[x]):.0f} games/match)" for x in core) + ".")
    return notes


def fit_ratings(games, iters=300):
    ids = sorted({pid for g in games for pid in g["h"] + g["a"]})
    r = {pid: 0.0 for pid in ids}
    plays = defaultdict(list)
    for gi, g in enumerate(games):
        for pid in g["h"]:
            plays[pid].append((gi, 1))
        for pid in g["a"]:
            plays[pid].append((gi, -1))
    for _ in range(iters):
        for pid in ids:
            num = 0.0
            for gi, sgn in plays[pid]:
                g = games[gi]
                pred_wo = sum(r[x] for x in g["h"]) - sum(r[x] for x in g["a"]) - sgn * r[pid]
                num += sgn * ((g["hs"] - g["as"]) - pred_wo)
            r[pid] = num / (len(plays[pid]) + RIDGE)
        mean = sum(r.values()) / len(r)
        for pid in ids:
            r[pid] -= mean
    return r, plays


def parse_sheet(rows):
    header_i = next(i for i, row in enumerate(rows) if row and row[0].strip().lower() == "week")
    header = rows[header_i]
    end = next((i for i, h in enumerate(header) if "match info" in h.lower()), len(header))
    cols = [(i, " ".join(header[i].split())) for i in range(2, end) if header[i].strip()]
    addr_col = next((i for i, h in enumerate(header) if h.strip().lower() == "address"), None)
    weeks = {}
    for row in rows[header_i + 1:]:
        if not row or not row[0].strip():
            break
        m = re.match(r"week\s*(\d+)", row[0].strip().lower())
        if not m:
            continue
        avail = {}
        for i, name in cols:
            v = (row[i] if i < len(row) else "").strip().lower()
            v = {"yes": "yes", "y": "yes", "no": "no", "n": "no", "maybe": "maybe"}.get(v, v or "")
            if v:
                avail[name] = v
        weeks[int(m.group(1))] = {"date": row[1].strip(), "avail": avail,
                                  "address": row[addr_col].strip() if addr_col is not None and addr_col < len(row) else None}
    return {"players": [n for _, n in cols], "weeks": weeks}


def match_names(sheet_names, cpl_players):
    """Match sheet column names (e.g. 'Linda Schneider-Jesser (sub)') to CPL players."""
    out, unmatched = {}, []
    cands = {p["playerId"]: (norm(p.get("firstName")), norm(p.get("lastName"))) for p in cpl_players}
    by_full = {full_name(p).lower(): p["playerId"] for p in cpl_players}
    used = set()
    for name in sheet_names:
        if name in ALIASES and ALIASES[name].lower() in by_full:
            out[name] = by_full[ALIASES[name].lower()]
            used.add(out[name])
            continue
        n = norm(name)
        toks = n.split()
        best, best_s = None, 0.0
        for pid, (first, last) in cands.items():
            if pid in used or not first:
                continue
            nf = len(first.split())
            s_first = difflib.SequenceMatcher(None, " ".join(toks[:nf]), first).ratio()
            rest = " ".join(toks[nf:])
            if not rest:
                s_last = 0.5  # sheet gave first name only
            elif last and (rest == last or last in rest.split() or rest in last):
                s_last = 1.0
            elif last and rest[0] == last[0]:
                s_last = 0.75
            else:
                s_last = difflib.SequenceMatcher(None, rest, last).ratio() * 0.6
            s = 0.6 * s_first + 0.4 * s_last
            if s > best_s:
                best, best_s = pid, s
        if best and best_s >= 0.72:
            out[name] = best
            used.add(best)
        else:
            unmatched.append(name)
    return out, unmatched


def insights(d, sigma):
    P = {p["id"]: p for p in d["players"]}
    nm = lambda pid: P[pid]["name"].split()[0] if pid in P else "?"
    out = []
    us = next((t for t in d["standings"] if t["isUs"]), None)
    done = [s for s in d["schedule"] if s["done"] and not s["playoffs"]]
    if done:
        tot_g = sum((s["usGames"] or 0) + (s["themGames"] or 0) for s in done)
        won_g = sum(s["usGames"] or 0 for s in done)
        pts_gap = sum(s["themPts"] - s["usPts"] for s in done) / len(done)
        out.append({"kind": "big", "title": "Where we stand",
                    "text": f"{sum(s['result'] == 'W' for s in done)}-{sum(s['result'] == 'L' for s in done)} in matches, "
                            f"{won_g}-{tot_g - won_g} in individual games ({pct(won_g, tot_g)}%)."
                            + (f" We lose by about {pts_gap:.0f} total points per match." if pts_gap > 0 else "")})
    if d["scoringRule"] == "points":
        out.append({"kind": "tip", "title": "Every point counts",
                    "text": "Matches are decided by TOTAL POINTS across all 32 games, not games won. "
                            "Losing 19-21 instead of 10-21 is worth 9 points to the team. Never give up a game early."})

    # by game type
    if us:
        rates = [("mixed", us["mixedRate"], us["mixed"]), ("men's", us["mensRate"], us["mens"]), ("women's", us["womensRate"], us["womens"])]
        rates = [x for x in rates if x[1] is not None]
        if rates:
            best = max(rates, key=lambda x: x[1])
            worst = min(rates, key=lambda x: x[1])
            out.append({"kind": "info", "title": "Strongest & weakest game type",
                        "text": f"Best: {best[0]} ({best[2]}, {best[1]:.0f}%). Weakest: {worst[0]} ({worst[2]}, {worst[1]:.0f}%)."})

    pairs = [p for p in d["pairs"] if p["g"] >= MIN_PAIR_GAMES]
    for typ, label in (("mixed", "mixed"), ("male", "men's"), ("female", "women's")):
        tp = sorted([p for p in pairs if p["type"] == typ], key=lambda p: -p["strength"])
        if tp:
            b = tp[0]
            out.append({"kind": "good", "title": f"Best {label} pair",
                        "text": f"{nm(b['a'])} + {nm(b['b'])}: {b['w']}-{b['l']} together, {b['diff']:+.1f} points per game."})
    hot = sorted([p for p in pairs if p["chem"] >= 1.0], key=lambda p: -p["chem"])[:3]
    if hot:
        out.append({"kind": "good", "title": "Chemistry: better together than apart",
                    "text": "; ".join(f"{nm(p['a'])} + {nm(p['b'])} (+{p['chem']:.1f} pts/game above expected)" for p in hot) + "."})
    cold = sorted([p for p in pairs if p["chem"] <= -1.0], key=lambda p: p["chem"])[:3]
    if cold:
        out.append({"kind": "warn", "title": "Pairs that underperform",
                    "text": "; ".join(f"{nm(p['a'])} + {nm(p['b'])} ({p['chem']:.1f} pts/game vs expected)" for p in cold)
                            + ". Worth trying different partners."})

    # mixed vs gender specialists
    for p in d["players"]:
        if p["mixG"] >= 6 and p["genG"] >= 4:
            mr, gr = p["mixW"] / p["mixG"], p["genW"] / p["genG"]
            if abs(mr - gr) >= 0.3:
                better = "mixed" if mr > gr else "same-gender"
                out.append({"kind": "info", "title": f"{p['name'].split()[0]} is a {better} specialist",
                            "text": f"Mixed {p['mixW']}-{p['mixG'] - p['mixW']}, same-gender {p['genW']}-{p['genG'] - p['genW']}."})
    close = [g for g in d["games"] if abs(g["usScore"] - g["themScore"]) <= 3]
    if close:
        cw = sum(g["won"] for g in close)
        out.append({"kind": "info", "title": "Close games (decided by 3 or fewer)",
                    "text": f"We're {cw}-{len(close) - cw} in close games. "
                            + ("Closing out tight games is a big opportunity — practice end-of-game situations." if cw < len(close) / 2 else "We finish strong.")})
    no_dupr = [p["name"].split()[0] for p in d["players"] if not p["dupr"] and not p["isSub"]]
    if no_dupr:
        out.append({"kind": "info", "title": "Missing DUPR ratings",
                    "text": f"No DUPR rating on CPL for: {', '.join(no_dupr)}. Linking DUPR helps compare against other teams."})
    return out


if __name__ == "__main__":
    main()
