/*
 * Starlight Signal: what each player sees and taps.
 * Rules live on the server (games/starlight-signal.js). Everything on the table is public;
 * only the order of each face-down pile is hidden.
 *
 * Art: any file in public/games/starlight/art/ with one of the names in the README there
 * (star-jade.png, card-crimson.webp, comet.png, bell.svg, ...) replaces its placeholder.
 * Sounds in public/games/starlight/sounds/ (flip, bell-right, bell-wrong, comet, collect,
 * out, win) replace the built-in beeps.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

const COL = {
  crimson: { name: 'Crimson', color: '#F0525A', points: 5 },
  amber: { name: 'Amber', color: '#FFB82E', points: 4 },
  jade: { name: 'Jade', color: '#34D196', points: 6 },
  cobalt: { name: 'Cobalt', color: '#5B8BFF', points: 8 }
};
const COLOURS = ['crimson', 'amber', 'jade', 'cobalt'];
// Where the stars sit on a card, in % of its width and height.
const PIPS = {
  1: [[50, 50]],
  2: [[32, 30], [68, 70]],
  3: [[27, 23], [50, 50], [73, 77]],
  4: [[30, 28], [70, 28], [30, 72], [70, 72]],
  5: [[28, 22], [72, 22], [50, 50], [28, 78], [72, 78]]
};
const PIP_SIZE = { 1: 56, 2: 42, 3: 34, 4: 36, 5: 32 };
// Drawn star art has some empty space around it, so it's shown a little bigger.
const PIP_SIZE_ART = { 1: 64, 2: 48, 3: 40, 4: 41, 5: 38 };
// Seats around the table, yours first (at the bottom), then clockwise.
const SEATS = {
  1: [[50, 86]],
  2: [[50, 86], [50, 15]],
  3: [[50, 86], [15, 28], [85, 28]],
  4: [[50, 86], [11, 50], [50, 15], [89, 50]],
  5: [[50, 86], [11, 64], [22, 18], [78, 18], [89, 64]],
  6: [[50, 86], [11, 68], [14, 24], [50, 15], [86, 24], [89, 68]]
};
const HOLD_MS = 320; // "flip it away from yourself": you see your own card this much later

const L = {
  lastHTML: '', code: '', newAt: {}, seen: {}, mine: null, holdUntil: 0, heldCard: null, heldSeq: 0, lastSeq: 0,
  holdTimer: null, queue: [], showing: false, audio: {}, ctx: null,
  mute: (() => { try { return localStorage.getItem('sl.mute') === '1'; } catch (e) { return false; } })()
};

const cat = () => H.catalog.sl || { art: {}, sounds: {}, flipTimes: [2, 3, 4, 6] };
const art = k => (cat().art || {})[k] || '';
const nm = pid => (pid === H.st.you ? 'You' : H.nameOf(pid));
const colourWord = (c, cap) => { const n = COL[c] ? COL[c].name : c; return cap ? n : n.toLowerCase(); };

/* ---------- placeholder pictures ---------- */
function starPoints(k, outer, inner) {
  const pts = [];
  for (let i = 0; i < k * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI * i / k - Math.PI / 2;
    pts.push((50 + r * Math.cos(a)).toFixed(1) + ',' + (50 + r * Math.sin(a)).toFixed(1));
  }
  return pts.join(' ');
}
const STAR_SVG = {};
for (const c of COLOURS) {
  const k = COL[c].points;
  const inner = { 4: 17, 5: 21, 6: 27, 8: 26 }[k];
  STAR_SVG[c] = `<svg viewBox="0 0 100 100" aria-hidden="true"><polygon points="${starPoints(k, 47, inner)}" fill="${COL[c].color}" stroke="#fff" stroke-opacity=".55" stroke-width="3" stroke-linejoin="round"/></svg>`;
}
function star(c) {
  const src = art('star-' + c);
  return src ? `<img src="${esc(src)}" alt="" draggable="false">` : STAR_SVG[c];
}
const COMET_SVG = `<svg viewBox="0 0 100 140" aria-hidden="true"><defs><linearGradient id="slTail" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9BE7FF" stop-opacity="0"/><stop offset="1" stop-color="#E6FAFF"/></linearGradient></defs>
  <path d="M10 128 L64 52 L78 66 Z" fill="url(#slTail)"/><path d="M22 132 L70 58 L76 64 Z" fill="url(#slTail)" opacity=".6"/>
  <circle cx="72" cy="58" r="15" fill="#F4FCFF"/><circle cx="72" cy="58" r="22" fill="#9BE7FF" opacity=".25"/>
  <circle cx="20" cy="24" r="1.6" fill="#fff"/><circle cx="84" cy="112" r="1.2" fill="#fff"/><circle cx="42" cy="16" r="1" fill="#fff"/></svg>`;
const BELL_SVG = `<svg viewBox="0 0 120 100" aria-hidden="true"><defs><radialGradient id="slBell" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#FFF4C2"/><stop offset=".45" stop-color="#F5C542"/><stop offset="1" stop-color="#A9761A"/></radialGradient></defs>
  <rect x="54" y="6" width="12" height="10" rx="3" fill="#C9C9D6"/><rect x="48" y="2" width="24" height="7" rx="3.5" fill="#E7E7F0"/>
  <path d="M14 78 C14 40 34 18 60 18 C86 18 106 40 106 78 Z" fill="url(#slBell)" stroke="#7A5410" stroke-width="2"/>
  <path d="M30 60 C32 42 42 30 56 26" stroke="#FFFBE6" stroke-width="5" stroke-linecap="round" fill="none" opacity=".7"/>
  <rect x="4" y="78" width="112" height="14" rx="7" fill="#3A3F66" stroke="#20243F" stroke-width="2"/></svg>`;

/* ---------- cards ---------- */
function cardHTML(card, o) {
  o = o || {};
  const cls = ['slc'];
  if (o.cls) cls.push(o.cls);
  if (!card) return `<span class="slc empty${o.cls ? ' ' + o.cls : ''}" aria-label="No card"></span>`;
  if (card.comet) {
    const src = art('comet');
    cls.push('comet');
    return `<span class="${cls.join(' ')}" aria-label="The comet card">${src ? `<img class="full" src="${esc(src)}" alt="">` : COMET_SVG + '<b class="cn">Comet</b>'}</span>`;
  }
  const c = COL[card.c];
  const label = `${card.n} ${c.name.toLowerCase()} star${card.n > 1 ? 's' : ''}`;
  cls.push('c-' + card.c);
  const full = art(`card-${card.c}-${card.n}`);
  if (full) return `<span class="${cls.join(' ')}" style="--c:${c.color}" aria-label="${label}" title="${label}"><img class="full" src="${esc(full)}" alt=""></span>`;
  const bg = art('card-' + card.c);
  const size = (art('star-' + card.c) ? PIP_SIZE_ART : PIP_SIZE)[card.n];
  const pips = PIPS[card.n].map(([x, y]) => `<i style="left:${x}%;top:${y}%;--ps:${size}%">${star(card.c)}</i>`).join('');
  return `<span class="${cls.join(' ')}" style="--c:${c.color}${bg ? `;--face:url('${esc(bg)}')` : ''}" aria-label="${label}" title="${label}">${pips}</span>`;
}
function backHTML() {
  const src = art('back');
  return `<span class="slc back">${src ? `<img class="full" src="${esc(src)}" alt="">` : '<span class="cons" aria-hidden="true"></span>'}</span>`;
}

/* ---------- sounds ---------- */
function synth(kind) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = L.ctx || (L.ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime;
    const tone = (freq, start, dur, type, vol) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t + start);
      gn.gain.setValueAtTime(0.0001, t + start);
      gn.gain.exponentialRampToValueAtTime(vol, t + start + 0.01);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
      o.connect(gn).connect(ctx.destination); o.start(t + start); o.stop(t + start + dur + 0.05);
    };
    if (kind === 'bell-right') { tone(1568, 0, 1.2, 'sine', 0.25); tone(3136, 0, 0.6, 'sine', 0.08); tone(2349, 0, 0.9, 'sine', 0.06); }
    else if (kind === 'bell-wrong') { tone(150, 0, 0.35, 'square', 0.08); tone(110, 0.05, 0.35, 'square', 0.06); }
    else if (kind === 'flip') tone(900, 0, 0.05, 'triangle', 0.06);
    else if (kind === 'comet') { for (let i = 0; i < 6; i++) tone(1200 + i * 220, i * 0.05, 0.25, 'sine', 0.05); }
    else if (kind === 'win') { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.4, 'triangle', 0.1)); }
    else if (kind === 'out') { tone(440, 0, 0.2, 'sine', 0.08); tone(330, 0.18, 0.35, 'sine', 0.08); }
  } catch (e) { /* sound is a nice-to-have */ }
}
function play(kind) {
  if (L.mute) return;
  const url = (cat().sounds || {})[kind];
  if (!url) return synth(kind);
  try {
    const a = L.audio[kind] || (L.audio[kind] = new Audio(url));
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* ignore */ }
}

/* ---------- host settings (in the room) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.sl;
  const seg = (k, v, on, label) => `<button type="button" data-act="sl-set" data-k="${k}|${v}" aria-pressed="${on}" ${host ? '' : 'disabled'}>${label}</button>`;
  const online = st.players.filter(p => p.connected).length;
  return `
  <div class="setting"><span class="label">Flip time<br><small class="muted" style="font-weight:400">If you don’t flip in time, your card flips by itself.</small></span>
    <div class="t7set">${(cat().flipTimes || [2, 3, 4, 6]).map(t => seg('flip', t, s.flip === t, t + 's')).join('')}</div></div>
  <div class="setting"><span class="label">Flip away from yourself<br><small class="muted" style="font-weight:400">Everyone else sees your new card a moment before you do, like at a real table.</small></span>
    <div class="t7set">${seg('away', 0, !s.away, 'Off')}${seg('away', 1, s.away, 'On')}</div></div>
  <div class="setting"><span class="label">Shorter game<br><small class="muted" style="font-weight:400">The game ends at the first knock-out. Most cards wins.</small></span>
    <div class="t7set">${seg('short', 0, !s.short, 'Off')}${seg('short', 1, s.short, 'On')}</div></div>
  <div class="setting"><span class="label">Show colour totals<br><small class="muted" style="font-weight:400">A counting helper for younger players.</small></span>
    <div class="t7set">${seg('totals', 0, !s.totals, 'Off')}${seg('totals', 1, s.totals, 'On')}</div></div>
  ${online > 6 ? `<div class="setting"><span class="label">Players</span><span class="muted">${online} are here. Starlight Signal is for 2 to 6 players.</span></div>` : ''}
  <div class="setting stack"><span class="label">How to play</span>${rulesList()}</div>`;
}
function rulesList() {
  return `<ul class="rules">
    <li>Take turns flipping the top card of your face-down pile onto your face-up pile. Only the <b>top card</b> of each face-up pile counts.</li>
    <li>Add up the stars of each colour you can see. When one colour totals <b>exactly 5</b>, ring the bell (tap it or press <kbd>Space</kbd>). Anyone can ring at any time.</li>
    <li>First correct ring wins every face-up card, and the comet. They go to the bottom of your pile and you flip first next.</li>
    <li>Ring when it isn’t right and you give one card to each opponent.</li>
    <li><b>☄ The comet:</b> when it’s flipped it goes beside the bell. Until someone wins a bell round, ring at <b>exactly 4</b> instead of 5.</li>
    <li>Out of face-down cards? Keep watching, you can still ring. If someone else wins a bell round while you have none, you’re out.</li>
    <li>With two players left, whoever wins the next bell round wins the game.</li>
  </ul>
  <table class="sl-qref"><tbody>
    <tr><td>No comet showing</td><td>Ring when one colour totals exactly 5</td></tr>
    <tr><td>Comet showing</td><td>Ring when one colour totals exactly 4</td></tr>
    <tr><td>You ring correctly</td><td>Take all face-up piles and the comet</td></tr>
    <tr><td>You ring wrongly</td><td>Give one card to each opponent</td></tr>
    <tr><td>Out of draw cards</td><td>Keep watching; you may still ring</td></tr>
  </tbody></table>
  <p class="muted sl-keys">On a computer: <kbd>F</kbd> flips your card, <kbd>Space</kbd> rings the bell.</p>`;
}
function setSL(patch) {
  Object.assign(H.st.settings.sl, patch);
  H.render();
  H.emit('settings', { game: 'sl', patch });
}
H.on('sl-set', (b, k) => {
  const [key, v] = k.split('|');
  setSL({ [key]: key === 'flip' ? Number(v) : v === '1' });
});

/* ---------- moves ---------- */
const holding = () => Date.now() < L.holdUntil;
function seenSeq(g) { return holding() ? L.heldSeq : g.seq; }
async function ringBell() {
  const st = H.st, g = st && st.game;
  if (!g || g.id !== 'sl' || !g.order.includes(st.you) || g.out.includes(st.you) || g.phase === 'over') return;
  const bell = document.querySelector('.sl-bell');
  if (bell) { bell.classList.remove('press'); void bell.offsetWidth; bell.classList.add('press'); }
  const r = await H.emit('pick', { a: 'ring', seq: seenSeq(g) });
  if (!r.ok) { if (r.error) H.toast(r.error); return; }
  const g2 = H.st && H.st.game;
  if (r.result === 'late' && g2 && g2.result) H.toast(`Too late: ${nm(g2.result.pid)} rang first.`);
  if (r.result === 'cool') H.toast('Wait a moment before ringing again.');
}
async function flipCard() {
  const st = H.st, g = st && st.game;
  if (!g || g.id !== 'sl' || g.phase !== 'play' || g.turn !== st.you || H.now() < g.readyAt) return;
  const r = await H.emit('pick', { a: 'flip' });
  if (!r.ok && r.error) H.toast(r.error);
}
H.on('sl-ring', () => ringBell());
H.on('sl-flip', () => flipCard());
H.on('sl-mute', () => {
  L.mute = !L.mute;
  try { localStorage.setItem('sl.mute', L.mute ? '1' : '0'); } catch (e) {}
  if (!L.mute) synth('flip');
  H.render();
});
document.addEventListener('keydown', e => {
  const g = H.st && H.st.game;
  if (!g || g.id !== 'sl' || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === ' ' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) ringBell(); }
  else if ((e.key === 'f' || e.key === 'F') && !e.repeat) { e.preventDefault(); flipCard(); }
});

/* ---------- rendering ---------- */
function trackMine(g, st) {
  // "Flip it away from yourself": your own new card shows up a moment after everyone else's.
  // Until then, a ring is judged on the table as it was before (L.heldSeq).
  const seat = g.seats[st.you];
  const top = seat ? seat.top : null;
  const prev = L.mine;
  if (top && prev && prev.id !== top.id && g.settings.away && g.phase === 'play' && !holding()) {
    L.holdUntil = Date.now() + HOLD_MS;
    L.heldCard = prev.card;
    L.heldSeq = L.lastSeq;
    clearTimeout(L.holdTimer);
    L.holdTimer = setTimeout(() => {
      L.holdUntil = 0;
      const st2 = H.st;
      if (st2 && st2.game && st2.game.id === 'sl') render(document.getElementById('main'), st2);
    }, HOLD_MS + 10);
  }
  L.mine = { id: top ? top.id : null, card: top };
  if (!holding()) L.lastSeq = g.seq;
}
function render(main, st) {
  const g = st.game;
  H.S.built = 'sl:' + st.code;
  if (L.code !== st.code + ':' + g.order.join(',')) { L.code = st.code + ':' + g.order.join(','); L.mine = null; L.seen = {}; L.newAt = {}; }
  trackMine(g, st);
  const bg = art('background');
  const logo = art('logo');
  const html = `<section class="sl${g.comet ? ' comet-on' : ''}" aria-label="Starlight Signal"${bg ? ` style="--bgimg:url('${esc(bg)}')"` : ''}>
      ${g.comet && art('comet-glow') ? `<div class="sl-glow" style="background-image:url('${esc(art('comet-glow'))}')"></div>` : ''}
      <div class="sl-top">
        <div class="sl-title">${logo ? `<img src="${esc(logo)}" alt="Starlight Signal">` : 'Starlight Signal'}</div>
        ${g.phase === 'over' ? '' : `<span class="sl-chip${g.comet ? ' comet' : ''}">${targetBadge(g)}</span>`}
        <button type="button" class="linkbtn sl-mute" data-act="sl-mute" aria-pressed="${!L.mute}">${L.mute ? '🔇<span class="t"> Sound off</span>' : '🔊<span class="t"> Sound on</span>'}</button>
        ${H.dd('sl-log', 'What happened', `<ol>${g.log.slice().reverse().map(e => logLine(e, st)).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ol>`, 'sl-log')}
        ${H.dd('sl-rules', 'How to play', rulesList(), 'sl-rules')}
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}
      </div>
      ${g.phase === 'over' ? finalHTML(g, st) : tableHTML(g, st)}
      ${g.order.includes(st.you) ? '' : '<p class="muted" style="margin:0">You joined after this game started, so you’re watching this one.</p>'}
    </section>`;
  if (html === L.lastHTML && main.querySelector('.sl')) return;
  L.lastHTML = html;
  H.keepFocus(main, () => { main.innerHTML = html; });
  tick(st);
}
function targetBadge(g) {
  const k = g.comet ? 'target-4' : 'target-5';
  const src = art(k);
  if (src) return `<img src="${esc(src)}" alt="Ring at ${g.target}">`;
  return g.comet ? `☄ Ring at <b>4</b>` : `🔔 Ring at <b>5</b>`;
}

function tableHTML(g, st) {
  const me = st.you;
  const playing = g.order.includes(me);
  const seats = playing ? [me, ...g.order.slice(g.order.indexOf(me) + 1), ...g.order.slice(0, g.order.indexOf(me))] : g.order;
  const pos = SEATS[Math.min(seats.length, 6)];
  const now = Date.now();
  const res = g.phase === 'result' ? g.result : null;
  const seatHTML = seats.map((pid, i) => {
    const s = g.seats[pid];
    const out = g.out.includes(pid);
    const isMe = pid === me;
    let top = res ? res.tops[pid] : s.top;
    if (isMe && !res && holding()) top = L.heldCard;
    if (top && !L.seen[top.id]) { L.seen[top.id] = 1; L.newAt[top.id] = now; }
    const fresh = top && now - (L.newAt[top.id] || 0) < 650;
    const hit = res && top && !top.comet && res.sig.includes(top.c);
    const myTurn = g.phase === 'play' && g.turn === pid;
    const canFlip = isMe && myTurn;
    const drawInner = s.draw ? `${s.draw > 1 ? '<span class="under"></span>' : ''}${backHTML()}` : '<span class="slc empty"></span>';
    const draw = canFlip
      ? `<button type="button" class="sl-draw go" data-act="sl-flip" aria-label="Flip your card (F)">${drawInner}<span class="sl-ring" id="slTimer"></span><span class="tapme">Flip</span></button>`
      : `<span class="sl-draw${myTurn ? ' turn' : ''}">${drawInner}${myTurn ? '<span class="sl-ring" id="slTimer"></span>' : ''}</span>`;
    const outBadge = art('eliminated');
    return `<div class="sl-seat${isMe ? ' me' : ''}${myTurn ? ' turn' : ''}${out ? ' out' : ''}${res && res.pid === pid ? ' won' : ''}" data-seat="${esc(pid)}" style="--x:${pos[i][0]}%;--y:${pos[i][1]}%">
      <div class="sl-who">${H.avatar(pid, 24)}<span class="nm">${esc(nm(pid))}</span><small title="Face-down cards">${out ? 'out' : s.draw + ' left'}</small></div>
      <div class="sl-piles">${draw}<span class="sl-face">${cardHTML(top, { cls: [fresh ? 'new' : '', hit ? 'hit' : '', res && !hit && top ? 'dim' : ''].filter(Boolean).join(' ') })}${s.face > 1 ? `<small class="depth" title="Cards in this face-up pile">${s.face}</small>` : ''}</span></div>
      ${out ? `<span class="sl-outtag">${outBadge ? `<img src="${esc(outBadge)}" alt="">` : ''}Out</span>` : ''}
    </div>`;
  }).join('');
  return `<div class="sl-table n${seats.length}">${seatHTML}${midHTML(g, st)}</div>`;
}

function midHTML(g, st) {
  const me = st.you;
  const canRing = g.order.includes(me) && !g.out.includes(me) && g.phase !== 'over';
  const bellSrc = art('bell');
  const ringSrc = art('bell-ring');
  const res = g.phase === 'result' ? g.result : null;
  const comet = res ? (res.comet ? { comet: true } : null) : g.comet;
  const slotSrc = art('comet-slot');
  const slot = comet ? cardHTML(comet, { cls: 'sm' })
    : `<span class="slc empty slot sm" title="The comet goes here">${slotSrc ? `<img class="full" src="${esc(slotSrc)}" alt="">` : '<span>☄</span>'}</span>`;
  let status;
  if (res) {
    const what = res.sig.map(c => `<b style="color:${COL[c].color}">${colourWord(c, true)}</b>`).join(' and ');
    status = `<b>${esc(nm(res.pid))}</b> rang first! ${what} = ${res.target} · +${res.n} card${res.n === 1 ? '' : 's'}`;
  } else if (g.phase === 'play' && !g.turn) {
    status = `Nobody has a card to flip. Ring if you see a signal… <span id="slStall"></span>`;
  } else if (g.turn) {
    status = g.turn === me ? `<b>Your turn</b>: flip your card` : `${esc(H.nameOf(g.turn))}’s turn`;
  } else status = '';
  const totals = g.totals ? `<div class="sl-totals">${COLOURS.map(c => {
    const v = holding() ? '?' : g.totals[c];
    return `<span class="${v === g.target ? 'hot' : ''}" style="--c:${COL[c].color}"><i>${star(c)}</i>${v}</span>`;
  }).join('')}</div>` : '';
  return `<div class="sl-mid">
    <div class="sl-bellrow">
      <button type="button" class="sl-bell${bellSrc ? ' art' : ''}${ringSrc ? ' two' : ''}${res ? ' rung' : ''}" data-act="sl-ring" ${canRing ? '' : 'disabled'} aria-label="Ring the bell (Space)">
        ${bellSrc ? `<img class="b0" src="${esc(bellSrc)}" alt="">${ringSrc ? `<img class="b1" src="${esc(ringSrc)}" alt="">` : ''}` : BELL_SVG}
      </button>
      <span class="sl-slot">${slot}</span>
    </div>
    ${totals}
    <div class="sl-status" role="status">${status}</div>
  </div>`;
}

function finalHTML(g, st) {
  const f = g.final || {};
  const winners = g.winners || [];
  const rank = p => (winners.includes(p) ? 2 : 0) + (g.out.includes(p) ? 0 : 1);
  const ranked = g.order.slice().sort((a, b) => (rank(b) - rank(a)) || (f[b] - f[a]) || (g.out.indexOf(b) - g.out.indexOf(a)));
  const rows = ranked.map((pid, i) => `<li class="${winners.includes(pid) ? 'win' : ''}"><span class="pl">${i + 1}</span>${H.avatar(pid, 30)}
    <span>${esc(nm(pid))}${g.out.includes(pid) ? ' <small class="muted">· out</small>' : ''}</span><span class="pt">${f[pid] || 0} <small>cards</small></span></li>`).join('');
  const w = winners.map(p => esc(nm(p)));
  const head = w.length > 1 ? `${w.join(' & ')} share the win!` : w.length ? `${w[0] === 'You' ? 'You win' : w[0] + ' wins'}!` : 'Game over';
  const why = {
    duel: 'Won the final bell round.',
    last: 'The last player still in.',
    short: 'Someone was knocked out, so the most cards wins.',
    stall: 'Nobody could flip and nobody rang, so the most cards wins.'
  }[g.endWhy] || '';
  const trophy = art('winner');
  return `<div class="sl-final">${trophy ? `<img class="trophy" src="${esc(trophy)}" alt="">` : '<div class="trophy ph" aria-hidden="true">✦</div>'}
    <div class="sl-winner">${head}</div><p class="muted">${why}</p>
    <ol class="sl-sum">${rows}</ol>
    <div class="row">${H.isHost()
      ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
      : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
}

function logLine(e, st) {
  const p = esc(nm(e.pid));
  const cd = c => (c && COL[c.c] ? `<b style="color:${COL[c.c].color}">${c.n} ${colourWord(c.c)}</b>` : '');
  switch (e.k) {
    case 'start': return `${p} ${e.pid === st.you ? 'flip' : 'flips'} first`;
    case 'flip': return `${p} flipped ${cd(e.card)}${e.auto ? ' <small class="muted">(timed out)</small>' : ''}`;
    case 'comet': return `☄ ${p} flipped <b>the comet</b>: ring at 4`;
    case 'win': return `🔔 ${p} rang right (${e.sig.map(c => colourWord(c, true)).join(' + ')} = ${e.target}) and took ${e.n} card${e.n === 1 ? '' : 's'}`;
    case 'wrong': return `✖ ${p} rang wrongly and gave away ${e.n} card${e.n === 1 ? '' : 's'}`;
    case 'out': return `${p} ${e.pid === st.you ? 'are' : 'is'} out`;
    case 'left': return `${p} left the game`;
    case 'over': return '<b>Game over</b>';
  }
  return '';
}

/* ---------- announcements ---------- */
function banner(html, cls) {
  L.queue.push([html, cls]);
  if (L.queue.length > 3) L.queue.shift();
  if (!L.showing) showNext();
}
function showNext() {
  const h = L.queue.shift();
  if (!h) { L.showing = false; return; }
  L.showing = true;
  const el = document.createElement('div');
  el.className = 'sl-banner ' + (h[1] || '');
  el.innerHTML = h[0];
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, 1400);
}
function shake(pid) {
  const el = document.querySelector(`.sl-seat[data-seat="${CSS.escape(pid)}"]`);
  if (el) { el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); }
}
function fx(e) {
  const st = H.st;
  if (!st || !st.game || st.game.id !== 'sl') return;
  if (e.type === 'flip') play('flip');
  else if (e.type === 'comet') {
    play('comet');
    const src = art('comet');
    banner(`${src ? `<img src="${esc(src)}" alt="">` : '☄'} COMET!<small>Ring at exactly 4 until the next bell round</small>`, 'comet');
  } else if (e.type === 'win') {
    play('bell-right');
    setTimeout(() => play('collect'), 500);
    const what = e.sig.map(c => colourWord(c, true)).join(' + ');
    banner(`🔔 ${esc(nm(e.pid)).toUpperCase()}${e.pid === st.you ? ' GOT IT' : ''}<small>${what} = ${e.target} · +${e.n} card${e.n === 1 ? '' : 's'}</small>`, 'good');
    if (e.out && e.out.length) {
      setTimeout(() => play('out'), 900);
      banner(`${e.out.map(p => esc(nm(p))).join(', ')} ${e.out.includes(st.you) && e.out.length === 1 ? 'are' : e.out.length > 1 ? 'are' : 'is'} out<small>No face-down cards left</small>`, 'bad');
    }
  } else if (e.type === 'wrong') {
    play('bell-wrong');
    shake(e.pid);
    if (e.pid === st.you) banner(`✖ WRONG RING<small>You gave ${e.to.length} card${e.to.length === 1 ? '' : 's'} away</small>`, 'bad');
    else banner(`✖ ${esc(H.nameOf(e.pid))} rang wrongly<small>${e.to.includes(st.you) ? 'You get a card' : 'One card to each opponent'}</small>`, 'bad small');
  } else if (e.type === 'over') play('win');
}

function tick(st) {
  const g = st && st.game;
  if (!g || g.id !== 'sl') return;
  const el = document.getElementById('slTimer');
  if (el && g.turnEnds) {
    const total = g.turnEnds - g.readyAt;
    const left = Math.max(0, Math.min(1, (g.turnEnds - H.now()) / (total || 1)));
    el.style.setProperty('--p', left.toFixed(3));
    el.classList.toggle('wait', H.now() < g.readyAt);
  }
  if (g.phase === 'play' && !g.turn && g.stallAt) H.setText('slStall', `(game ends in ${Math.max(0, Math.ceil((g.stallAt - H.now()) / 1000))}s)`);
  // Drop the "just flipped" animation class once it has played.
  if (document.querySelector('.sl .slc.new') && Object.values(L.newAt).every(t => Date.now() - t > 700)) document.querySelectorAll('.sl .slc.new').forEach(x => x.classList.remove('new'));
}

Hub.registerGame('sl', {
  title: 'Starlight Signal',
  settings,
  render,
  fx: e => fx(e),
  tick
});
})();
