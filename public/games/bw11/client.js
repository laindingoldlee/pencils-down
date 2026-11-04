/*
 * Black, White & Eleven: what each player sees and clicks.
 * Rules live on the server (games/black-white-eleven.js). This page only ever gets the
 * numbers it's allowed to see: your own tiles, and tiles that have been flipped.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;
const COLOR_NAMES = ['black', 'white', 'blue', 'red', 'green', 'yellow'];
const L = { sel: null, val: null, stepKey: '', flips: new Map(), audio: null };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const ord = n => n + (['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
const recommended = n => Math.min(6, Math.max(2, Math.ceil(n / 2)));
const valName = v => (v === -1 ? 'wild' : String(v));

/* ---------- room settings ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.bw11 || { colors: 0, wilds: false };
  const online = st.players.filter(p => p.connected).length;
  const rec = recommended(online);
  const opts = [0, 2, 3, 4, 5, 6];
  return `
  <div class="setting"><span class="label" id="bwColLbl">Tile colors<br><small class="muted" style="font-weight:400">Recommended for ${online} player${online === 1 ? '' : 's'}: ${rec}</small></span>
    <div class="seg" role="group" aria-labelledby="bwColLbl">${opts.map(n => `<button type="button" data-act="bw-colors" data-k="${n}" aria-pressed="${s.colors === n}" ${host ? '' : 'disabled'}>${n === 0 ? `Auto (${rec})` : n}</button>`).join('')}</div></div>
  <div class="setting"><span class="label" id="bwWildLbl">Wildcards<br><small class="muted" style="font-weight:400">One per color, placed anywhere</small></span>
    <div class="seg" role="group" aria-labelledby="bwWildLbl">
      <button type="button" data-act="bw-wilds" data-k="0" aria-pressed="${!s.wilds}" ${host ? '' : 'disabled'}>Off</button>
      <button type="button" data-act="bw-wilds" data-k="1" aria-pressed="${!!s.wilds}" ${host ? '' : 'disabled'}>On</button></div></div>
  <div class="setting stack"><span class="label">How to play</span>${rulesList(s.wilds)}</div>`;
}
function rulesList(wilds) {
  return `<ul class="rules">
    <li>Tiles are numbered 0 to 11. Everyone sees the color of every tile, but only you see your own numbers.</li>
    <li>Each row runs from smallest to largest. For the same number: black &lt; white &lt; blue &lt; red &lt; green &lt; yellow.</li>
    <li>Start by picking the colors of your 3 tiles. On your turn, draw a tile (pick its color), then point at someone’s hidden tile and name its number${wilds ? ', or call it the wildcard' : ''}.</li>
    <li>They answer Yes or No, and they may lie with a No. Accept it, and a chip goes into the <b>Liar’s Pot</b>. Or call the bluff: whoever was wrong flips as many of their tiles as there are chips in the pot.</li>
    <li>Right: the tile is flipped, and you can draw again and keep guessing, or stop. Wrong: flip the tile you just drew.</li>
    ${wilds ? '<li>A wildcard goes wherever you put it, once, and stays there. To flip it, someone has to guess “wild”.</li>' : ''}
    <li>Once every tile in your row is flipped, you’re out. Last one standing wins.</li>
  </ul>`;
}
H.on('bw-colors', (b, k) => { H.st.settings.bw11.colors = Number(k); H.render(); H.emit('settings', { game: 'bw11', patch: { colors: Number(k) } }); });
H.on('bw-wilds', (b, k) => { H.st.settings.bw11.wilds = k === '1'; H.render(); H.emit('settings', { game: 'bw11', patch: { wilds: k === '1' } }); });

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('bw-draw', (b, k) => move({ a: 'draw', color: Number(k) }));
H.on('bw-slot', (b, k) => move({ a: 'place', slot: Number(k) }));
H.on('bw-tile', (b, k) => {
  const [pid, id] = k.split('|');
  L.sel = { pid, id: Number(id) };
  H.render();
});
H.on('bw-num', (b, k) => { L.val = k === 'wild' ? -1 : Number(k); H.render(); });
H.on('bw-guess', async b => {
  if (!L.sel || L.val == null) return;
  b.disabled = true;
  const r = await move({ a: 'guess', target: L.sel.pid, id: L.sel.id, value: L.val === -1 ? 'wild' : L.val });
  if (r.ok) { L.sel = null; L.val = null; }
});
H.on('bw-yes', () => move({ a: 'answer', yes: true }));
H.on('bw-no', () => move({ a: 'answer', yes: false }));
H.on('bw-accept', () => move({ a: 'accept' }));
H.on('bw-call', () => move({ a: 'call' }));
H.on('bw-more', () => move({ a: 'more' }));
H.on('bw-stop', () => move({ a: 'stop' }));

/* ---------- drawing ---------- */
function tileHTML(g, pid, t, opts) {
  const o = opts || {};
  const show = t.n != null;
  const cls = ['tile', 'c' + t.c];
  if (!show) cls.push('back');
  if (t.up) cls.push('up');
  if (o.mine) cls.push('mine');
  if (g.turn && g.turn.drawn === t.id && g.phase === 'play') cls.push('drawn');
  if (o.pick) cls.push('pick');
  if (L.sel && L.sel.id === t.id) cls.push('sel');
  const fl = L.flips.get(t.id);
  if (fl && Date.now() - fl < 900) cls.push('flipping');
  const label = `${COLOR_NAMES[t.c]} ${show ? (t.n === -1 ? 'wildcard' : t.n) : 'tile'}${t.up ? ', revealed' : ''}`;
  const face = show ? (t.n === -1 ? '<span class="wildmark">★</span>' : t.n) : '';
  let q = '';
  const gu = g.turn && g.turn.guess;
  if (gu && gu.id === t.id && (g.turn.step === 'answer' || g.turn.step === 'verdict')) q = `<span class="q">${esc(valName(gu.value))}?</span>`;
  const tag = o.pick ? 'button' : 'span';
  return `<${tag} ${o.pick ? `type="button" data-act="bw-tile" data-k="${esc(pid)}|${t.id}"` : ''} class="${cls.join(' ')}" aria-label="${esc(label)}">${face}${q}</${tag}>`;
}
function rack(g, pid, st, opts) {
  const row = g.hands[pid] || [];
  const o = opts || {};
  const parts = [];
  row.forEach((t, i) => {
    if (o.slots && i >= o.slots.from && i <= o.slots.to) parts.push(`<button type="button" class="slot" data-act="bw-slot" data-k="${i}" aria-label="Put it here">+</button>`);
    parts.push(tileHTML(g, pid, t, { mine: pid === st.you, pick: o.pickable && !t.up }));
  });
  if (o.slots && o.slots.to === row.length) parts.push(`<button type="button" class="slot" data-act="bw-slot" data-k="${row.length}" aria-label="Put it here">+</button>`);
  return `<div class="rack">${parts.join('')}</div>`;
}

function render(main, st) {
  const g = st.game;
  H.S.built = 'bw11:' + st.code;
  const me = st.you;
  const t = g.turn;
  const playing = g.order.includes(me);
  const myTurn = t && t.pid === me && g.phase === 'play';
  // Forget a half-made guess when the turn moves on.
  const key = t ? t.pid + ':' + t.step + ':' + (t.right || 0) : g.phase;
  if (key !== L.stepKey) { L.stepKey = key; if (!(t && t.step === 'guess' && myTurn)) { L.sel = null; L.val = null; } }
  if (L.sel && (!g.hands[L.sel.pid] || !g.hands[L.sel.pid].some(x => x.id === L.sel.id && !x.up))) L.sel = null;

  const canPickTiles = myTurn && t.step === 'guess';
  const drawLive = (g.phase === 'setup' && playing && !g.mine && (g.hands[me] || []).length < 3) || (myTurn && t.step === 'draw');
  const pile = g.pool.map((n, c) => `<button type="button" class="pilebtn${drawLive ? ' live' : ''}" data-act="bw-draw" data-k="${c}" ${drawLive && n ? '' : 'disabled'} aria-label="Draw a ${COLOR_NAMES[c]} tile (${n} left)"><span class="tile c${c} back"></span>${n}</button>`).join('');
  const chips = Array.from({ length: Math.min(g.pot, 14) }, () => '<span class="chip"></span>').join('');

  const others = g.order.filter(pid => pid !== me);
  const seat = (pid, isMe) => {
    const dead = g.dead.includes(pid);
    const kills = g.killsBy[pid] || 0;
    const status = dead ? '💀 out' : (t && t.pid === pid && g.phase === 'play' ? 'their turn' : (g.phase === 'setup' ? ((g.setupDone || []).includes(pid) ? 'ready' : 'picking…') : ''));
    const opts = isMe
      ? { slots: g.mine ? g.mine.slots : null }
      : { pickable: canPickTiles && !dead };
    return `<div class="bseat${t && t.pid === pid && g.phase === 'play' ? ' turn' : ''}${dead ? ' dead' : ''}${isMe ? ' me' : ''}">
      <div class="who">${H.avatar(pid, 40)}<span class="nm">${esc(isMe ? 'You' : H.nameOf(pid))}<small>${esc(isMe && t && t.pid === me && g.phase === 'play' ? 'your turn' : status)}${kills ? ` · ${kills} kill${kills > 1 ? 's' : ''}` : ''}</small></span></div>
      ${rack(g, pid, st, opts)}</div>`;
  };

  const legend = g.colorNames.map((c, i) => `<span class="tile c${i}" title="${c}"></span>`).join('<span>&lt;</span>');
  H.keepFocus(main, () => {
    main.innerHTML = `<section class="bw" aria-label="Black, White and Eleven">
      <div class="bw-top"><div class="bw-title">Black, White &amp; Eleven</div>
        <span class="bw-legend" title="Order for the same number">${legend}</span>
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}</div>
      <div class="bw-table">
        <div class="pot" title="Liar’s Pot"><span class="chips">${chips}</span><span><b>${g.pot}</b><small>Liar’s<br>Pot</small></span></div>
        <div class="bw-pile" aria-label="Tiles left to draw">${g.poolLeft ? pile : '<span class="muted">No tiles left to draw</span>'}</div>
      </div>
      ${g.phase === 'over' ? overHTML(g, st) : actionHTML(g, st)}
      <div class="bw-seats">${others.map(pid => seat(pid, false)).join('')}</div>
      ${playing ? `<div class="bw-seats">${seat(me, true)}</div>` : '<p class="muted" style="margin:0">You joined after this game started, so you’re watching this one.</p>'}
      <details class="bw-log" ${L.logOpen ? 'open' : ''}><summary>What happened</summary><ol>${g.log.slice().reverse().map(e => `<li>${logLine(e, st)}</li>`).join('')}</ol></details>
      <details class="bw-rules"><summary>How to play</summary>${rulesList(g.wilds)}</details>
    </section>`;
  });
  const lg = main.querySelector('.bw-log');
  if (lg) lg.addEventListener('toggle', () => { L.logOpen = lg.open; });
}

function who(pid, st) { return pid === st.you ? 'You' : esc(H.nameOf(pid)); }
function logLine(e, st) {
  const p = who(e.pid, st);
  switch (e.k) {
    case 'start': return 'The game started.';
    case 'draw': return `${p} drew a ${COLOR_NAMES[e.c]} tile.`;
    case 'stop': return `${p} stopped guessing.`;
    case 'skip': return `${p} was away, so their turn was skipped.`;
    case 'kill': return `<span class="bad">💀 ${p} ${e.pid === st.you ? 'are' : 'is'} out${e.by ? ` (${who(e.by, st)})` : ''}.</span>`;
    case 'over': return `<span class="gold">${e.pid ? `${p} won!` : 'The game ended.'}</span>`;
    case 'guess': {
      const what = `${p}: ${who(e.target, st)}${e.target === st.you ? 'r' : '’s'} ${ord(e.idx + 1)} tile (${COLOR_NAMES[e.c]}) is <b>${esc(valName(e.value))}</b>`;
      if (e.res === 'yes') return `${what} → <span class="good">Yes!</span>`;
      if (e.res === 'accept') return `${what} → No. Accepted, pot now ${e.pot}.`;
      if (e.res === 'caught') return `${what} → No… <span class="good">bluff caught!</span> ${who(e.target, st)} flip${e.target === st.you ? '' : 's'} ${e.stake} more.`;
      if (e.res === 'truth') return `${what} → No… <span class="bad">it was true!</span> ${p} flip${e.pid === st.you ? '' : 's'} ${e.stake}.`;
      return what;
    }
  }
  return '';
}

function tileName(g, pid, id) {
  const row = g.hands[pid] || [];
  const i = row.findIndex(x => x.id === id);
  const t = row[i];
  return t ? `${ord(i + 1)} tile (${COLOR_NAMES[t.c]})` : 'tile';
}

function actionHTML(g, st) {
  const me = st.you, t = g.turn;
  const playing = g.order.includes(me);
  if (g.phase === 'setup') {
    const mine = g.hands[me] || [];
    const left = Math.max(0, Math.ceil((g.setupEnds - H.now()) / 1000));
    if (!playing) return `<div class="bw-act"><h3>Everyone’s picking their starting tiles…</h3></div>`;
    if (g.mine) return `<div class="bw-act"><h3>You drew a ${g.mine.pending.n === -1 ? 'wildcard' : 'tile'}: ${tileHTML(g, me, Object.assign({ id: -1, up: false }, g.mine.pending), { mine: true })}</h3><p>Tap a <b>+</b> in your row to choose where it goes. ${g.mine.pending.n === -1 ? 'It stays there for the rest of the game.' : ''}</p></div>`;
    if (mine.length < 3) return `<div class="bw-act"><h3>Pick the colors of your 3 starting tiles</h3><p>Tap a color above, ${3 - mine.length} more to go. You only see the number once it’s yours. <span class="muted" id="bwLeft">(${left}s)</span></p></div>`;
    return `<div class="bw-act"><h3>You’re ready.</h3><p class="muted">Waiting for everyone else to pick… <span id="bwLeft">(${left}s)</span></p></div>`;
  }
  if (!t) return '';
  const turnName = t.pid === me ? 'You' : esc(H.nameOf(t.pid));
  const myTurn = t.pid === me;
  if (t.step === 'draw') {
    return myTurn
      ? `<div class="bw-act"><h3>Your turn: draw a tile</h3><p>Tap a color above to draw a tile of that color.</p></div>`
      : `<div class="bw-act"><h3>${turnName} is drawing a tile…</h3></div>`;
  }
  if (t.step === 'place') {
    return myTurn && g.mine
      ? `<div class="bw-act"><h3>You drew ${g.mine.pending.n === -1 ? 'a wildcard' : 'a tile'}: ${tileHTML(g, me, Object.assign({ id: -1, up: false }, g.mine.pending), { mine: true })}</h3><p>Tap a <b>+</b> in your row to choose where it goes${g.mine.pending.n === -1 ? '. It stays there for the rest of the game' : ''}.</p></div>`
      : `<div class="bw-act"><h3>${turnName} is placing a tile…</h3></div>`;
  }
  if (t.step === 'guess') {
    if (!myTurn) return `<div class="bw-act"><h3>${turnName} is choosing a tile to guess…</h3></div>`;
    const target = L.sel ? `${who(L.sel.pid, st)}${L.sel.pid === me ? 'r' : '’s'} ${tileName(g, L.sel.pid, L.sel.id)}` : null;
    const nums = Array.from({ length: 12 }, (_, n) => `<button type="button" data-act="bw-num" data-k="${n}" aria-pressed="${L.val === n}">${n}</button>`).join('')
      + (g.wilds ? `<button type="button" data-act="bw-num" data-k="wild" aria-pressed="${L.val === -1}" aria-label="Wildcard">★</button>` : '');
    return `<div class="bw-act">
      <h3>${target ? `Guess ${target}` : (t.right ? 'Keep going: pick another hidden tile' : 'Your turn: pick someone’s hidden tile')}</h3>
      ${target ? `<div class="numpad">${nums}</div>
      <div class="row"><button type="button" class="btn primary" data-act="bw-guess" ${L.val == null ? 'disabled' : ''}>${L.val == null ? 'Pick a number' : `Is it ${esc(valName(L.val))}?`}</button><span class="muted">Tap another tile to change your pick.</span></div>`
      : '<p class="muted">Tap a tile in someone else’s row.</p>'}
    </div>`;
  }
  if (t.step === 'answer') {
    const gu = t.guess;
    const left = Math.max(0, t.answerEnds - H.now());
    const bar = `<div class="timerbar"><span style="width:${(left / 30000 * 100).toFixed(1)}%"></span></div>`;
    if (gu.target === me) {
      return `<div class="bw-act"><p class="bigq">${turnName} says your ${tileName(g, me, gu.id)} is <b>${esc(valName(gu.value))}</b>.</p>
        ${gu.right
          ? `<p>They’re <b>right</b>. Admit it, or bluff and say No?</p><div class="row"><button type="button" class="btn" data-act="bw-yes">Yes, flip it</button><button type="button" class="btn danger" data-act="bw-no">No (bluff!)</button></div>`
          : `<p>They’re wrong.</p><div class="row"><button type="button" class="btn primary" data-act="bw-no">No</button></div>`}
        ${bar}<p class="muted" style="font-size:.85rem">If you don’t answer, the game answers truthfully for you.</p></div>`;
    }
    return `<div class="bw-act"><p class="bigq">${turnName}: “${esc(H.nameOf(gu.target))}${gu.target === me ? '' : '’s'} ${tileName(g, gu.target, gu.id)} is <b>${esc(valName(gu.value))}</b>.”</p><p class="muted">Waiting for ${esc(H.nameOf(gu.target))} to answer…</p>${bar}</div>`;
  }
  if (t.step === 'verdict') {
    const gu = t.guess;
    const defender = esc(H.nameOf(gu.target));
    if (myTurn) {
      return `<div class="bw-act"><p class="bigq">${defender} says <b>No</b>.</p>
        <p>Believe them? Accepting adds a chip to the pot and you flip the tile you drew. Calling the bluff checks the tile: whoever’s wrong flips <b>${g.pot}</b> tile${g.pot > 1 ? 's' : ''}.</p>
        <div class="row"><button type="button" class="btn" data-act="bw-accept">Accept</button><button type="button" class="btn danger" data-act="bw-call">Call the bluff! (${g.pot})</button></div></div>`;
    }
    return `<div class="bw-act"><p class="bigq">${defender} says <b>No</b>.</p><p class="muted">${turnName === 'You' ? '' : `Will ${turnName} believe them?`}</p></div>`;
  }
  if (t.step === 'more') {
    return myTurn
      ? `<div class="bw-act"><h3 class="good">Right!</h3><p>${g.poolLeft ? 'Draw another tile and guess again, or stop here. If you stop, your tiles stay hidden.' : 'Guess again, or stop here.'}</p>
        <div class="row"><button type="button" class="btn primary" data-act="bw-more">Keep going</button><button type="button" class="btn" data-act="bw-stop">Stop</button></div></div>`
      : `<div class="bw-act"><h3>${turnName} got it right!</h3><p class="muted">Keep going or stop?</p></div>`;
  }
  return '';
}

function overHTML(g, st) {
  const w = g.winner;
  const ranking = [g.winner, ...g.dead.slice().reverse()].filter(Boolean);
  return `<div class="bw-act">
    <div class="bw-winner">${w ? (w === st.you ? 'You win!' : `${esc(H.nameOf(w))} wins!`) : 'Game over'}</div>
    <div class="bw-stats"><span>Bluffs caught: <b>${g.lies ? g.lies.caught : 0}</b></span><span>Lies that got away: <b>${g.lies ? g.lies.away : 0}</b></span></div>
    <ol class="rules">${ranking.map(pid => `<li>${esc(pid === st.you ? 'You' : H.nameOf(pid))}${g.killsBy[pid] ? ` · ${g.killsBy[pid]} kill${g.killsBy[pid] > 1 ? 's' : ''}` : ''}</li>`).join('')}</ol>
    <p class="muted" style="margin:0">Everyone’s tiles are shown below.</p>
    <div class="row">${H.isHost()
      ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
      : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div>
  </div>`;
}

/* ---------- announcer ---------- */
const STREAK = ['', 'SINGLE KILL', 'DOUBLE KILL', 'TRIPLE KILL', 'QUADRA KILL', 'PENTAKILL', 'GODLIKE'];
const SOUND = ['', 'single-kill', 'double-kill', 'triple-kill', 'quadra-kill', 'pentakill', 'godlike'];
function banner(big, small, gold) {
  document.querySelectorAll('.bw-banner').forEach(e => e.remove());
  const b = document.createElement('div');
  b.className = 'bw-banner' + (gold ? ' gold' : '');
  b.innerHTML = `<div class="big">${esc(big)}</div>${small ? `<div class="small">${small}</div>` : ''}`;
  document.body.appendChild(b);
  setTimeout(() => b.remove(), 2600);
  if (!gold) {
    const f = document.createElement('div');
    f.className = 'bw-flash';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 700);
  }
}
/* A short low "boom" made in the browser, used until recorded sounds are added. */
function boom(level) {
  try {
    const ctx = L.audio || (L.audio = new (window.AudioContext || window.webkitAudioContext)());
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator(), gn = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220 + level * 40, t0);
    o.frequency.exponentialRampToValueAtTime(40, t0 + 0.5);
    gn.gain.setValueAtTime(0.0001, t0);
    gn.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    o.connect(gn).connect(ctx.destination);
    o.start(t0); o.stop(t0 + 0.65);
    for (let i = 1; i < Math.min(level, 5); i++) {
      const o2 = ctx.createOscillator(), g2 = ctx.createGain();
      o2.type = 'square';
      o2.frequency.setValueAtTime(660 + i * 110, t0 + 0.12 * i);
      g2.gain.setValueAtTime(0.0001, t0 + 0.12 * i);
      g2.gain.exponentialRampToValueAtTime(0.12, t0 + 0.12 * i + 0.01);
      g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12 * i + 0.18);
      o2.connect(g2).connect(ctx.destination);
      o2.start(t0 + 0.12 * i); o2.stop(t0 + 0.12 * i + 0.2);
    }
  } catch (e) { /* no sound available */ }
}
/* Play the recorded announcer line if there is one, otherwise the built-in boom. */
function playKill(lvl, name) {
  const src = ((H.catalog.bw11 || {}).sounds || {})[name];
  if (!src) return boom(lvl);
  try { const a = new Audio(src); a.play().catch(() => boom(lvl)); } catch (e) { boom(lvl); }
}
function fx(e, g) {
  const st = H.st;
  if (!st) return;
  if (e.type === 'flip') { L.flips.set(e.id, Date.now()); }
  else if (e.type === 'kill') {
    const victim = e.pid === st.you ? 'You' : H.nameOf(e.pid);
    const small = e.by ? `${esc(e.by === st.you ? 'You' : H.nameOf(e.by))} eliminated ${esc(victim)}` : `${esc(victim)} ${e.pid === st.you ? 'are' : 'is'} out`;
    const lvl = Math.max(1, Math.min(6, e.streak || 1));
    // Which line to announce, most special first: the knock-out that ends the game (Ace),
    // the first one of the game (First Blood), one caused by a called bluff (Executed),
    // otherwise the kill streak for this turn.
    let big = STREAK[lvl], sound = SOUND[lvl];
    if (e.last) { big = 'ACE'; sound = 'ace'; }
    else if (e.first) { big = 'FIRST BLOOD'; sound = 'first-blood'; }
    else if (e.bluff) { big = 'EXECUTED'; sound = 'executed'; }
    // The player who was knocked out hears "You have been slain" instead.
    if (e.pid === st.you) sound = 'slain';
    setTimeout(() => { banner(big, small); playKill(lvl, sound); }, e.bluff ? 1500 : 350);
  } else if (e.type === 'bluff') {
    if (e.caught) banner('BLUFF CAUGHT!', `${esc(e.pid === st.you ? 'You flip' : H.nameOf(e.pid) + ' flips')} ${e.stake} more`, true);
    else banner('IT WAS TRUE!', `${esc(e.pid === st.you ? 'You flip' : H.nameOf(e.pid) + ' flips')} ${e.stake}`, true);
  }
}

Hub.registerGame('bw11', {
  title: 'Black, White & Eleven',
  settings,
  render,
  fx: (e, g) => fx(e, g),
  tick(st) {
    const g = st.game;
    // Keep the answer timer and setup countdown moving.
    if (!g) return;
    if (g.phase === 'setup' || (g.turn && g.turn.step === 'answer')) {
      const bar = document.querySelector('.bw .timerbar span');
      if (g.turn && g.turn.step === 'answer' && bar) bar.style.width = (Math.max(0, g.turn.answerEnds - H.now()) / 30000 * 100).toFixed(1) + '%';
    }
    if (g.phase === 'setup') H.setText('bwLeft', '(' + Math.max(0, Math.ceil((g.setupEnds - H.now()) / 1000)) + 's)');
  }
});
})();
