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
  { id: 'spell', name: 'Spellbound Mayhem 咒語大亂鬥', players: '2+ players', ready: true,
    blurb: '看得到別人的符石，卻看不到自己的。猜對就施放咒語，先到目標分數獲勝。' },
  { id: 'bw11', name: 'Black, White & Eleven', players: '2+ players', ready: true,
    blurb: 'Guess the hidden numbers in everyone’s tiles. Lie, call bluffs, and feed the Liar’s Pot.' }
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
  // Colors go round in the order people joined, so neighbours never look alike.
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
socket.on('emote', p => showEmote(p.pid, p.id));
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
  let res = await emit('join', { code, name, pid: PID, secret: SECRET });
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
  const res = await emit('create', { name, pid: PID, secret: SECRET });
  S.joining = false;
  if (res.ok) joined(res.code);
  else S.homeError = res.error || 'Couldn’t start a room.';
  render();
}

/* ---------- emotes ---------- */
function emoteFace(e) {
  return e.src ? `<img src="${esc(e.src)}" alt="">` : esc(e.emoji || '🙂');
}
function renderEmoteBar() {
  const bar = $('emotebar');
  const show = !!S.st && S.catalog.emotes.length > 0;
  bar.hidden = !show;
  document.body.classList.toggle('inroom', show);
  if (!show || $('emoteIn').childElementCount) return;
  $('emoteIn').innerHTML = S.catalog.emotes.map(e =>
    `<button type="button" data-act="emote" data-k="${esc(e.id)}" aria-label="${esc(e.label)}" title="${esc(e.label)}">${emoteFace(e)}</button>`).join('');
}
function sendEmote(id) {
  const t = Date.now();
  if (t - S.emoteAt < 650) return;
  S.emoteAt = t;
  const btns = $('emoteIn').querySelectorAll('button');
  btns.forEach(b => b.classList.add('cool'));
  setTimeout(() => btns.forEach(b => b.classList.remove('cool')), 650);
  emit('emote', { id });
}
/* Float the emote up from above the player's avatar, wherever it is on screen right now. */
function showEmote(pid, id) {
  const e = S.catalog.emotes.find(x => x.id === id);
  if (!e) return;
  const els = [...document.querySelectorAll(`[data-avatar="${CSS.escape(pid)}"]`)].filter(el => el.offsetParent);
  const layer = $('emotelayer');
  let x, y;
  if (els.length) {
    const r = els[0].getBoundingClientRect();
    x = r.left + r.width / 2; y = r.top - 52;
  } else {
    x = window.innerWidth / 2; y = window.innerHeight / 2;
  }
  // Several emotes from the same player in a row fan out a little.
  x += (Math.random() - 0.5) * 18;
  const el = document.createElement('div');
  el.className = 'floatemote';
  el.innerHTML = emoteFace(e);
  el.style.left = x + 'px';
  el.style.top = Math.max(4, y) + 'px';
  layer.appendChild(el);
  setTimeout(() => el.remove(), 2200);
}

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
  renderEmoteBar();
  const st = S.st;
  const main = $('main');
  $('roomchip').innerHTML = st ? `Room <b>${esc(st.code)}</b>` : '';
  if (!st) return renderHome(main);
  if (st.game && games[st.game.id]) {
    document.title = games[st.game.id].title + ' · Game Night';
    return games[st.game.id].render(main, st, api);
  }
  document.title = 'Game Night';
  renderRoom(main, st);
}
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

/* room */
function renderRoom(main, st) {
  S.built = 'room:' + st.code;
  const host = isHost();
  const link = location.origin + '/' + st.code;
  const crowd = st.players.map(p => {
    const kick = host && p.pid !== st.you
      ? `<button type="button" class="linkbtn${armed('kick', p.pid) ? ' armed' : ''}" data-act="kick" data-k="${esc(p.pid)}">${armed('kick', p.pid) ? 'sure?' : 'remove'}</button>` : '';
    return `<li>${avatar(p.pid)}<span class="nm">${esc(p.name)}</span><span class="sub">${p.pid === st.you ? 'you' : (p.connected ? '' : 'away')}${kick}</span></li>`;
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
      <header class="panel-head">
        <div><div class="eyebrow">Room code</div><div class="code">${esc(st.code)}</div></div>
        <button type="button" class="btn" data-act="copy">Copy invite link</button>
      </header>
      <div class="linkline" style="padding-top:14px"><code id="inviteLink">${esc(link)}</code></div>
    </section>
    <section class="panel">
      <header class="panel-head"><h2>In the room</h2><span class="muted">Tap an emote below to react</span></header>
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
    case 'emote': sendEmote(k); break;
    case 'select': st.selected = k; render(); emit('select', { game: k }); break;
    case 'start': {
      b.disabled = true;
      const r = await emit('start');
      if (!r.ok) { b.disabled = false; if (r.error) toast(r.error); }
      break;
    }
    case 'kick': if (armed('kick', k)) { S.arm = null; emit('kick', { pid: k }); } else arm('kick', k); break;
    case 'toRoom': if (armed('toRoom')) { S.arm = null; emit('toRoom'); } else arm('toRoom'); break;
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

/* What games get to use. */
const api = {
  S, esc, emit, now, toast, setText, keepFocus, avatar, nameOf, player, isHost, armed, arm, render,
  get catalog() { return S.catalog; },
  get st() { return S.st; },
  on(act, fn) { handlers[act] = fn; }
};

return {
  api,
  registerGame(id, g) { games[id] = g; },
  boot() {
    render();
    fetch('/catalog.json').then(r => r.json()).then(c => { S.catalog = c; $('emoteIn').innerHTML = ''; S.built = ''; render(); }).catch(() => {});
  }
};
})();
