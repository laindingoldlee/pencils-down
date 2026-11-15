/*
 * The party room: join with a name, see who's here, send emotes, and let the host pick a game.
 * Games played inside the room register themselves with Hub.registerGame (see
 * public/games/fifth-element/client.js). Pencils Down runs on its own page.
 */
window.Hub = (() => {
'use strict';

/* Every game the host can pick. A game marked ready:false shows as "coming soon". */
const GAME_LIST = [
  { id: 'pencils', name: 'Pencils Down', players: '2–12 players', ready: true,
    blurb: 'One letter, a handful of categories, one minute. Fill every box and shout stop.' },
  { id: 'fifth', name: 'The Fifth Element', players: '2+ players', ready: true,
    blurb: 'Five magic items, one card. Grab the right one before anyone else does.' },
  { id: 't7', name: 'The Triple Seven', players: '2+ players', ready: true,
    blurb: 'Keep your face-down cards low. Swap, peek, lock and steal. Three 7s is a perfect zero.' },
  { id: 'cc', name: 'Countercurrent: The Pelagos Protocol', players: '3–4 players', ready: true,
    blurb: 'Two compound samples are sealed away. Scan, trade and steal from rival teams, then claim the formula first.' },
  { id: 'tide', name: 'The Turning Tide', players: '2–4 players', ready: true,
    blurb: 'Scout hidden waters, board rival ships and claim the most of the 4×4 chart. Tide beats Powder beats Gale beats Stone.' },
  { id: 'ss', name: 'Signal Salvage', players: '2–8 players', ready: true,
    blurb: 'Scan a derelict station for salvage. Push your luck: the same signal twice and your run collapses.' },
  { id: 'spell', name: 'Spellbound Mayhem 咒語大亂鬥', players: '2+ players', ready: true,
    blurb: '看得到別人的符石，卻看不到自己的。猜對就施放咒語，先到目標分數獲勝。' },
  { id: 'bw11', name: 'Black, White & Eleven', players: '2+ players', ready: true,
    blurb: 'Guess the hidden numbers in everyone’s tiles. Lie, call bluffs, and feed the Liar’s Pot.' },
  { id: 'ember', name: 'The Ember Crown', players: '3–4 players', ready: true,
    blurb: 'Every rival hides a hand of relics. Scout, spy and steal, then name their whole hand to knock them out.' }
];

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
function rid(n) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = new Uint8Array(n);
  crypto.getRandomValues(r);
  let s = ''; for (const x of r) s += a[x % a.length]; return s;
}
// Same identity as the Pencils Down page, so moving between them keeps your place.
let PID = store.get('pd.pid'), SECRET = store.get('pd.secret');
if (!/^[a-z0-9]{8,32}$/.test(PID || '')) { PID = rid(14); store.set('pd.pid', PID); }
if (!/^[a-z0-9]{8,32}$/.test(SECRET || '')) { SECRET = rid(24); store.set('pd.secret', SECRET); }
function codeFromUrl() {
  const m = location.pathname.match(/^\/([A-Za-z]{4})\/?$/);
  return m ? m[1].toUpperCase() : '';
}

const games = {};
const S = {
  st: null, offset: 0, connected: false, everConnected: false,
  code: codeFromUrl(), name: store.get('pd.name') || '',
  joined: false, joining: false, homeError: '', built: '', arm: null,
  catalog: { emotes: [], fifth: { themes: [], deckSizes: [] } }, emoteAt: 0
};
const now = () => Date.now() + S.offset;
const isHost = () => !!(S.st && S.st.hostPid === S.st.you);
const player = pid => S.st && S.st.players.find(p => p.pid === pid);
const nameOf = pid => (player(pid) || {}).name || 'Someone';
const armed = (act, id) => S.arm && S.arm.act === act && S.arm.id === (id || '') && Date.now() - S.arm.at < 3500;
function arm(act, id) { S.arm = { act, id: id || '', at: Date.now() }; render(); }

/* A player's round avatar. data-avatar marks where their emotes float up from. */
const HUES = [262, 8, 175, 38, 318, 125, 210, 345, 62, 290, 150, 22];
function hueOf(pid) {
  // A colour the player picked comes first.
  const pl = S.st && S.st.players.find(p => p.pid === pid);
  if (pl && Number.isInteger(pl.color)) return HUES[pl.color % HUES.length];
  // Otherwise colors go round in the order people joined, so neighbours never look alike.
  const i = S.st ? S.st.players.findIndex(p => p.pid === pid) : -1;
  if (i >= 0) return HUES[i % HUES.length];
  let h = 0; for (const ch of String(pid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return HUES[h % HUES.length];
}
function avatar(pid, size) {
  const p = player(pid);
  const nm = p ? p.name : '?';
  const initial = (Array.from(nm.trim())[0] || '?').toUpperCase();
  const crown = S.st && S.st.hostPid === pid ? '<span class="crown" title="Host">👑</span>' : '';
  return `<span class="av${p && !p.connected ? ' off' : ''}" data-avatar="${esc(pid)}" style="--hue:${hueOf(pid)};${size ? `--s:${size}px` : ''}" aria-hidden="true">${esc(initial)}${crown}</span>`;
}

/* ---------- connection ---------- */
const socket = io();
socket.on('connect', () => {
  S.connected = true; S.everConnected = true;
  if (S.code && S.name && (S.joined || !S.st)) join(S.code, S.name, true);
  render();
});
socket.on('disconnect', () => { S.connected = false; render(); });
socket.on('state', st => {
  S.offset = st.serverNow - Date.now();
  S.st = st;
  S.joined = true;
  render();
});
socket.on('goto', p => { if (p && typeof p.url === 'string' && p.url.startsWith('/')) location.href = p.url; });
socket.on('emote', p => Shared.emotes.play(p.pid, p.id));
socket.on('fx', fx => {
  const st = S.st;
  if (st && st.game && games[st.game.id] && games[st.game.id].fx) games[st.game.id].fx(fx, st.game, api);
});
socket.on('kicked', () => {
  S.st = null; S.joined = false; S.code = ''; S.built = '';
  S.homeError = 'The host removed you from that room.';
  history.replaceState(null, '', '/');
  render();
});

function emit(event, payload) {
  return new Promise(resolve => {
    if (!S.connected) { toast('Not connected. Hang on, reconnecting…'); return resolve({ ok: false }); }
    socket.timeout(8000).emit(event, payload || {}, (err, res) => resolve(err ? { ok: false, error: 'The server didn’t answer. Try again.' } : (res || { ok: false })));
  });
}
function joined(code) {
  S.code = code; S.homeError = '';
  if (location.pathname !== '/' + code) history.replaceState(null, '', '/' + code);
}
async function join(code, name, quiet) {
  S.joining = true;
  let res = await emit('join', { code, name, pid: PID, secret: SECRET, color: myColor() });
  // The server restarted and forgot the room: bring it back with the same code.
  if (!res.ok && res.gone && S.st && S.st.code === code) {
    const st = S.st;
    res = await emit('restore', { code, name, pid: PID, secret: SECRET, hostPid: st.hostPid, hostName: nameOf(st.hostPid), selected: st.selected, settings: st.settings });
    if (res.ok && st.game) toast('The server restarted, so that game ended. You’re back in the room.');
  }
  S.joining = false;
  if (res.ok) joined(res.code);
  else {
    S.joined = false; S.st = null; S.built = '';
    if (res.gone) { S.code = ''; history.replaceState(null, '', '/'); }
    S.homeError = res.error || (quiet ? '' : 'Couldn’t join that room.');
  }
  render();
}
async function create(name) {
  S.joining = true; render();
  const res = await emit('create', { name, pid: PID, secret: SECRET, color: myColor(), prefs: savedPrefs() });
  S.joining = false;
  if (res.ok) joined(res.code);
  else S.homeError = res.error || 'Couldn’t start a room.';
  render();
}

/* ---------- emotes (shared.js draws the bar and the floating emotes) ---------- */
Shared.emotes.init(id => emit('emote', { id }));

/* ---------- rendering ---------- */
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3800);
}
function setText(id, v) { const el = $(id); if (el && el.textContent !== v) el.textContent = v; }
function keepFocus(container, fn) {
  const a = document.activeElement;
  let sel = null;
  if (a && container.contains(a) && a.dataset && a.dataset.act) {
    sel = '[data-act="' + a.dataset.act + '"]' + (a.dataset.k ? '[data-k="' + CSS.escape(a.dataset.k) + '"]' : '');
  }
  fn();
  if (sel) { const b = container.querySelector(sel); if (b) b.focus({ preventScroll: true }); }
}

function render() {
  renderNotice();
  Shared.emotes.show(!!S.st);
  Shared.keepAwake(!!(S.st && S.st.game)); // keep the phone screen on during a game
  noticeMyMove();
  rememberSettings();
  const st = S.st;
  const main = $('main');
  $('roomchip').innerHTML = st ? `Room <b>${esc(st.code)}</b>` : '';
  if (!st) return renderHome(main);
  if (st.game && games[st.game.id]) {
    document.title = games[st.game.id].title + ' · Game Night';
    games[st.game.id].render(main, st, api);
    return fitGame();
  }
  document.title = 'Game Night';
  renderRoom(main, st);
  fitGame();
}

/* On a computer, a game fills exactly the window: no scrolling and no zooming needed.
   The game's own layout stretches to the height it's given; if it still doesn't fit
   (a big group, a small window), the whole game is shrunk just enough to fit. */
const fitsScreen = () => window.innerWidth >= 900 && window.innerHeight >= 480 && matchMedia('(hover: hover) and (pointer: fine)').matches;
function fitGame() {
  const sec = $('main').querySelector(':scope > section.fe, :scope > section.bw, :scope > section.sp, :scope > section.t7, :scope > section.ec, :scope > section.cc, :scope > section.tt, :scope > section.ss');
  const on = !!sec && fitsScreen();
  document.body.classList.toggle('fitmode', on);
  if (!sec) return;
  sec.style.zoom = '';
  if (!on) { sec.classList.remove('fitted'); sec.style.height = ''; sec.style.removeProperty('--fit-h'); return; }
  const bar = $('emotebar');
  const barH = bar.hidden ? 0 : bar.offsetHeight;
  const top = sec.getBoundingClientRect().top + window.scrollY;
  const avail = Math.max(400, window.innerHeight - top - barH - 10);
  const setH = h => { sec.style.height = h + 'px'; sec.style.setProperty('--fit-h', h + 'px'); };
  sec.classList.add('fitted');
  setH(avail);
  const need = sec.scrollHeight;
  if (need > avail + 2) {
    const z = Math.max(0.55, avail / need);
    sec.style.zoom = z;
    setH(Math.floor(avail / z));
  }
}
let fitT = null;
window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitGame, 120); });
function renderNotice() {
  const el = $('notice');
  let html = '';
  if (!S.connected) html = S.everConnected
    ? '<strong>Reconnecting…</strong> This usually takes a few seconds.'
    : '<strong>Connecting to the server…</strong> If nobody has played for a while, the server takes about a minute to wake up.';
  el.innerHTML = html; el.hidden = !html;
}

/* home */
function renderHome(main) {
  const key = 'home:' + S.code;
  if (S.built !== key) {
    S.built = key;
    main.innerHTML = `
    <section class="panel">
      <div class="hero">
        <h1>Game Night</h1>
        <p>Start a room, send your friends the link, and play party games together. No accounts, just a name.</p>
      </div>
      <div class="homeforms">
        <form id="nameForm" class="field">
          <label for="homeName">Your name</label>
          <input id="homeName" maxlength="20" autocomplete="nickname" placeholder="e.g. Mei" value="${esc(S.name)}">
        </form>
        ${S.code ? `
          <div class="choices">
            <button type="submit" form="nameForm" class="btn primary big" id="goBtn">Join room ${esc(S.code)}</button>
            <button type="button" class="linkbtn" data-act="forget-code">Start a different room instead</button>
          </div>` : `
          <div class="choices">
            <button type="submit" form="nameForm" class="btn primary big" id="goBtn">Start a new room</button>
            <span class="or">or join a friend’s</span>
            <form id="codeForm" class="coderow">
              <input id="homeCode" maxlength="4" placeholder="CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Room code">
              <button type="submit" class="btn big">Join</button>
            </form>
          </div>`}
        <p class="formerror" id="homeError" role="alert"></p>
      </div>
    </section>
    <section class="panel">
      <header class="panel-head"><h2>The games</h2><span class="muted">Start a room, then the host picks one</span></header>
      <div class="games">${GAME_LIST.map(g => `<div class="gcard${g.ready ? '' : ' soon'}"><span class="tag">${g.ready ? esc(g.players) : 'Coming soon'}</span><h3>${esc(g.name)}</h3><p>${esc(g.blurb)}</p></div>`).join('')}</div>
    </section>
    <section class="panel pad howto">
      <h2>How it works</h2>
      <ol>
        <li>One person starts a room and sends the link. Everyone else opens it and types a name. No accounts.</li>
        <li>Tap the emotes at the bottom of the screen to react. They float up above your avatar for everyone.</li>
        <li>The host picks a game, sets the house rules and starts it for the whole room.</li>
        <li>When a game ends, play again or go back to the room and pick another one.</li>
      </ol>
    </section>`;
  }
  setText('homeError', S.homeError);
  const btn = $('goBtn');
  if (btn) btn.disabled = S.joining || !S.connected;
}

/* "Your turn" while you're in another tab or app: a chime and a flashing tab title. */
function noticeMyMove() {
  const st = S.st;
  let msg = '';
  if (st && st.game) {
    const g = games[st.game.id];
    msg = (g && g.myMove && g.myMove(st)) || '';
    if (!S.hadGame) msg = msg || 'Game starting';
  }
  S.hadGame = !!(st && st.game);
  if (msg && msg !== S.lastMove) Shared.attention(msg);
  S.lastMove = msg;
}

/* ---------- fastest Fifth Element reactions tonight ---------- */
function reactionBoard(st) {
  const r = st.reactions || [];
  if (!r.length) return '';
  return `<section class="panel">
    <header class="panel-head"><h2>⚡ Fastest reactions tonight</h2><span class="muted">The Fifth Element · each player’s best correct click</span></header>
    <ol class="tally">${r.map((x, i) => `<li><span class="place">${i + 1}</span>${player(x.pid) ? avatar(x.pid, 30) : '<span></span>'}<span class="nm">${esc((player(x.pid) || {}).name || x.name)}</span><span class="wins">${(x.best / 1000).toFixed(2)}s</span></li>`).join('')}</ol>
  </section>`;
}

/* ---------- tonight's results: wins per player, and the latest games ---------- */
function scoreboard(st) {
  const wins = st.wins || [];
  if (!wins.length) return '';
  const nameNow = x => (player(x.pid) || {}).name || x.name;
  const tally = new Map();
  for (const w of wins) for (const x of w.winners) {
    const t = tally.get(x.pid) || { pid: x.pid, n: 0 };
    t.n++; t.name = nameNow(x);
    tally.set(x.pid, t);
  }
  const rows = [...tally.values()].sort((a, b) => b.n - a.n);
  let place = 0, prev = null;
  const recent = wins.slice(-8).reverse();
  return `<section class="panel">
    <header class="panel-head"><h2>Tonight’s scoreboard</h2><span class="muted">${wins.length} game${wins.length === 1 ? '' : 's'} played</span></header>
    <div class="board">
      <ol class="tally">${rows.map((r, i) => {
        if (r.n !== prev) { place = i + 1; prev = r.n; }
        return `<li><span class="place">${place}</span>${player(r.pid) ? avatar(r.pid, 30) : '<span></span>'}<span class="nm">${esc(r.name)}</span><span class="wins">${r.n} win${r.n === 1 ? '' : 's'}</span></li>`;
      }).join('')}</ol>
      <ul class="recent">${recent.map(w => `<li><b>${esc(w.name)}</b><span>${w.winners.length ? esc(w.winners.map(nameNow).join(' & ')) : 'no winner'}</span></li>`).join('')}</ul>
    </div>
  </section>`;
}

/* ---------- the host's settings, remembered for the next room they start ---------- */
const savedPrefs = () => { try { return JSON.parse(store.get('gn.prefs') || 'null'); } catch (e) { return null; } };
function rememberSettings() {
  const st = S.st;
  if (!st || !isHost()) return;
  const json = JSON.stringify({ selected: st.selected, settings: st.settings });
  if (json !== S.savedPrefs) { S.savedPrefs = json; store.set('gn.prefs', json); }
}

/* ---------- changing your name or avatar colour ---------- */
// The colour you picked, remembered by this browser for the next room.
const myColor = () => { const v = store.get('gn.color'); const c = Number(v); return v !== null && Number.isInteger(c) && c >= 0 && c < HUES.length ? c : undefined; };
function openProfile() {
  const st = S.st, me = player(st && st.you);
  if (!me) return;
  const old = $('profileDlg'); if (old) old.remove();
  const cur = Number.isInteger(me.color) ? me.color : HUES.indexOf(hueOf(me.pid));
  const d = document.createElement('div');
  d.id = 'profileDlg';
  d.className = 'dlg';
  d.innerHTML = `<form class="dlgcard" id="profileForm">
    <h2>You</h2>
    <label class="field"><span class="label">Name</span><input id="pfName" maxlength="20" value="${esc(me.name)}" autocomplete="nickname"></label>
    <div class="field"><span class="label">Avatar colour</span><div class="swatches">${HUES.map((h, i) =>
      `<button type="button" class="sw" data-sw="${i}" style="--hue:${h}" aria-label="Colour ${i + 1}" aria-pressed="${i === cur}"></button>`).join('')}</div></div>
    <div class="dlgrow"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-close>Cancel</button></div>
  </form>`;
  document.body.appendChild(d);
  let pick = cur;
  d.addEventListener('click', e => {
    const sw = e.target.closest('[data-sw]');
    if (sw) { pick = Number(sw.dataset.sw); d.querySelectorAll('.sw').forEach(x => x.setAttribute('aria-pressed', String(x === sw))); }
    if (e.target === d || e.target.closest('[data-close]')) d.remove();
  });
  d.addEventListener('keydown', e => { if (e.key === 'Escape') d.remove(); });
  d.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    e.stopPropagation();
    const name = String($('pfName').value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!name) { $('pfName').focus(); return; }
    const r = await emit('profile', { name, color: pick });
    if (!r.ok) { toast(r.error || 'Couldn’t save that.'); return; }
    S.name = name; store.set('pd.name', name); store.set('gn.color', String(pick));
    d.remove();
  });
  $('pfName').focus();
  $('pfName').select();
}

/* room */
function renderRoom(main, st) {
  S.built = 'room:' + st.code;
  const host = isHost();
  const link = location.origin + '/' + st.code;
  const crowd = st.players.map(p => {
    const kick = host && p.pid !== st.you
      ? `<button type="button" class="linkbtn${armed('kick', p.pid) ? ' armed' : ''}" data-act="kick" data-k="${esc(p.pid)}">${armed('kick', p.pid) ? 'sure?' : 'remove'}</button>` : '';
    const promote = host && p.pid !== st.you && p.connected && !p.bot
      ? `<button type="button" class="linkbtn${armed('make-host', p.pid) ? ' armed' : ''}" data-act="make-host" data-k="${esc(p.pid)}">${armed('make-host', p.pid) ? 'make host?' : 'make host'}</button>` : '';
    const mine = p.pid === st.you;
    return `<li>${mine ? `<button type="button" class="avbtn" data-act="edit-me" title="Change your name or colour">${avatar(p.pid)}<span class="pen" aria-hidden="true">✎</span></button>` : avatar(p.pid)}<span class="nm">${esc(p.name)}</span><span class="sub">${mine ? '<button type="button" class="linkbtn" data-act="edit-me">you · edit</button>' : (p.bot ? '🤖 bot' : (p.connected ? '' : 'away'))}${promote}${kick}</span></li>`;
  }).join('');
  const cards = GAME_LIST.map(g => `<button type="button" class="gcard" data-act="select" data-k="${g.id}" aria-pressed="${st.selected === g.id}" ${g.ready && host ? '' : 'disabled'}>
      <span class="tag">${g.ready ? esc(g.players) : 'Coming soon'}</span><h3>${esc(g.name)}</h3><p>${esc(g.blurb)}</p></button>`).join('');
  const sel = GAME_LIST.find(g => g.id === st.selected) || GAME_LIST[0];
  let settings = '';
  if (sel.id === 'pencils') {
    settings = `<div class="setting stack"><span class="label">How it works</span><p class="muted" style="margin:0">Starting it takes everyone in the room to Pencils Down. The host sets the rounds, time, categories and letters there, then starts the game. When you’re done, use “Back to the party room”.</p></div>`;
  } else if (games[sel.id] && games[sel.id].settings) {
    settings = games[sel.id].settings(st, api);
  }
  const online = st.players.filter(p => p.connected).length;
  const start = host
    ? `<button type="button" class="btn primary big" data-act="start">Start ${esc(sel.name)}</button><span class="muted">${online} player${online === 1 ? '' : 's'} here</span>`
    : `<span class="muted">Waiting for ${esc(nameOf(st.hostPid))} to start ${esc(sel.name)}.</span>`;
  keepFocus(main, () => {
    main.innerHTML = `
    <section class="panel">
      ${st.pencils ? `<div class="banner"><strong>Pencils Down is open.</strong><a class="btn primary" href="/pencils-down/${esc(st.code)}">Go to Pencils Down</a>${host ? '<span class="muted">Or pick another game below to bring everyone back.</span>' : ''}</div>` : ''}
      <div class="invitebox">
        <div class="invitetext">
          <div class="eyebrow">Room code</div><div class="code">${esc(st.code)}</div>
          <code id="inviteLink">${esc(link)}</code>
          <div><button type="button" class="btn" data-act="copy">Copy invite link</button></div>
        </div>
        <figure class="qr"><img src="/qr/${esc(st.code)}.svg" alt="QR code for the invite link" width="132" height="132"><figcaption>Scan to join</figcaption></figure>
      </div>
    </section>
    ${scoreboard(st)}
    ${reactionBoard(st)}
    <section class="panel">
      <header class="panel-head"><h2>In the room</h2>${host ? `<span class="row" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button type="button" class="btn" data-act="addBot">🤖 Add a bot</button><span class="muted">Bots play by the rules, not well. Good for practice.</span></span>` : '<span class="muted">Tap an emote below to react</span>'}</header>
      <ul class="crowd">${crowd}</ul>
    </section>
    <section class="panel">
      <header class="panel-head"><h2>Pick a game</h2><span class="muted">${host ? 'You’re the host, so you choose.' : 'The host chooses.'}</span></header>
      <div class="games">${cards}</div>
      <div class="settings">${settings}</div>
      <div class="startrow">${start}<span style="margin-left:auto"><button type="button" class="linkbtn" data-act="leave">Leave the room</button></span></div>
    </section>`;
  });
}

/* ---------- events ---------- */
const handlers = {}; // extra data-act handlers from games
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const act = b.dataset.act, k = b.dataset.k, st = S.st;
  if (handlers[act]) return handlers[act](b, k, e);
  switch (act) {
    case 'forget-code': S.code = ''; S.homeError = ''; history.replaceState(null, '', '/'); render(); break;
    case 'copy': {
      const link = location.origin + '/' + st.code;
      try { await navigator.clipboard.writeText(link); toast('Invite link copied.'); }
      catch (err) { const r = document.createRange(); r.selectNodeContents($('inviteLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Link selected. Copy it to send to friends.'); }
      break;
    }
    case 'select': st.selected = k; render(); emit('select', { game: k }); break;
    case 'start': {
      b.disabled = true;
      const r = await emit('start');
      if (!r.ok) { b.disabled = false; if (r.error) toast(r.error); }
      break;
    }
    case 'edit-me': openProfile(); break;
    case 'make-host': if (armed('make-host', k)) { S.arm = null; emit('makeHost', { pid: k }); } else arm('make-host', k); break;
    case 'kick': if (armed('kick', k)) { S.arm = null; emit('kick', { pid: k }); } else arm('kick', k); break;
    case 'toRoom': if (armed('toRoom')) { S.arm = null; emit('toRoom'); } else arm('toRoom'); break;
    case 'addBot': b.disabled = true; emit('addBot').then(r => { if (r && !r.ok && r.error) toast(r.error); }); break;
    case 'toRoomNow': b.disabled = true; emit('toRoom'); break;
    case 'again': b.disabled = true; emit('again'); break;
    case 'leave':
      await emit('leave');
      S.st = null; S.joined = false; S.code = ''; S.built = ''; S.homeError = '';
      history.replaceState(null, '', '/');
      render();
      break;
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  const id = e.target.id;
  if (id !== 'nameForm' && id !== 'codeForm') return;
  const name = String($('homeName').value || '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!name) { S.homeError = 'Type your name first.'; render(); $('homeName').focus(); return; }
  S.name = name; store.set('pd.name', name);
  if (id === 'codeForm') {
    const code = String($('homeCode').value || '').trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(code)) { S.homeError = 'Room codes are four letters.'; render(); return; }
    join(code, name);
  } else if (S.code) join(S.code, name);
  else create(name);
});
document.addEventListener('input', e => {
  if (e.target.id === 'homeCode') e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
});
window.addEventListener('popstate', () => { S.code = codeFromUrl(); if (!S.st) { S.built = ''; render(); } });

setInterval(() => {
  const st = S.st;
  if (st && st.game && games[st.game.id] && games[st.game.id].tick) games[st.game.id].tick(st, api);
  if (S.arm && Date.now() - S.arm.at >= 3500) { S.arm = null; render(); }
}, 100);

/* Game drop-downs ("What happened", "How to play") stay open across redraws. */
const ddOpen = {};
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches && d.matches('details[data-dd]')) ddOpen[d.dataset.dd] = d.open;
}, true);
function dd(key, label, body, cls) {
  return `<details class="dd ${cls || ''}" data-dd="${key}"${ddOpen[key] ? ' open' : ''}><summary>${label}</summary><div class="ddbody">${body}</div></details>`;
}

/* What games get to use. */
const api = {
  S, esc, emit, now, toast, setText, keepFocus, avatar, hueOf, nameOf, player, isHost, armed, arm, render, dd,
  get catalog() { return S.catalog; },
  get st() { return S.st; },
  on(act, fn) { handlers[act] = fn; }
};

return {
  api,
  registerGame(id, g) { games[id] = g; },
  boot() {
    render();
    $('soundSlot').innerHTML = Shared.soundButtonHTML();
    fetch('/catalog.json').then(r => r.json()).then(c => { S.catalog = c; Shared.emotes.set(c.emotes); S.built = ''; render(); }).catch(() => {});
  }
};
})();
