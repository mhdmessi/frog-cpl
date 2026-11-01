/* Frog Pickleball CPL team hub — vanilla JS, reads data.json built by scripts/build_data.py */
let D, P = {}, SHORT = {}, PAIR = {}, SIG = 2.5;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sn = (id) => SHORT[id] || (P[id] ? P[id].name : "?");
const winProb = (m) => 1 / (1 + Math.exp(-m / SIG));
const pairKey = (a, b) => (a < b ? a + "|" + b : b + "|" + a);
const signed = (x, d = 1) => (x == null ? "–" : (x > 0 ? "+" : "") + x.toFixed(d));
const cls = (x) => (x > 0.05 ? "pos" : x < -0.05 ? "neg" : "");
const pctTxt = (w, g) => (g ? Math.round((100 * w) / g) + "%" : "–");
const wl = (w, g) => (g ? `${w}-${g - w}` : "–");
const isMale = (id) => P[id] && P[id].gender === "Male";

function fmtDate(iso, withTime = true) {
  if (!iso) return "";
  const [d, t] = iso.split("T");
  const dt = new Date(d + "T12:00:00");
  let s = dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  if (withTime && t) {
    let [h, m] = t.split(":").map(Number);
    const ap = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    s += ` · ${h}:${String(m).padStart(2, "0")} ${ap}`;
  }
  return s;
}

function pairVal(a, b) {
  const k = pairKey(a, b);
  if (D.allPairs && k in D.allPairs) return D.allPairs[k];
  const r = (id) => (P[id] ? P[id].rating : D.league[id] ? D.league[id].r : -1) || 0;
  return r(a) + r(b);
}

/* ------------------------------------------------------------ boot */
/* Two Frog teams (3.0 and 3.5). The chosen team lives in the URL (?team=3.5) so shared links open the right one,
   and is remembered on this device. Each team has its own header color so nobody reads the wrong one by mistake. */
let TEAM_LEVEL = null, TEAMS = ["3.0", "3.5"];

function pickTeam() {
  const q = new URLSearchParams(location.search).get("team");
  if (q && TEAMS.includes(q)) return q;
  const saved = localStorage.getItem("frogTeam");
  return saved && TEAMS.includes(saved) ? saved : TEAMS[0];
}

function drawSwitcher() {
  $("#teamswitch").innerHTML = TEAMS.map((t) => `<button data-t="${t}" class="${t === TEAM_LEVEL ? "on" : ""}" aria-pressed="${t === TEAM_LEVEL}">${t} team</button>`).join("");
  $("#teamswitch").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => switchTeam(b.dataset.t)));
}

function switchTeam(level) {
  if (level === TEAM_LEVEL) return;
  const url = new URL(location.href);
  url.searchParams.set("team", level);
  history.replaceState(null, "", url);
  loadTeam(level);
}

function loadTeam(level) {
  TEAM_LEVEL = level;
  localStorage.setItem("frogTeam", level);
  document.body.dataset.team = level;
  document.title = `Frog ${level} · CPL Team Hub`;
  $("#teamname").textContent = level;
  drawSwitcher();
  $("#app").innerHTML = `<p class="loading">Loading the ${level} team…</p>`;
  return fetch(`data-${level}.json?v=` + Date.now())
    .then((r) => {
      if (!r.ok) throw new Error(`data for ${level} not found`);
      return r.json();
    })
    .then((data) => {
      D = data;
      P = {}; SHORT = {}; PAIR = {}; LSHORT = null;
      LU.week = null; LU.sel = null; LU.selWeek = null;
      SIG = D.model.sigma || 2.5;
      D.players.forEach((p) => (P[p.id] = p));
      const firsts = {};
      D.players.forEach((p) => {
        const f = p.name.split(" ")[0];
        firsts[f] = (firsts[f] || 0) + 1;
      });
      D.players.forEach((p) => {
        const parts = p.name.split(" ");
        SHORT[p.id] = firsts[parts[0]] > 1 ? `${parts[0]} ${(parts[1] || "")[0] || ""}.` : parts[0];
      });
      D.pairs.forEach((p) => (PAIR[pairKey(p.a, p.b)] = p));
      $("#sub").textContent = `${D.division} · ${D.season}`;
      $("#foot").innerHTML = `Showing the <b>Frog ${esc(level)}</b> team. Data from <a href="https://www.crossclubpickleball.com/leagues/dashboard" target="_blank" rel="noopener">crossclubpickleball.com</a>
        and the <a href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">team availability sheet (${esc(level)} tab)</a>.
        Updated ${new Date(D.generated).toLocaleString()}. Refreshes automatically every few hours.`;
      route();
    })
    .catch((e) => ($("#app").innerHTML = `<div class="alert bad">Couldn't load the ${esc(level)} team (${esc(e.message)}).</div>`));
}

fetch("teams.json?v=" + Date.now())
  .then((r) => (r.ok ? r.json() : null))
  .catch(() => null)
  .then((t) => {
    if (t && t.teams && t.teams.length) TEAMS = t.teams;
    window.addEventListener("hashchange", route);
    loadTeam(pickTeam());
  });

function route() {
  const [tab, arg, arg2] = (location.hash.slice(1) || "home").split("/");
  document.querySelectorAll(".tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  const view = { home, lineup, players, partners, schedule, scouting, about }[tab] || home;
  $("#app").innerHTML = "";
  view(arg, arg2);
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ tooltip */
document.addEventListener("mouseover", (e) => {
  const t = e.target.closest("[data-tip]");
  const tip = $("#tip");
  if (!t) return (tip.hidden = true);
  tip.innerHTML = t.dataset.tip;
  tip.hidden = false;
  const r = t.getBoundingClientRect();
  const x = Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2));
  const y = r.top - tip.offsetHeight - 8 < 0 ? r.bottom + 8 : r.top - tip.offsetHeight - 8;
  tip.style.left = x + "px";
  tip.style.top = y + "px";
});

/* ------------------------------------------------------------ shared bits */
function nextMatch() {
  return D.schedule.find((s) => !s.done) || null;
}
function availFor(s, id) {
  return (s && s.avail && s.avail[id]) || "";
}
function availPill(v) {
  const label = { yes: "In", no: "Out", maybe: "Maybe", "": "No reply" }[v] ?? v;
  return `<span class="pill ${v === "yes" || v === "no" || v === "maybe" ? v : "none"}">${esc(label)}</span>`;
}
function ratingCell(p) {
  if (p.rating == null) return "–";
  return `<span class="rating ${cls(p.rating)}" data-tip="${p.ratingEst ? "Estimated from DUPR (no CPL games yet)" : "Points per game this player adds vs an average player in the division"}">${signed(p.rating)}${p.ratingEst ? "*" : ""}</span>`;
}
function badges(p) {
  return (p.isCaptain ? ` <span class="pill cap">Captain</span>` : "") + (p.isSub ? ` <span class="pill sub">Sub${p.subCount ? " ×" + p.subCount : ""}</span>` : "");
}
function sortableTable(el, cols, rows, defaultSort) {
  let sortKey = defaultSort?.key, dir = defaultSort?.dir ?? -1;
  function draw() {
    const rs = [...rows];
    if (sortKey) {
      const c = cols.find((c) => c.key === sortKey);
      rs.sort((a, b) => {
        const va = c.sort ? c.sort(a) : a[sortKey], vb = c.sort ? c.sort(b) : b[sortKey];
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return (va > vb ? 1 : va < vb ? -1 : 0) * dir;
      });
    }
    el.innerHTML = `<div class="tbl-wrap"><table><thead><tr>${cols
      .map((c) => `<th class="${c.num ? "num" : ""} ${c.nosort ? "nosort" : ""}" data-k="${c.key}" ${c.tip ? `data-tip="${esc(c.tip)}"` : ""}>${c.label}${sortKey === c.key ? (dir > 0 ? " ▲" : " ▼") : ""}</th>`)
      .join("")}</tr></thead><tbody>${rs
      .map((r) => `<tr class="${r._cls || ""}">${cols.map((c) => `<td class="${c.num ? "num" : ""}">${c.html ? c.html(r) : esc(r[c.key] ?? "–")}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
    el.querySelectorAll("th:not(.nosort)").forEach((th) =>
      th.addEventListener("click", () => {
        if (sortKey === th.dataset.k) dir = -dir;
        else (sortKey = th.dataset.k), (dir = -1);
        draw();
      })
    );
  }
  draw();
}
function section(html) {
  const d = document.createElement("div");
  d.innerHTML = html;
  $("#app").appendChild(d);
  return d;
}

/* ------------------------------------------------------------ HOME */
function home() {
  const us = D.standings.find((t) => t.isUs) || {};
  const done = D.schedule.filter((s) => s.done && !s.playoffs);
  const gW = done.reduce((a, s) => a + (s.usGames || 0), 0), gT = done.reduce((a, s) => a + (s.usGames || 0) + (s.themGames || 0), 0);
  const ptsDiff = done.reduce((a, s) => a + s.usPts - s.themPts, 0);
  section(`
    <div class="grid g4">
      <div class="card stat"><div class="num">${esc(us.record || "–")}</div><div class="lbl">Match record</div></div>
      <div class="card stat"><div class="num">#${esc(us.rank ?? "–")}<span class="muted" style="font-size:18px"> of ${D.standings.length}</span></div><div class="lbl">League standing</div></div>
      <div class="card stat"><div class="num">${pctTxt(gW, gT)}</div><div class="lbl">Games won (${gW} of ${gT})</div></div>
      <div class="card stat"><div class="num ${cls(ptsDiff)}">${gT ? signed(ptsDiff / gT) : "–"}</div><div class="lbl">Avg point margin per game</div></div>
    </div>`);

  const nm = nextMatch();
  if (nm) {
    const ids = Object.keys(nm.avail);
    const grp = (v) => ids.filter((id) => nm.avail[id] === v);
    const label = (id) => (P[id] ? esc(sn(id)) : esc(id.replace("sheet:", "")));
    const yes = grp("yes"), maybe = grp("maybe");
    const ym = yes.filter(isMale).length, yw = yes.filter((id) => P[id] && !isMale(id)).length;
    const noReply = D.players.filter((p) => !p.isSub && !nm.avail[p.id]).map((p) => p.id);
    let alert = "";
    if (ym < 4 || yw < 4)
      alert = `<div class="alert ${ym < 4 && yw < 4 ? "bad" : "warn"}">⚠️ Only <b>${ym} men</b> and <b>${yw} women</b> confirmed. A full lineup needs <b>4 men + 4 women</b>; 5 + 5 is the most that still gives everyone 6+ games. ${
        maybe.length ? `Maybes: ${maybe.map(label).join(", ")}. ` : ""
      }Time to chase subs.</div>`;
    else alert = `<div class="alert good">✅ ${ym} men and ${yw} women confirmed — enough for a full lineup.</div>`;
    const mapUrl = nm.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(nm.address)}` : null;
    section(`
      <h2>Next match · Week ${nm.week}</h2>
      <div class="card">
        <h3>${nm.home ? "🏠 Home" : "🚗 Away"} vs ${esc(nm.opp)}</h3>
        <div>${fmtDate(nm.time)}${mapUrl ? ` · <a href="${mapUrl}" target="_blank" rel="noopener">${esc(nm.address)}</a>` : ""}</div>
        ${alert}
        <div class="grid g3" style="margin-top:6px">
          <div><div class="tag">IN (${yes.length})</div><div class="chips">${yes.map((id) => `<span class="pill yes">${label(id)}</span>`).join("") || "<span class='muted'>nobody yet</span>"}</div></div>
          <div><div class="tag">MAYBE (${maybe.length})</div><div class="chips">${maybe.map((id) => `<span class="pill maybe">${label(id)}</span>`).join("") || "<span class='muted'>–</span>"}</div></div>
          <div><div class="tag">NO REPLY — REGULARS (${noReply.length})</div><div class="chips">${noReply.map((id) => `<span class="pill none">${label(id)}</span>`).join("") || "<span class='muted'>–</span>"}</div></div>
        </div>
        <div class="row" style="margin-top:14px">
          <a class="btn" href="#lineup/${nm.week}" style="text-decoration:none">See the recommended lineup →</a>
          <a class="btn ghost" href="#scouting/${encodeURIComponent(nm.opp)}" style="text-decoration:none">Scout ${esc(nm.opp.replace("Pickleball Kingdom North Aurora", "PK N. Aurora"))}</a>
        </div>
      </div>`);
  }

  section(`<h2>What the numbers say</h2><div class="grid g2">${D.insights
    .map((i) => `<div class="card insight ${esc(i.kind)}"><div class="ttl">${esc(i.title)}</div><div>${esc(i.text)}</div></div>`)
    .join("")}</div>`);

  const st = section(`<h2>League standings</h2><div></div>`).lastElementChild;
  sortableTable(st, [
    { key: "rank", label: "#", num: true },
    { key: "team", label: "Team" },
    { key: "record", label: "Matches" },
    { key: "gameRecord", label: "Games" },
    { key: "gameWinRate", label: "Game win %", num: true, html: (t) => (t.gameWinRate != null ? Math.round(t.gameWinRate) + "%" : "–") },
    { key: "mixed", label: "Mixed", nosort: true },
    { key: "mens", label: "Men's", nosort: true },
    { key: "womens", label: "Women's", nosort: true },
    { key: "pointDiff", label: "Point diff", num: true, html: (t) => `<span class="${cls(t.pointDiff)}">${signed(t.pointDiff, 0)}</span>` },
  ], D.standings.map((t) => ({ ...t, _cls: t.isUs ? "us" : "" })), { key: "rank", dir: 1 });
}

/* ------------------------------------------------------------ GAME PLAN (lineup builder) */
const LU = { week: null, sel: null, selWeek: null, mode: "even" }; // mode fixed: 6-game minimum leaves almost no room for a "max wins" variant
const MIN_GAMES = 6; // team rule: everyone plays at least 6 of 8 games
const MAX_FOR_MIN = Math.floor(32 / MIN_GAMES); // each gender has 32 game spots per match -> 5 players
const TYPE_LABEL = { mixed: "Mixed", female: "Women's", male: "Men's" };
const gameType = (n) => (n % 8 < 4 ? "mixed" : n % 8 < 6 ? "female" : "male");
let LSHORT = null;
function lname(id) {
  if (P[id]) return sn(id);
  if (!LSHORT) {
    LSHORT = {};
    const seen = {};
    for (const [pid, p] of Object.entries(D.league)) {
      const k = p.t + "|" + p.n.split(" ")[0];
      seen[k] = (seen[k] || 0) + 1;
    }
    for (const [pid, p] of Object.entries(D.league)) {
      const parts = p.n.split(" ");
      LSHORT[pid] = seen[p.t + "|" + parts[0]] > 1 ? `${parts[0]} ${(parts[1] || "")[0] || ""}.` : parts[0];
    }
  }
  return LSHORT[id] || "?";
}

/* ---- Manually entered opponent lineup (backup if CPL's public data doesn't show it before we set ours) */
const manualKey = (mid) => `frogOppLineup:${mid}`;
function loadManual(mid) {
  try {
    return JSON.parse(localStorage.getItem(manualKey(mid))) || [];
  } catch {
    return [];
  }
}
function saveManual(mid, arr) {
  localStorage.setItem(manualKey(mid), JSON.stringify(arr));
}

function manualEditorHTML(wk) {
  const auto = D.posted[wk.matchupId]?.them || [];
  const manual = loadManual(wk.matchupId);
  const roster = Object.entries(D.league).filter(([, p]) => p.t === wk.opp).sort((a, b) => a[1].n.localeCompare(b[1].n));
  const opts = (g, sel) => `<option value="">—</option>` + roster.filter(([, p]) => p.g === g)
    .map(([id, p]) => `<option value="${id}" ${id === sel ? "selected" : ""}>${esc(p.n)}</option>`).join("");
  const filled = Array.from({ length: 32 }, (_, n) => auto[n] || (manual[n] && manual[n][0] && manual[n][1])).filter(Boolean).length;
  let rows = "";
  for (let r = 0; r < 8; r++) {
    rows += `<div class="card round"><h3>Round ${r + 1} <span class="tag">· ${r % 2 === 0 ? "Mixed" : "Women's + Men's"}</span></h3>`;
    for (let n = r * 4; n < r * 4 + 4; n++) {
      const t = gameType(n);
      const g1 = t === "male" ? "M" : "W", g2 = t === "female" ? "W" : "M";
      const cur = auto[n] || manual[n] || [];
      const lock = auto[n] ? "disabled" : "";
      rows += `<div class="row" style="gap:6px;margin:6px 0"><span class="tag" style="width:62px">G${n + 1} ${TYPE_LABEL[t]}</span>
        <select data-n="${n}" data-i="0" ${lock}>${opts(g1, cur[0])}</select><select data-n="${n}" data-i="1" ${lock}>${opts(g2, cur[1])}</select></div>`;
    }
    rows += `</div>`;
  }
  return `<details class="card" id="manualBox" style="margin-top:12px" ${filled && filled < 32 ? "open" : ""}>
    <summary>✍️ Enter their lineup by hand <span class="tag">(${filled} of 32 games known)</span>
      ${wk.home ? "" : `<span class="tag">· mainly for home matches — we're away this week, so they'll see ours first</span>`}</summary>
    <p class="small muted">Backup for when you can see their lineup on CPL (logged in) before this site picks it up. Copy each game's pair from CPL's scorecard.
      Saved on this device only. Games CPL already shows are filled in automatically and locked.</p>
    <div class="grid gsc">${rows}</div>
    <div class="row" style="margin-top:10px"><button class="btn ghost" id="manualClear">Clear what I entered</button></div>
  </details>`;
}

/** Chance our pair (strength v) beats the opponent in game slot x (averaged over their likely pairs). */
const slotProb = (v, x) => x.vals.reduce((a, o) => a + winProb(v - o), 0) / x.vals.length;

/** Opponent strength for each of the 32 games: their posted pair if known, else their typical pair for that game type. */
function oppPlan(wk) {
  const auto = D.posted[wk.matchupId]?.them || [];
  const manual = loadManual(wk.matchupId);
  const posted = Array.from({ length: 32 }, (_, n) => auto[n] || (manual[n] && manual[n][0] && manual[n][1] ? manual[n] : null));
  const ts = D.typeStrength[wk.opp] || {}, td = D.typeDist?.[wk.opp] || {};
  const plan = Array.from({ length: 32 }, (_, n) => {
    const pr = posted[n];
    if (pr) return { pair: pr, vals: [pairVal(pr[0], pr[1])], known: true };
    return { pair: null, vals: td[gameType(n)] || [ts[gameType(n)] ?? 0], known: false };
  });
  // Away team locks first (Thu 8pm); the home team sees it and decides who plays whom.
  // So when we're away and they haven't posted, assume they'll counter-pick our lineup.
  plan.counter = !wk.home && !plan.some((x) => x.known);
  const pick = (t, idx) => {
    const d = td[t] || [ts[t] ?? 0];
    return idx.map((i) => d[Math.min(d.length - 1, Math.floor((i * d.length) / 13))]);
  };
  plan.pools = { mixed: pick("mixed", [1, 4, 8, 11]), female: pick("female", [3, 9]), male: pick("male", [3, 9]) };
  return plan;
}

function lineup(arg, auto) {
  const upcoming = D.schedule.filter((s) => !s.done);
  const weeks = upcoming.length ? upcoming : D.schedule;
  if (arg) LU.week = Number(arg);
  if (!weeks.find((s) => s.week === LU.week)) LU.week = weeks[0]?.week;
  const wk = D.schedule.find((s) => s.week === LU.week);
  if (!wk) return section(`<p class="muted">No matches on the schedule.</p>`);
  if (!LU.sel || LU.selWeek !== LU.week) {
    LU.sel = new Set(D.players.filter((p) => availFor(wk, p.id) === "yes").map((p) => p.id));
    LU.selWeek = LU.week;
  }
  let plan = oppPlan(wk);
  const nKnown = plan.filter((x) => x.known).length;
  const ourPosted = (D.posted[wk.matchupId]?.us || []).filter(Boolean).length;
  const deadline = wk.home
    ? `<div class="alert good">🏠 <b>We're home.</b> ${esc(wk.opp)} (away) must lock their lineup by <b>Thu 8pm</b>; we set ours by <b>Fri 8pm</b> after seeing theirs — and we decide who plays whom.</div>`
    : `<div class="alert warn">🚗 <b>We're away.</b> Our lineup is due <b>Thu 8pm</b>, and ${esc(wk.opp)} (home) sees it before setting theirs by Fri 8pm — they decide who plays whom.
        So this plan is built to hold up <b>even if they counter-pick</b> us, not tuned to a lineup we can't see.</div>`;
  const status = nKnown === 32
    ? `<div class="alert good">✅ <b>${esc(wk.opp)}'s lineup is in.</b> The plan matches our pairs against theirs game by game.</div>`
    : nKnown > 0
    ? `<div class="alert warn">⏳ ${esc(wk.opp)} has entered ${nKnown} of 32 games so far. Known games are matched directly; the rest use their typical pairs.</div>`
    : wk.home
    ? `<div class="alert warn">⏳ Their lineup isn't in yet. This page checks CPL hourly Thu–Sat — after Thu 8pm, reload and press <b>Build</b> to counter their exact lineup.</div>`
    : "";
  const statusAll = deadline + status;

  const box = section(`
    <h2>Game Plan</h2>
    <div class="card">
      <div class="row">
        <label>Match&nbsp;<select id="luWeek">${weeks
          .map((s) => `<option value="${s.week}" ${s.week === LU.week ? "selected" : ""}>Week ${s.week} · ${fmtDate(s.time, false)} · ${s.home ? "vs" : "@"} ${esc(s.opp)}</option>`)
          .join("")}</select></label>
      </div>
      ${statusAll}
      ${ourPosted ? `<div class="alert good">Our lineup on CPL: ${ourPosted} of 32 games filled in.</div>` : ""}
      <p class="small muted" style="margin:10px 0 0">Everyone plays at least ${MIN_GAMES} of the 8 games, and same-gender teammates stay within 1 game of each other.
        With 4 men + 4 women everyone plays all 8.</p>
      <p class="small muted" style="margin:10px 0 0"><b>Automatic:</b> everyone marked <b>In</b> on the sheet is checked, gaps are filled from Maybes then subs, and the best lineup is built below.
        Change any box and it rebuilds. Same data → same lineup for everyone.</p>
      <div id="luPick" style="margin-top:8px"></div>
      <div class="row" style="margin-top:14px"><button class="btn" id="luGo">Rebuild</button>
        <button class="btn ghost" id="luFill" hidden data-tip="Adds Maybes first, then the strongest subs who haven't replied. Never adds anyone marked Out.">Fill the gaps</button>
        <span id="luCount" class="muted"></span></div>
      <div id="luFillNote"></div>
    </div>
    <div id="manualWrap">${manualEditorHTML(wk)}</div>
    <div id="luOut"></div><div id="luPairs"></div>`);
  const wireManual = () => {
    const wrap = $("#manualWrap");
    wrap.querySelectorAll("select").forEach((sel) =>
      sel.addEventListener("change", () => {
        const arr = loadManual(wk.matchupId);
        const n = Number(sel.dataset.n), i = Number(sel.dataset.i);
        arr[n] = arr[n] || [null, null];
        arr[n][i] = sel.value || null;
        saveManual(wk.matchupId, arr);
        const fresh = oppPlan(wk); // refresh the plan in place
        for (let k = 0; k < 32; k++) plan[k] = fresh[k];
        plan.counter = fresh.counter; plan.pools = fresh.pools;
        wrap.querySelector("summary .tag").textContent = `(${fresh.filter((x) => x.known).length} of 32 games known)`;
      })
    );
    $("#manualClear").addEventListener("click", () => {
      localStorage.removeItem(manualKey(wk.matchupId));
      location.hash = "#lineup/" + wk.week + "/" + Date.now(); // re-render
    });
  };
  wireManual();

  let lastChecked = null;
  function drawPick() {
    const grp = (male) =>
      D.players
        .filter((p) => (p.gender === "Male") === male)
        .sort((a, b) => {
          const order = { yes: 0, maybe: 1, "": 2, no: 3 };
          return order[availFor(wk, a.id)] - order[availFor(wk, b.id)] || (b.rating || 0) - (a.rating || 0);
        })
        .map((p) => {
          const on = LU.sel.has(p.id);
          return `<label class="${on ? "on" : ""}"><input type="checkbox" data-id="${p.id}" ${on ? "checked" : ""}>
            <span><b>${esc(sn(p.id))}</b> ${p.isSub ? '<span class="tag">sub</span>' : ""}<br>${availPill(availFor(wk, p.id))}
            <span class="tag rating ${cls(p.rating)}">${signed(p.rating)}</span></span></label>`;
        })
        .join("");
    $("#luPick").innerHTML = `<div class="tag" style="margin-bottom:6px">MEN</div><div class="pick">${grp(true)}</div>
      <div class="tag" style="margin:12px 0 6px">WOMEN</div><div class="pick">${grp(false)}</div>`;
    $("#luPick").querySelectorAll("input").forEach((i) =>
      i.addEventListener("change", () => {
        i.checked ? LU.sel.add(i.dataset.id) : LU.sel.delete(i.dataset.id);
        lastChecked = i.checked ? i.dataset.id : null;
        drawPick();
        scheduleBuild();
      })
    );
    const m = [...LU.sel].filter(isMale).length, w = LU.sel.size - m;
    const over = [m > MAX_FOR_MIN ? `${m} men` : "", w > MAX_FOR_MIN ? `${w} women` : ""].filter(Boolean).join(" and ");
    $("#luCount").innerHTML = `${m} men · ${w} women` + (m < 4 || w < 4 ? ` — <b class="neg">need at least 4 + 4</b>`
      : over ? ` — ${over} available, so the plan sits out ${[m > MAX_FOR_MIN ? m - MAX_FOR_MIN + (m - MAX_FOR_MIN > 1 ? " men" : " man") : "", w > MAX_FOR_MIN ? w - MAX_FOR_MIN + (w - MAX_FOR_MIN > 1 ? " women" : " woman") : ""].filter(Boolean).join(" and ")} to keep everyone else at ${MIN_GAMES}+ games` : "");
    $("#luGo").disabled = m < 4 || w < 4;
    $("#luFill").hidden = !(m < 4 || w < 4);
    showTopPairs([...LU.sel], lastChecked);
  }
  drawPick();

  function fillGaps() {
    const added = [];
    for (const male of [true, false]) {
      const have = [...LU.sel].filter((id) => isMale(id) === male).length;
      const order = { maybe: 0, "": 1 };
      const cands = D.players
        .filter((p) => (p.gender === "Male") === male && !LU.sel.has(p.id) && availFor(wk, p.id) in order)
        .sort((a, b) => order[availFor(wk, a.id)] - order[availFor(wk, b.id)] || (b.rating || 0) - (a.rating || 0));
      cands.slice(0, Math.max(0, 4 - have)).forEach((p) => (LU.sel.add(p.id), added.push(p)));
    }
    drawPick();
    $("#luFillNote").innerHTML = added.length
      ? `<div class="alert warn">Added to fill the lineup: ${added.map((p) => `<b>${esc(sn(p.id))}</b> (${availFor(wk, p.id) === "maybe" ? "maybe" : "hasn't replied"})`).join(", ")}. Confirm they can play!</div>`
      : `<div class="alert bad">Nobody left to add — everyone else is marked Out.</div>`;
  }
  $("#luFill").addEventListener("click", fillGaps);
  $("#luWeek").addEventListener("change", (e) => (location.hash = "#lineup/" + e.target.value));
  let buildTimer = null;
  const build = () => {
    if ($("#luGo").disabled) {
      $("#luOut").innerHTML = `<div class="alert bad">Need at least 4 men and 4 women checked to build a lineup.</div>`;
      return;
    }
    const men = [...LU.sel].filter(isMale), women = [...LU.sel].filter((id) => !isMale(id));
    $("#luOut").innerHTML = `<p class="muted">⏳ Building the best lineup…</p>`;
    const seed = `${wk.matchupId}|${plan.filter((x) => x.known).length}`;
    setTimeout(() => showLineup(autoLineup(men, women, { mode: LU.mode, plan, seed }), wk, plan, [...LU.sel]), 20);
  };
  const scheduleBuild = () => {
    clearTimeout(buildTimer);
    buildTimer = setTimeout(build, 700);
  };
  $("#luGo").addEventListener("click", build);
  // Automatic: fill gaps if we're short, then build right away — no clicks needed.
  if (!$("#luFill").hidden) fillGaps();
  build();
}

function showTopPairs(ids, focus) {
  const sel = new Set(ids);
  const all = D.pairs.filter((p) => sel.has(p.a) && sel.has(p.b));
  const el = $("#luPairs");
  if (!el) return;
  if (!all.length) return (el.innerHTML = "");
  const card = (p) => `<div class="card"><b>${esc(sn(p.a))} + ${esc(sn(p.b))}</b> <span class="tag">${TYPE_LABEL[p.type]}</span>
      <div>${p.w}-${p.l} together · <span class="${cls(p.diff)}">${signed(p.diff)}</span> pts/game</div></div>`;
  const top = all.filter((p) => p.g >= 2).slice(0, 6);
  const mine = focus && sel.has(focus) ? all.filter((p) => p.a === focus || p.b === focus).sort((a, b) => b.strength - a.strength) : [];
  el.innerHTML = `<h2>How the checked players have done together</h2>
    ${mine.length ? `<h3>Pairs with ${esc(sn(focus))} (just checked)</h3><div class="grid g3" style="margin-bottom:14px">${mine.map(card).join("")}</div>`
      : focus && sel.has(focus) ? `<p class="muted">${esc(sn(focus))} hasn't played with any of the other checked players yet.</p>` : ""}
    ${top.length ? `<h3>Best proven pairs (2+ games)</h3><div class="grid g3">${top.map(card).join("")}</div>` : ""}
    <details class="card" style="margin-top:12px"><summary>All ${all.length} pairs among checked players</summary><div id="luPairsAll" style="margin-top:10px"></div></details>`;
  sortableTable($("#luPairsAll"), [
    { key: "names", label: "Pair", html: (p) => `<b>${esc(sn(p.a))} + ${esc(sn(p.b))}</b>`, sort: (p) => sn(p.a) },
    { key: "type", label: "Type", html: (p) => TYPE_LABEL[p.type] },
    { key: "g", label: "Games", num: true },
    { key: "w", label: "W-L", num: true, html: (p) => `${p.w}-${p.l}`, sort: (p) => p.w / p.g },
    { key: "diff", label: "+/- per game", num: true, html: (p) => `<span class="${cls(p.diff)}">${signed(p.diff)}</span>` },
    { key: "chem", label: "Chemistry", num: true, html: (p) => `<span class="${cls(p.chem)}">${signed(p.chem)}</span>` },
  ], all, { key: "diff", dir: -1 });
}

/**
 * Lineup search. 32 games = 8 rounds of 4 games (one per court). Odd rounds: 4 mixed games;
 * even rounds: 2 women's + 2 men's. A player plays at most once per round (max 8 games).
 * Internally each "block" here = one mixed round + the gender round after it.
 * Maximises expected games won against the opponent's plan (posted pairs or typical strength).
 */
const PERMS2 = [[0, 1], [1, 0]];
const PERMS4 = (() => {
  const out = [];
  const go = (pre, rest) => (rest.length ? rest.forEach((x, i) => go([...pre, x], rest.filter((_, j) => j !== i))) : out.push(pre));
  go([], [0, 1, 2, 3]);
  return out;
})();

/** Small seeded random generator so the same inputs always give the same lineup (everyone sees the same plan). */
function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick who plays (max 5 per gender so everyone gets 6+), then build the lineup.
 * Sit-out candidates = the lowest-rated few; each option gets a quick build and the best one gets the full build.
 */
function autoLineup(men, women, opts) {
  const choose = (arr, k) => (k === 0 ? [[]] : arr.flatMap((x, i) => choose(arr.slice(i + 1), k - 1).map((c) => [x, ...c])));
  const sitOptions = (g) => {
    const extra = g.length - MAX_FOR_MIN;
    if (extra <= 0) return [[]];
    const r = (id) => (P[id] ? P[id].rating : -1) || 0;
    const pool = [...g].sort((a, b) => r(a) - r(b)).slice(0, extra + 2);
    return choose(pool, extra);
  };
  const mOpts = sitOptions(men), wOpts = sitOptions(women);
  if (mOpts.length * wOpts.length === 1) return optimize(men, women, opts);
  let best = null;
  for (const sm of mOpts)
    for (const sw of wOpts) {
      const m = men.filter((x) => !sm.includes(x)), w = women.filter((x) => !sw.includes(x));
      const q = optimize(m, w, { ...opts, quick: true });
      if (!best || q.s.val > best.val) best = { val: q.s.val, m, w };
    }
  return optimize(best.m, best.w, opts);
}

function optimize(men, women, { mode, plan, seed = "frog", quick = false }) {
  men = [...men].sort();
  women = [...women].sort();
  const rng = seededRng(seed + "|" + men.join(",") + "|" + women.join(","));
  const cache = new Map();
  const wp = (a, b, n) => {
    const k = pairKey(a, b) + "#" + n;
    if (!cache.has(k)) cache.set(k, slotProb(pairVal(a, b), plan[n]));
    return cache.get(k);
  };
  const pvCache = new Map();
  const pv = (a, b) => {
    const k = pairKey(a, b);
    if (!pvCache.has(k)) pvCache.set(k, pairVal(a, b));
    return pvCache.get(k);
  };
  // Home captain's best response: assign their pairs to our games to win as many as possible.
  const crCache = new Map();
  const counterRound = (ours, pool) => {
    const key = ours.map((x) => x.toFixed(2)).sort().join(",") + "|" + pool.join(",");
    const hit = crCache.get(key);
    if (hit !== undefined) return hit;
    const v = counterRoundRaw(ours, pool);
    crCache.set(key, v);
    return v;
  };
  const counterRoundRaw = (ours, pool) => {
    const perms = ours.length === 4 ? PERMS4 : PERMS2;
    let worst = Infinity;
    for (const p of perms) {
      let sum = 0;
      for (let i = 0; i < ours.length; i++) sum += winProb(ours[i] - pool[p[i]]);
      if (sum < worst) worst = sum;
    }
    return worst;
  };
  const rand = (n) => Math.floor(rng() * n);
  const shuffle = (a) => {
    a = [...a];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const fresh = () => Array.from({ length: 4 }, () => ({ mx: shuffle(men).slice(0, 4), mw: shuffle(women).slice(0, 4), mm: shuffle(men).slice(0, 4), ww: shuffle(women).slice(0, 4) }));
  const copy = (s) => s.map((r) => ({ mx: [...r.mx], mw: [...r.mw], mm: [...r.mm], ww: [...r.ww] }));
  function score(s) {
    let tot = 0, typical = 0;
    const gc = new Map();
    const count = (a, b) => {
      gc.set(a, (gc.get(a) || 0) + 1);
      gc.set(b, (gc.get(b) || 0) + 1);
    };
    s.forEach((r, ri) => {
      const base = ri * 8;
      const games = [
        [r.mw[0], r.mx[0], base], [r.mw[1], r.mx[1], base + 1], [r.mw[2], r.mx[2], base + 2], [r.mw[3], r.mx[3], base + 3],
        [r.ww[0], r.ww[1], base + 4], [r.ww[2], r.ww[3], base + 5], [r.mm[0], r.mm[1], base + 6], [r.mm[2], r.mm[3], base + 7],
      ];
      for (const [a, b, n] of games) {
        count(a, b);
        typical += wp(a, b, n);
      }
      if (plan.counter) {
        const v = games.map(([a, b]) => pv(a, b));
        tot += counterRound(v.slice(0, 4), plan.pools.mixed) + counterRound(v.slice(4, 6), plan.pools.female) + counterRound(v.slice(6, 8), plan.pools.male);
      }
    });
    if (!plan.counter) tot = typical;
    let pen = 0;
    for (const g of [men, women]) {
      // More than 5 available: the extras sit out (5 is the most that still gives everyone 6+ of the 32 spots).
      // The search decides who sits by what wins the most games.
      const allowedBench = Math.max(0, g.length - MAX_FOR_MIN);
      const counts = g.map((id) => gc.get(id) || 0).sort((a, b) => a - b);
      let excused = 0;
      const n = counts.filter((x) => (x === 0 && excused < allowedBench ? (excused++, false) : true));
      for (const x of n) if (x < MIN_GAMES) pen += (MIN_GAMES - x) ** 2 * 2; // everyone who plays gets 6+; shortfalls get spread out
      if (mode === "even" && n.length) {
        const spread = Math.max(...n) - Math.min(...n);
        if (spread > 1) pen += (spread - 1) * 1.0;
      }
    }
    return { val: tot - pen, tot, typical, pen, gc };
  }
  function mutate(s) {
    const r = s[rand(4)];
    const g = ["mx", "mw", "mm", "ww"][rand(4)];
    const arr = r[g];
    const pool = g === "mx" || g === "mm" ? men : women;
    const i = rand(4);
    const bench = pool.filter((x) => !arr.includes(x));
    if (bench.length && rng() < 0.4) arr[i] = bench[rand(bench.length)];
    else {
      let j = rand(4);
      if (j === i) j = (i + 1 + rand(3)) % 4;
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
  let best = null;
  for (let restart = 0; restart < (quick ? 2 : 6); restart++) {
    let cur = fresh(), cs = score(cur);
    const N = quick ? 5000 : 15000;
    for (let it = 0; it < N; it++) {
      const T = 0.4 * Math.pow(0.01, it / N);
      const nx = copy(cur);
      mutate(nx);
      const ns = score(nx);
      if (ns.val >= cs.val || rng() < Math.exp((ns.val - cs.val) / T)) (cur = nx), (cs = ns);
      if (!best || cs.val > best.s.val) best = { lineup: copy(cur), s: cs };
    }
  }
  return best;
}

/** CPL-style scorecard: 8 rounds of 4 games (one per court). Odd rounds mixed, even rounds women's + men's. */
function scorecardHTML(games, oppName, opts = {}) {
  let html = "";
  for (let r = 0; r < 8; r++) {
    const rows = games.filter((g) => Math.floor(g.n / 4) === r);
    if (!rows.length) continue;
    const won = rows.filter((g) => g.usScore > g.themScore).length;
    const sub = r % 2 === 0 ? "Mixed" : "Women's + Men's";
    const right = opts.scores ? `<span class="tag">won ${won} of ${rows.length}</span>` : "";
    html += `<div class="card round"><h3>Round ${r + 1} <span class="tag">· ${sub}</span> ${right}</h3><table class="sc"><thead><tr>
      <th class="nosort">Game</th><th class="nosort">Type</th><th class="nosort">Frog</th>
      <th class="nosort num">${opts.scores ? "Score" : "Win %"}</th><th class="nosort" title="${esc(oppName)}">Opponent</th></tr></thead><tbody>
      ${rows.map((g) => `<tr><td class="muted">${g.n + 1}</td><td><span class="ty">${TYPE_LABEL[gameType(g.n)]}</span></td>
        <td><b>${g.us.map((x) => esc(lname(x))).join(" + ")}</b>${g.hist ? ` <span class="tag">${esc(g.hist)}</span>` : ""}</td>
        <td class="num">${opts.scores
          ? `<span class="pill ${g.usScore > g.themScore ? "W" : "L"}">${g.usScore}–${g.themScore}</span>`
          : `<span class="chance ${g.p >= 0.5 ? "pos" : "neg"}" data-tip="Estimated chance to win this game">${Math.round(g.p * 100)}%</span>`}</td>
        <td>${g.them ? g.them.map((x) => esc(lname(x))).join(" + ") : `<span class="muted" data-tip="Not posted yet — planned against their usual ${TYPE_LABEL[gameType(g.n)].toLowerCase()} pairs">TBD</span>`}</td></tr>`).join("")}
      </tbody></table></div>`;
  }
  return html;
}

function rosterHTML(ids, counts, title) {
  const list = (male) => ids.filter((id) => (D.league[id]?.g === "M") === male)
    .sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
    .map((id, i) => `<tr><td class="muted">${male ? "M" : "W"}${i + 1}</td><td><b>${esc(lname(id))}</b></td><td class="num">${counts[id] || 0} games</td></tr>`).join("");
  return `<div class="card"><h3>${esc(title)}</h3><table class="sc"><tbody>${list(true)}${list(false)}</tbody></table></div>`;
}

function showLineup(best, wk, plan, selected = []) {
  const { lineup: L, s } = best;
  const sitting = selected.filter((id) => !s.gc.get(id));
  const games = [];
  L.forEach((r, ri) => {
    const base = ri * 8;
    const push = (n, a, b) => {
      const pv = pairVal(a, b), p = PAIR[pairKey(a, b)];
      games.push({ n, us: [a, b], them: plan[n].pair, p: slotProb(pv, plan[n]), hist: p ? `${p.w}-${p.l} together` : "new pair" });
    };
    for (let i = 0; i < 4; i++) push(base + i, r.mw[i], r.mx[i]);
    push(base + 4, r.ww[0], r.ww[1]); push(base + 5, r.ww[2], r.ww[3]);
    push(base + 6, r.mm[0], r.mm[1]); push(base + 7, r.mm[2], r.mm[3]);
  });
  games.sort((a, b) => a.n - b.n);
  const counts = Object.fromEntries(s.gc);
  const theirIds = [...new Set(plan.flatMap((x) => x.pair || []))];
  const theirCounts = {};
  plan.forEach((x) => (x.pair || []).forEach((id) => (theirCounts[id] = (theirCounts[id] || 0) + 1)));
  const sorted = [...games].sort((a, b) => b.p - a.p);
  const text = `Frog lineup — Week ${wk.week} ${wk.home ? "vs" : "@"} ${wk.opp}\n` +
    [0, 1, 2, 3, 4, 5, 6, 7].map((r) => `\nRound ${r + 1}\n` + games.filter((g) => Math.floor(g.n / 4) === r)
      .map((g) => `  G${g.n + 1} ${TYPE_LABEL[gameType(g.n)]}: ${g.us.map(lname).join(" + ")}`).join("\n")).join("\n") +
    `\n\nGames per player: ` + Object.entries(counts).map(([id, c]) => `${lname(id)} ${c}`).join(", ");
  $("#luOut").innerHTML = `
    <h2>Suggested lineup</h2>
    <div class="grid g3">
      ${plan.counter
        ? `<div class="card stat"><div class="num">≈ ${s.tot.toFixed(1)} <span class="muted" style="font-size:18px">of 32</span></div>
            <div class="lbl">expected games won <b>if they counter-pick</b> us · ≈ ${s.typical.toFixed(1)} if they just play their usual pairs</div></div>`
        : `<div class="card stat"><div class="num">≈ ${s.tot.toFixed(1)} <span class="muted" style="font-size:18px">of 32</span></div><div class="lbl">expected games won ${plan.some((x) => x.known) ? "vs their actual lineup" : "vs their typical pairs"}</div></div>`}
      <div class="card"><div class="tag">BEST CHANCES</div>${sorted.slice(0, 3).map((g) => `<div>G${g.n + 1}: ${g.us.map(lname).join(" + ")} <b class="pos">${Math.round(g.p * 100)}%</b></div>`).join("")}</div>
      <div class="card"><div class="tag">TOUGHEST GAMES</div>${sorted.slice(-3).reverse().map((g) => `<div>G${g.n + 1}: ${g.us.map(lname).join(" + ")} <b class="neg">${Math.round(g.p * 100)}%</b></div>`).join("")}</div>
    </div>
    ${s.pen > 0.01 ? `<div class="alert warn">With this group, not every playing-time goal could be met (everyone ${MIN_GAMES}+ games, within 1 of each other) — check the games-per-player counts.</div>` : ""}
    <div class="row" style="margin:12px 0"><button class="btn ghost" id="luCopy">Copy lineup as text</button>
</div>
    ${sitting.length ? `<div class="alert warn">🪑 <b>Sitting out:</b> ${sitting.map((id) => esc(lname(id))).join(", ")} — more players are in than can each get ${MIN_GAMES} games, and this choice wins the most games. Uncheck someone else if you'd rather they sit.</div>` : ""}
    <h3 style="margin-top:16px">Rosters</h3>
    <div class="grid g2">${rosterHTML(Object.keys(counts), counts, "Frog Pickleball")}${theirIds.length ? rosterHTML(theirIds, theirCounts, wk.opp) : `<div class="card"><h3>${esc(wk.opp)}</h3><p class="muted">Their roster appears here once they post their lineup.</p></div>`}</div>
    <h3 style="margin-top:16px">Scorecard</h3>
    <div class="grid gsc">${scorecardHTML(games, wk.opp)}</div>
    <p class="small muted">Win chances are estimates from this season's results. Enter the pairs into CPL's lineup page game by game (Game 1 = first row).
      ${plan.counter ? "Win % per game is vs their usual pairs; since they see our lineup first, expect them to move their best pairs around." : ""}</p>`;
  $("#luCopy").addEventListener("click", (e) => navigator.clipboard.writeText(text).then(() => (e.target.textContent = "Copied ✓")));

}

/* ------------------------------------------------------------ PLAYERS */
function players() {
  section(`<h2>Player stats</h2>
    <p class="muted">Tap a column to sort. <b>Rating</b> = points per game a player adds compared to an average player in the division,
      after accounting for partners and opponents (more on the "How it works" tab). <b>Close</b> = games decided by 3 points or fewer.</p>`);
  const el = section("");
  sortableTable(el, [
    { key: "name", label: "Player", html: (p) => `<a href="#partners/${p.id}" data-tip="See ${esc(sn(p.id))}'s partners">${esc(p.name)}</a>${badges(p)}`, sort: (p) => p.name },
    { key: "gender", label: "", nosort: true, html: (p) => (p.gender === "Male" ? "M" : "W") },
    { key: "rating", label: "Rating", num: true, html: ratingCell, tip: "Points per game added vs division average" },
    { key: "divRank", label: "Div. rank", num: true, html: (p) => (p.divRank ? `${p.divRank}<span class="muted">/${p.divRanked}</span>` : "–"), sort: (p) => (p.divRank ? -p.divRank : null) },
    { key: "dupr", label: "DUPR", num: true, html: (p) => (p.dupr ? p.dupr.toFixed(2) : `<span class="muted" data-tip="No DUPR rating linked on CPL">–</span>`) },
    { key: "g", label: "Games", num: true },
    { key: "winPct", label: "Win %", num: true, html: (p) => (p.g ? `<div class="row" style="gap:6px;justify-content:flex-end">${Math.round(p.winPct)}%<div class="bar" style="width:70px"><i style="width:${p.winPct}%"></i></div></div>` : "–") },
    { key: "w", label: "W-L", num: true, html: (p) => wl(p.w, p.g) },
    { key: "mixW", label: "Mixed", num: true, html: (p) => wl(p.mixW, p.mixG), sort: (p) => (p.mixG ? p.mixW / p.mixG : null) },
    { key: "genW", label: "Same-gender", num: true, html: (p) => wl(p.genW, p.genG), sort: (p) => (p.genG ? p.genW / p.genG : null) },
    { key: "diff", label: "+/- per game", num: true, html: (p) => `<span class="${cls(p.diff)}">${signed(p.diff)}</span>` },
    { key: "clW", label: "Close", num: true, html: (p) => wl(p.clW, p.clG), sort: (p) => (p.clG ? p.clW / p.clG : null) },
  ], D.players, { key: "rating", dir: -1 });
  section(`<p class="small muted">* Estimated from DUPR because they haven't played a CPL game for us yet.</p>`);
}

/* ------------------------------------------------------------ PARTNERS */
function heatColor(v, max = 8) {
  // diverging: red (losing) <- gray -> blue (winning)
  const t = Math.max(-1, Math.min(1, v / max));
  const css = getComputedStyle(document.documentElement);
  const mid = css.getPropertyValue("--mid").trim(), pos = css.getPropertyValue("--blue").trim(), neg = css.getPropertyValue("--red").trim();
  const mix = (a, b, k) => {
    const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
    return "rgb(" + pa.map((x, i) => Math.round(x + (pb[i] - x) * k)).join(",") + ")";
  };
  return mix(mid, t >= 0 ? pos : neg, Math.abs(t) * 0.85);
}
function textOn(v, max = 8) {
  return Math.abs(v / max) > 0.55 ? "#fff" : "var(--ink)";
}

function partners(arg) {
  const focus = arg && P[arg] ? arg : null;
  section(`<h2>Partner chemistry</h2>
    <p class="muted">Each box is a pair's record together. Color shows average point margin per game:
      <b style="color:var(--blue)">blue = winning</b>, <b style="color:var(--red)">red = losing</b>, gray = even. Hover a box for details.
      <b>Chemistry</b> = how much better (or worse) a pair does than you'd expect from each player's individual rating.</p>
    <div class="legend"><span>−8 pts</span><span class="ramp" style="background:linear-gradient(90deg,${heatColor(-8)},${heatColor(0)},${heatColor(8)})"></span><span>+8 pts / game</span></div>`);

  const men = D.players.filter((p) => p.gender === "Male" && p.g > 0).sort((a, b) => b.g - a.g);
  const women = D.players.filter((p) => p.gender !== "Male" && p.g > 0).sort((a, b) => b.g - a.g);
  const cell = (a, b) => {
    const p = PAIR[pairKey(a, b)];
    if (!p) return `<td class="c" style="background:transparent;color:var(--muted)">·</td>`;
    const tip = `<b>${esc(sn(a))} + ${esc(sn(b))}</b><br>${p.w}-${p.l} together (${p.g} games)<br>Avg margin ${signed(p.diff)} pts/game<br>Chemistry ${signed(p.chem)} vs expected<br>Weeks: ${p.weeks.join(", ")}`;
    return `<td class="c" style="background:${heatColor(p.diff)};color:${textOn(p.diff)}" data-tip="${esc(tip)}"><b>${p.w}-${p.l}</b>${signed(p.diff)}</td>`;
  };
  const matrix = (rows, cols, title) => `
    <div class="card" style="margin-bottom:12px"><h3>${title}</h3><div style="overflow-x:auto"><table class="heat">
      <tr><th class="nosort"></th>${cols.map((c) => `<th class="nosort">${esc(sn(c.id))}</th>`).join("")}</tr>
      ${rows.map((r, ri) => `<tr><th class="rh nosort">${esc(sn(r.id))}</th>${cols.map((c) => (c.id === r.id ? "<td></td>" : cell(r.id, c.id))).join("")}</tr>`).join("")}
    </table></div></div>`;
  const playedType = (list, type) => list.filter((p) => D.pairs.some((x) => x.type === type && (x.a === p.id || x.b === p.id)));
  const mm = playedType(men, "male"), ww = playedType(women, "female");
  section(matrix(playedType(men, "mixed"), playedType(women, "mixed"), "Mixed (men down, women across)") + `<div class="grid g2">${matrix(mm, mm, "Men's doubles")}${matrix(ww, ww, "Women's doubles")}</div>`);

  const opts = D.players.filter((p) => p.g > 0).map((p) => `<option value="${p.id}" ${p.id === focus ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  const box = section(`<h2>All pairs</h2><div class="row" style="margin-bottom:10px">
      <label>Player&nbsp;<select id="pf"><option value="">Everyone</option>${opts}</select></label>
      <label>Min games&nbsp;<select id="pm"><option>1</option><option selected>2</option><option>3</option><option>4</option></select></label></div><div id="pt"></div>`);
  const draw = () => {
    const f = $("#pf").value, mg = Number($("#pm").value);
    const rows = D.pairs.filter((p) => p.g >= mg && (!f || p.a === f || p.b === f));
    sortableTable($("#pt"), [
      { key: "names", label: "Pair", html: (p) => `<b>${esc(sn(p.a))} + ${esc(sn(p.b))}</b>`, sort: (p) => sn(p.a) },
      { key: "type", label: "Type", html: (p) => ({ male: "Men's", female: "Women's", mixed: "Mixed" }[p.type]) },
      { key: "g", label: "Games", num: true },
      { key: "w", label: "W-L", num: true, html: (p) => `${p.w}-${p.l}`, sort: (p) => p.w / p.g },
      { key: "diff", label: "+/- per game", num: true, html: (p) => `<span class="${cls(p.diff)}">${signed(p.diff)}</span>` },
      { key: "chem", label: "Chemistry", num: true, html: (p) => `<span class="${cls(p.chem)}">${signed(p.chem)}</span>`, tip: "Points per game above/below what the two players' ratings predict" },
      { key: "strength", label: "Est. win %", num: true, html: (p) => Math.round(p.winProb * 100) + "%", tip: "Estimated chance vs an average pair in the division" },
    ], rows, { key: "strength", dir: -1 });
  };
  box.querySelectorAll("select").forEach((s) => s.addEventListener("change", draw));
  draw();
}

/* ------------------------------------------------------------ SCHEDULE */
function schedule() {
  section(`<h2>Season schedule & results</h2>`);
  const el = section("");
  sortableTable(el, [
    { key: "week", label: "Wk", num: true },
    { key: "time", label: "Date", html: (s) => fmtDate(s.time) },
    { key: "opp", label: "Opponent", html: (s) => `${s.home ? "vs" : "@"} <a href="#scouting/${encodeURIComponent(s.opp)}">${esc(s.opp)}</a>` },
    { key: "result", label: "Result", html: (s) => (s.result ? `<span class="pill ${s.result}">${s.result}</span>` : s.done ? "–" : `<span class="muted">upcoming</span>`) },
    { key: "usPts", label: "Points", num: true, html: (s) => (s.done ? `${s.usPts}–${s.themPts}` : "") },
    { key: "usGames", label: "Games won", num: true, html: (s) => (s.done ? `${s.usGames}–${s.themGames}` : "") },
  ], D.schedule, { key: "week", dir: 1 });

  const weeks = D.schedule;
  const people = [...D.players.filter((p) => weeks.some((s) => s.avail[p.id]))].sort((a, b) => a.isSub - b.isSub || (a.gender > b.gender ? 1 : -1));
  const extra = [...new Set(weeks.flatMap((s) => Object.keys(s.avail).filter((k) => k.startsWith("sheet:"))))];
  const short = { yes: "✓", no: "✗", maybe: "?" };
  section(`<h2>Who's in each week</h2>
    <p class="muted">From the <a href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">team sheet</a>. Update the sheet and this page refreshes on its own within a few hours.</p>
    <div class="tbl-wrap"><table class="avail"><thead><tr><th class="nosort">Player</th>${weeks.map((s) => `<th class="nosort num" data-tip="${esc(fmtDate(s.time, false) + " vs " + s.opp)}">W${s.week}</th>`).join("")}</tr></thead><tbody>
    ${people.map((p) => `<tr><td>${esc(sn(p.id))} <span class="tag">${p.gender === "Male" ? "M" : "W"}${p.isSub ? " · sub" : ""}</span></td>${weeks.map((s) => {
      const v = s.avail[p.id] || "";
      return `<td class="a"><span class="pill ${v in short ? v : "none"}">${short[v] || "·"}</span></td>`;
    }).join("")}</tr>`).join("")}
    ${extra.map((k) => `<tr><td>${esc(k.slice(6))} <span class="tag">not on CPL roster</span></td>${weeks.map((s) => `<td class="a">${esc(short[s.avail[k]] || "·")}</td>`).join("")}</tr>`).join("")}
    <tr><td><b>Men in</b></td>${weeks.map((s) => { const n = Object.keys(s.avail).filter((id) => s.avail[id] === "yes" && isMale(id)).length; return `<td class="a ${n < 4 ? "neg" : ""}"><b>${n}</b></td>`; }).join("")}</tr>
    <tr><td><b>Women in</b></td>${weeks.map((s) => { const n = Object.keys(s.avail).filter((id) => s.avail[id] === "yes" && P[id] && !isMale(id)).length; return `<td class="a ${n < 4 ? "neg" : ""}"><b>${n}</b></td>`; }).join("")}</tr>
    </tbody></table></div>`);
  scheduleExtras();
}

/* ------------------------------------------------------------ SCOUTING */
function teamScorecard(team, lu, label) {
  // lu.games rows: [n, mine, theirs, myScore, theirScore] from `team`'s point of view
  const games = lu.games.map(([n, mine, theirs, a, b]) => ({ n, us: mine, them: theirs, usScore: a, themScore: b }));
  const w = games.filter((g) => g.usScore > g.themScore).length;
  return `<details class="sc-d card"><summary>${label} — games ${w}-${games.length - w}</summary>
    <div class="grid gsc" style="margin-top:8px">${scorecardHTML(games, lu.opp, { scores: true }).replaceAll(">Frog<", `>${esc(team)}<`)}</div></details>`;
}

function scouting(arg) {
  const teams = Object.keys(D.scouting).sort();
  const nm = nextMatch();
  let team = arg ? decodeURIComponent(arg) : nm ? nm.opp : teams[0];
  if (!D.scouting[team]) team = teams[0];
  const sc = D.scouting[team], st = D.standings.find((t) => t.team === team) || {};
  const our = D.standings.find((t) => t.isUs) || {};
  const ts = sc.typeStrength || {}, us = D.typeStrength[D.team] || {};
  const box = section(`<h2>Scouting report</h2>
    <label>Opponent&nbsp;<select id="sct">${teams.map((t) => `<option ${t === team ? "selected" : ""}>${esc(t)}</option>`).join("")}</select></label>`);
  box.querySelector("select").addEventListener("change", (e) => (location.hash = "#scouting/" + encodeURIComponent(e.target.value)));
  const upcoming = D.schedule.filter((s) => s.opp === team && !s.done);
  const cmp = (t) => {
    const d = (us[t] ?? 0) - (ts[t] ?? 0);
    return `<tr><td>${TYPE_LABEL[t]}</td><td class="num">${st[{ mixed: "mixedRate", male: "mensRate", female: "womensRate" }[t]] != null ? Math.round(st[{ mixed: "mixedRate", male: "mensRate", female: "womensRate" }[t]]) + "%" : "–"}</td>
      <td class="num"><span class="rating ${cls(ts[t])}">${signed(ts[t])}</span></td><td class="num"><span class="rating ${cls(us[t])}">${signed(us[t])}</span></td>
      <td class="num"><b class="${d > 0.5 ? "pos" : d < -0.5 ? "neg" : ""}">${d > 0.5 ? "Edge us" : d < -0.5 ? "Edge them" : "Even"}</b></td></tr>`;
  };
  section(`<div class="grid g3" style="margin-top:12px">
      <div class="card stat"><div class="num">${esc(st.record || "–")}</div><div class="lbl">Their record · #${esc(st.rank ?? "–")} in league</div></div>
      <div class="card stat"><div class="num">${upcoming.length ? fmtDate(upcoming[0].time, false) : "–"}</div><div class="lbl">${upcoming.length ? `Next meeting (${upcoming[0].home ? "home" : "away"}) · <a href="#lineup/${upcoming[0].week}">game plan →</a>` : "No more meetings scheduled"}</div></div>
      <div class="card stat">${sc.h2h.length
        ? sc.h2h.map((h) => `<div class="num ${h.result === "W" ? "pos" : "neg"}" style="font-size:24px">${h.result === "W" ? "Won" : "Lost"} ${h.usGames}–${h.themGames}</div>
            <div class="lbl">Week ${h.week} vs them · games won (points ${h.us}–${h.them})</div>`).join("")
        : `<div class="num" style="font-size:24px">Not played yet</div><div class="lbl">Our results vs them this season</div>`}</div>
    </div>
    <h2>Key takeaways</h2>
    <div class="grid g2">${sc.notes.map((n) => `<div class="card insight tip">${esc(n)}</div>`).join("")}</div>
    <h2>Matchup by game type</h2>
    <div class="tbl-wrap"><table><thead><tr><th class="nosort">Type</th><th class="nosort num">Their game win %</th>
      <th class="nosort num" data-tip="Average strength of the pairs they put out (0 = division average)">Their typical pair</th><th class="nosort num">Our typical pair</th><th class="nosort num"></th></tr></thead>
      <tbody>${["mixed", "female", "male"].map(cmp).join("")}</tbody></table></div>`);

  const pname = (p) => p.ids.map(lname).join(" + ");
  const pcard = (p, good) => `<div class="card"><b>${esc(pname(p))}</b> <span class="tag">${TYPE_LABEL[p.type]}</span>
    <div>${p.w}-${p.g - p.w} together · <span class="${cls(p.diff)}">${signed(p.diff)}</span> pts/game</div></div>`;
  const avoid = sc.pairs.filter((p) => p.strength >= 0.5).slice(0, 6);
  const target = sc.pairs.filter((p) => p.g >= 3 && p.strength <= -1.5).sort((a, b) => b.g - a.g || a.strength - b.strength).slice(0, 6);
  section(`<h2>Their pairs</h2><div class="grid g2">
      <div><h3 class="neg">🛑 Strongest — be ready for these</h3><div class="grid">${avoid.map((p) => pcard(p)).join("") || "<p class='muted'>None stand out.</p>"}</div></div>
      <div><h3 class="pos">🎯 Weak pairs they keep using — games we can steal</h3><div class="grid">${target.map((p) => pcard(p)).join("") || "<p class='muted'>None with 3+ games.</p>"}</div></div>
    </div>`);
  const pt = section(`<details class="card" style="margin-top:12px"><summary>All their pairs (${sc.pairs.length})</summary><div style="margin-top:10px"></div></details>`).querySelector("details > div");
  sortableTable(pt, [
    { key: "names", label: "Pair", html: (p) => `<b>${esc(pname(p))}</b>`, sort: (p) => pname(p) },
    { key: "type", label: "Type", html: (p) => TYPE_LABEL[p.type] },
    { key: "g", label: "Games", num: true },
    { key: "w", label: "W-L", num: true, html: (p) => `${p.w}-${p.g - p.w}`, sort: (p) => p.w / p.g },
    { key: "diff", label: "+/- per game", num: true, html: (p) => `<span class="${cls(p.diff)}">${signed(p.diff)}</span>` },
    { key: "strength", label: "Strength", num: true, html: (p) => `<span class="rating ${cls(p.strength)}">${signed(p.strength)}</span>`, tip: "Points per game vs an average pair" },
  ], sc.pairs, { key: "strength", dir: -1 });

  const pl = section(`<h2>Their players</h2><div></div>`).lastElementChild;
  sortableTable(pl, [
    { key: "name", label: "Player" },
    { key: "gender", label: "", nosort: true, html: (p) => (p.gender === "Male" ? "M" : "W") },
    { key: "rating", label: "Rating", num: true, html: (p) => `<span class="rating ${cls(p.rating)}">${signed(p.rating)}</span>` },
    { key: "dupr", label: "DUPR", num: true, html: (p) => (p.dupr ? p.dupr.toFixed(2) : "–") },
    { key: "games", label: "Games", num: true },
  ], sc.players, { key: "rating", dir: -1 });

  const lus = (D.lineups[team] || []).slice().reverse();
  if (lus.length)
    section(`<h2>Their scorecards</h2><p class="muted">Every lineup they've played this season — shows who they pair together and where they put them.</p>
      ${lus.map((lu) => teamScorecard(team, lu, `Week ${lu.week} vs ${esc(lu.opp)}${lu.opp === D.team ? " ⭐" : ""}`)).join("")}`);
}

/* ------------------------------------------------------------ SCHEDULE extras */
function scheduleExtras() {
  const ours = (D.lineups[D.team] || []).slice().reverse();
  if (ours.length)
    section(`<h2>Our scorecards</h2>${ours.map((lu) => teamScorecard(D.team, lu, `Week ${lu.week} vs ${esc(lu.opp)}`)).join("")}`);
  const weeks = Object.keys(D.playingTime).map(Number).sort((a, b) => a - b);
  if (!weeks.length) return;
  const ids = D.players.filter((p) => p.g > 0).sort((a, b) => a.gender.localeCompare(b.gender) || b.g - a.g);
  section(`<h2>Playing time (games per match)</h2>
    <p class="muted">Out of 8 possible per match. Goal: everyone of the same gender within about 1 game of each other, nobody under ${MIN_GAMES}.</p>
    <div class="tbl-wrap"><table><thead><tr><th class="nosort">Player</th>${weeks.map((w) => `<th class="nosort num">W${w}</th>`).join("")}<th class="nosort num">Avg</th></tr></thead><tbody>
    ${ids.map((p) => {
      const vals = weeks.map((w) => D.playingTime[w][p.id]);
      const played = vals.filter((v) => v);
      return `<tr><td>${esc(sn(p.id))} <span class="tag">${p.gender === "Male" ? "M" : "W"}${p.isSub ? " · sub" : ""}</span></td>${vals
        .map((v) => `<td class="num ${v && v < MIN_GAMES ? "neg" : ""}">${v || '<span class="muted">·</span>'}</td>`).join("")}
        <td class="num"><b>${played.length ? (played.reduce((a, b) => a + b, 0) / played.length).toFixed(1) : "–"}</b></td></tr>`;
    }).join("")}</tbody></table></div>`);
}

/* ------------------------------------------------------------ ABOUT */
function about() {
  const m = D.model;
  section(`<h2>How it works</h2>
  <div class="card">
    <h3>Where the data comes from</h3>
    <p>Every game result in the ${esc(D.division)} division comes from the CPL website (${m.games} games so far, all teams — not just ours).
      Who's playing each week comes from the <a href="${esc(D.sheetUrl)}" target="_blank" rel="noopener">team sheet</a>. This site rebuilds itself automatically every few hours, so results and sheet changes show up on their own.</p>
    <h3>Player rating</h3>
    <p>Win-loss records can mislead: if you always play with the strongest partner, or always face the other team's best pair, your record doesn't reflect you.
      The rating looks at every game in the division and works out how many points per game each player adds compared with an average player,
      after accounting for who their partner was and who they played against. <b>+2.0</b> means "adds about 2 points per game"; <b>0</b> is division average.
      Players with few games are pulled toward 0 so one lucky week doesn't make someone look like a star.</p>
    <h3>Chemistry</h3>
    <p>For each of our pairs we compare how they actually did with what their two ratings predicted. A positive number means they play better together than apart.
      It's shrunk toward 0 for pairs with only a game or two.</p>
    <h3>Game Plan (lineup builder)</h3>
    <p>CPL matches are 32 games: 8 rounds of 4 games, one game per court. Rounds 1, 3, 5, 7 are 4 mixed games; rounds 2, 4, 6, 8 are 2 women's + 2 men's games. Each player plays at most once per round, so 8 games is the max.
      <b>It's automatic:</b> it starts from everyone marked In on the sheet, fills any gap from Maybes then subs (flagged so you can confirm), and if more than 5 men or 5 women are in, it sits out whoever
      helps least so everyone else still gets 6+ games. The same data always gives the same lineup, so every teammate sees the same plan.
      The builder tries tens of thousands of lineups and keeps the one with the most expected game wins, while keeping playing time nearly equal (same-gender teammates within 1 game, everyone at least ${MIN_GAMES} of the 8 possible games — so 5 men + 5 women is the most you can bring and still give everyone 6).
      Lineup timing: the <b>away</b> team locks its lineup by Thu 8pm; the <b>home</b> team sees it and sets theirs by Fri 8pm, deciding who plays whom.
      When we're <b>home</b>, the site picks up their locked lineup within an hour (it checks hourly Thu–Sat) and matches each of our pairs against the exact pair they'll face.
      When we're <b>away</b>, we post blind, so the lineup is built to hold up even if their captain rearranges their pairs against ours. Win chances are estimates — a 60% pair still loses 4 out of 10.
      As a reality check, the model was tested on each match while hiding that match's results: it picked the winning pair <b>${m.oosAccuracy}%</b> of the time, and its win chances match reality:
      ${(m.calibration || []).map((c) => `games it called ${c.band} were won ${c.actual}% of the time`).join("; ")}.</p>
    <h3>Scoring</h3>
    <p>Games are rally scoring to 21. Every match so far has been won by the team that won more games, so the builder maximises games won; total points act as the tiebreaker.</p>
    <h3>DUPR</h3>
    <p>DUPR ratings shown are the ones linked to each player's CPL profile. Players without one show "–". Across the division, each +0.1 DUPR is worth about
      ${m.duprFit ? (m.duprFit.slope / 10).toFixed(1) : "?"} points per game in our rating, so DUPR is a decent but rough predictor here.</p>
    ${D.unmatched.length ? `<h3>Sheet names not linked</h3><p>These sheet names couldn't be matched to a CPL player: ${D.unmatched.map(esc).join(", ")}.</p>` : ""}
  </div>`);
}
