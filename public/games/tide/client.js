/*
 * The Turning Tide: A Pirate's Claim. What each captain sees and clicks.
 * Rules live on the server (games/turning-tide.js).
 *
 * Each captain sits on one side of the 4x4 chart, and every screen turns the chart so
 * your own side is at the bottom. A face-up card turns to face its owner and wears
 * their color.
 *
 * Art comes from public/games/tide/art/ (see ASSETS.md there). Anything missing is
 * drawn here as a simple stand-in.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

const FORCE = {
  tide:   { name: 'Tide',   el: 'Water', color: '#2573C9' },
  powder: { name: 'Powder', el: 'Fire',  color: '#D9442B' },
  gale:   { name: 'Gale',   el: 'Air',   color: '#C99A1E' },
  stone:  { name: 'Stone',  el: 'Earth', color: '#4E8A3A' }
};
const CYCLE = ['tide', 'powder', 'gale', 'stone'];
const BEATS = { tide: 'powder', powder: 'gale', gale: 'stone', stone: 'tide' };
const SHIP_COLOR = '#B8862B';
const SIGNS = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo', 'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces'];
const GLYPHS = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓'];
const SIDE_CLASS = ['bottom', 'left', 'top', 'right'];

const L = { sel: [], selKey: '', lastSeq: null, flashAt: 0, flashCells: [], lastTurn: null, wonPlayed: false, audio: {} };

/* Same fight rule as the server: a countering force wins, otherwise the higher value. */
function beats(a, d) {
  if (a.f && d.f && a.f !== d.f) {
    if (BEATS[a.f] === d.f) return true;
    if (BEATS[d.f] === a.f) return false;
  }
  return a.v > d.v;
}

/* ---------- stand-in pictures (replaced by files in art/) ---------- */
const PH = {
  tide: '<path d="M2 15.5c2.2 0 2.8-2.5 5-2.5s2.8 2.5 5 2.5 2.8-2.5 5-2.5 2.8 2.5 5 2.5v3c-2.2 0-2.8-2.5-5-2.5s-2.8 2.5-5 2.5-2.8-2.5-5-2.5-2.8 2.5-5 2.5z"/><path d="M3 11c1-5 5-8 10-7.5 3.5.4 5.5 3 4.5 5.5-.8 2-3.5 2.4-4.6.8 1.6.1 2.4-1.3 1.6-2.4-1.3-1.8-5-1.2-6.8 1.4C6.8 10.4 6 11.4 3 11z"/>',
  powder: '<path d="M12 1.5c.8 4.2 6.5 6.4 6.5 13a6.5 6.5 0 0 1-13 0c0-3.3 2-5.4 3.2-6.6.2 2.1 1.1 3.3 2.3 3.6-.4-3.6-.6-6.8 1-10z"/><path fill="#fff" fill-opacity=".55" d="M12 12.5c.4 1.8 2.8 2.8 2.8 5.3a2.8 2.8 0 0 1-5.6 0c0-1.5.9-2.4 1.4-2.9.1.9.5 1.4 1 1.5-.2-1.5-.3-2.6.4-3.9z"/>',
  gale: '<path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M2.5 8.5h11a3.2 3.2 0 1 0-3.2-3.2M2.5 12.5h16a3.2 3.2 0 1 1-3.2 3.2M2.5 16.5h8a2.6 2.6 0 1 1-2.6 2.6"/>',
  stone: '<path d="M1.5 20.5 8.5 7l3.6 6 2.6-4 7.8 11.5z"/><path fill="#fff" fill-opacity=".5" d="m8.5 7 1.8 3-1.8 1.4-1.6-1.2z"/>',
  ship: '<path d="M2.5 15.5h19l-3.2 5H5.8z"/><path d="M11.2 2.5h1.3v12.2h-1.3z"/><path d="M12.8 3.6 19.5 13h-6.7zM10.9 5.4 4.8 13h6.1z"/>',
  sun: '<path d="M2.5 16h19l-3.2 4.8H5.8z"/><path d="M11.3 6h1.3v9.3h-1.3z"/><path d="M12.9 7.2 18.6 14h-5.7zM11 8.6 6 14h5z"/><circle cx="12" cy="3.6" r="2.1"/><path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" d="M12 .2v.6M15.2 1.4l-.5.5M8.8 1.4l.5.5M16.4 3.6h-.7M7.6 3.6h.7"/>'
};
const COMPASS = '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" stroke-width="2" opacity=".55"/><circle cx="50" cy="50" r="31" fill="none" stroke="currentColor" stroke-width="1" opacity=".35"/><path fill="currentColor" d="M50 8 56 44 92 50 56 56 50 92 44 56 8 50 44 44z"/><path fill="currentColor" opacity=".45" d="M50 26 54 46 74 50 54 54 50 74 46 54 26 50 46 46z" transform="rotate(45 50 50)"/><circle cx="50" cy="50" r="4" fill="#0B1A2E"/></svg>';
const art = key => ((H.catalog.tide || {}).art || {})[key] || '';
const svg = (inner, color) => `<svg viewBox="0 0 24 24" fill="currentColor" style="color:${color}" aria-hidden="true">${inner}</svg>`;
function painted(url, color) {
  return `<span class="ico" style="--c:${color};--src:url('${esc(url)}')"></span>`;
}
function forceIcon(f) {
  // A small badge picture if there is one, else the force's emblem shrunk down.
  const url = art('badge-' + f) || art('emblem-' + f);
  if (!url) return svg(PH[f], FORCE[f].color);
  return isRaster(url) ? `<img src="${esc(url)}" alt="" draggable="false">` : painted(url, FORCE[f].color);
}

/* ---------- cards ---------- */
const colorOf = c => (c.f ? FORCE[c.f].color : SHIP_COLOR);
function cardName(c) {
  if (c.t === 'crew') return `${FORCE[c.f].name} ${c.n}`;
  if (c.t === 'sign') return `${SIGNS[c.n - 1]} (Sign ${c.n}, ${FORCE[c.f].name})`;
  return c.n === 0 ? 'the Sun Ship (Ship 0, counts as 10)' : `Ship ${c.n}`;
}
/* The picture for a card. A PNG/JPG/WebP is full-color art, shown as painted and filling
   the card; an SVG is black-on-transparent and painted in the force's color.
   Lookup order: one card's own art (tide-7, sign-3, ship-0), then the shared art (emblem-tide, ship). */
const isRaster = url => /\.(png|jpe?g|webp|gif)$/i.test(url);
function cardArt(c) {
  if (c.t === 'crew') return art(`${c.f}-${c.n}`) || art('emblem-' + c.f);
  if (c.t === 'sign') return art('sign-' + c.n);
  return art('ship-' + c.n) || art('ship');
}
function emblem(c) {
  const color = colorOf(c);
  const url = cardArt(c);
  if (url) return isRaster(url) ? `<img src="${esc(url)}" alt="" loading="lazy" draggable="false">` : painted(url, color);
  if (c.t === 'crew') return svg(PH[c.f], color);
  if (c.t === 'sign') return `<span class="glyph" style="color:${color}">${GLYPHS[c.n - 1]}\uFE0E</span>`;
  return svg(c.n === 0 ? PH.sun : PH.ship, color);
}
/* Small force mark: a force emblem shrunk down, or the stand-in. */
/* o: { owner: pid, cls, act, k, label } */
function cardHTML(c, o) {
  o = o || {};
  const color = colorOf(c);
  const own = o.owner ? `--own:hsl(${H.hueOf(o.owner)} 72% 56%);` : '';
  const name = c.t === 'crew' ? FORCE[c.f].name : c.t === 'sign' ? SIGNS[c.n - 1] : (c.n === 0 ? 'Sun Ship' : `Ship ${c.n}`);
  // The Sun Ship's corners show 10, its value, with its ship number in the name line.
  const corner = `${c.v}${c.t === 'ship' && c.n === 0 ? '<i>☀</i>' : ''}`;
  const sub = c.t === 'sign' ? `<span class="badge" title="${FORCE[c.f].name}">${forceIcon(c.f)}</span>` : '';
  const tag = o.act ? 'button' : 'span';
  const attrs = o.act ? ` type="button" data-act="${o.act}" data-k="${esc(o.k)}"` : '';
  const face = art('face');
  const full = isRaster(cardArt(c));
  return `<${tag} class="tc t-${c.t} ${c.f || 'none'}${full ? ' full' : ''}${o.owner ? ' owned' : ''} ${o.cls || ''}"${attrs} style="--fc:${color};${own}${face ? `--face:url('${esc(face)}');` : ''}" aria-label="${esc((o.label ? o.label + ': ' : '') + cardName(c))}" title="${esc(cardName(c))}">
    <span class="cn">${corner}</span>${sub}<span class="em">${emblem(c)}</span><span class="nm">${esc(name)}${c.t === 'ship' && c.n === 0 ? ' · 0' : ''}</span><span class="cn r">${corner}</span></${tag}>`;
}
function backHTML(o) {
  o = o || {};
  const url = art('back');
  const tag = o.act ? 'button' : 'span';
  const attrs = o.act ? ` type="button" data-act="${o.act}" data-k="${esc(o.k)}"` : '';
  return `<${tag} class="tc back ${o.cls || ''}"${attrs}${url ? ` style="--back:url('${esc(url)}')"` : ''} aria-label="${esc(o.label || 'Hidden location')}">${url ? '' : COMPASS}</${tag}>`;
}

/* ---------- room settings ---------- */
function cycleHTML() {
  return `<span class="tt-cycle" aria-label="Tide beats Powder, Powder beats Gale, Gale beats Stone, Stone beats Tide">${CYCLE.map(f => `<span class="f">${forceIcon(f)}<b style="color:${FORCE[f].color}">${FORCE[f].name}</b></span><span class="ar">›</span>`).join('')}<span class="f">${forceIcon('tide')}</span></span>`;
}
function rulesList() {
  return `<ul class="rules">
    <li>16 cards lie face down in a 4×4 chart. Everyone has 5 cards in hand (6 at most) and sits on one side of the chart.</li>
    <li>On your turn, do one thing:
      <b>Scout</b>: turn a hidden card face up. It’s yours, and it attacks the face-up cards beside it (not diagonals).
      <b>Board</b>: play a card from your hand over a face-up card it defeats (anyone’s, even yours). It then attacks its neighbours too.
      <b>Resupply</b>: draw 1 card, or trade 2 or 3 cards for new ones.</li>
    <li><b>Fights:</b> a force that counters the other wins whatever the numbers: Tide beats Powder, Powder beats Gale, Gale beats Stone, Stone beats Tide. Otherwise the higher number wins. Equal numbers: nobody wins.</li>
    <li>A card that defeats a neighbour takes it over: it turns to face you and takes your color.</li>
    <li>Crew cards are 2–15, Captain’s Signs 1–12 (each belongs to a force), and Legendary Ships 0–9 with no force. <b>Ship 0, the Sun Ship, counts as 10.</b></li>
    <li>When the last hidden card is revealed, whoever controls the most locations wins. Ties: fewer cards in hand, then the lower total of your locations’ top cards, then a shared win.</li>
  </ul>`;
}
function settings(st) {
  const online = st.players.filter(p => p.connected).length;
  return `<div class="setting"><span class="label">Captains<br><small class="muted" style="font-weight:400">2 to 4 players${online > 4 ? `. ${online} are here now, so some will need to watch from another room.` : ''}</small></span><span>${cycleHTML()}</span></div>
    <div class="setting stack"><span class="label">How to play</span>${rulesList()}</div>`;
}

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('tt-scout', (b, k) => { L.sel = []; b.disabled = true; move({ a: 'scout', cell: Number(k) }); });
H.on('tt-board', (b, k) => {
  if (L.sel.length !== 1) return;
  const id = L.sel[0];
  L.sel = [];
  b.disabled = true;
  move({ a: 'board', id, cell: Number(k) });
});
H.on('tt-hand', (b, k) => {
  const id = Number(k);
  L.sel = L.sel.includes(id) ? L.sel.filter(x => x !== id) : [...L.sel, id].slice(-3);
  H.render();
});
H.on('tt-clear', () => { L.sel = []; H.render(); });
H.on('tt-draw', b => { b.disabled = true; L.sel = []; move({ a: 'draw' }); });
H.on('tt-trade', b => {
  if (L.sel.length < 2) return;
  const ids = L.sel.slice();
  L.sel = [];
  b.disabled = true;
  move({ a: 'trade', ids });
});

/* ---------- sounds ---------- */
function play(key) {
  const url = ((H.catalog.tide || {}).sounds || {})[key];
  if (!url) return;
  try {
    const a = L.audio[key] || (L.audio[key] = new Audio(url));
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* sound is a nice-to-have */ }
}

/* ---------- rendering ---------- */
const nm = (pid, st) => (pid === st.you ? 'You' : H.nameOf(pid));
function render(main, st) {
  const g = st.game;
  H.S.built = 'tide:' + st.code;
  const me = st.you;
  const playing = g.order.includes(me);
  const myTurn = g.phase === 'play' && g.turn === me;
  const view = playing ? g.sides[me] : 0;

  // A new move: clear the selection, flash what changed and play its sound.
  const key = `${g.last.seq}:${g.turn}`;
  if (key !== L.selKey) { L.selKey = key; L.sel = []; }
  if (L.lastSeq !== g.last.seq) {
    const fresh = L.lastSeq !== null;
    L.lastSeq = g.last.seq;
    L.flashCells = (g.last.fights || []).filter(f => f.took).map(f => f.cell);
    if (g.last.k === 'board' && g.last.from && g.last.from !== g.last.pid) L.flashCells.push(g.last.cell);
    L.flashAt = Date.now();
    if (fresh) {
      if (g.last.k === 'scout') play('scout');
      if (g.last.k === 'board') play('board');
      if (L.flashCells.length) setTimeout(() => play('capture'), 280);
    }
  }
  if (myTurn && L.lastTurn !== me && L.lastTurn !== null) setTimeout(() => play('turn'), 500);
  L.lastTurn = g.turn;
  if (g.phase === 'final' && !L.wonPlayed) { L.wonPlayed = true; setTimeout(() => play('win'), 600); }
  if (g.phase !== 'final') L.wonPlayed = false;
  const flashing = Date.now() - L.flashAt < 1400 ? L.flashCells : [];

  const hand = g.hand || [];
  L.sel = L.sel.filter(id => hand.some(c => c.id === id));
  const one = L.sel.length === 1 ? hand.find(c => c.id === L.sel[0]) : null;
  const owned = pid => g.grid.filter(c => c.up && c.owner === pid).length;

  // What the selected hand card could do on each face-up location.
  const gains = {};
  if (myTurn && one) {
    g.grid.forEach((cell, i) => {
      if (!cell.up || !beats(one, cell.card)) return;
      let n = cell.owner !== me ? 1 : 0;
      for (const j of around(i)) { const nb = g.grid[j]; if (nb.up && nb.owner !== me && beats(one, nb.card)) n++; }
      gains[i] = n;
    });
  }

  const cells = g.grid.map((cell, i) => {
    const cls = [flashing.includes(i) ? 'flash' : '', g.last.cell === i && g.last.k !== 'draw' ? 'last' : ''].join(' ');
    if (!cell.up) {
      return `<div class="tt-cell ${cls}">${backHTML(myTurn ? { act: 'tt-scout', k: i, cls: 'pick', label: 'Hidden location. Scout it' } : {})}</div>`;
    }
    const can = i in gains;
    const rot = g.sides[cell.owner] * 90;
    const label = `${cell.owner === me ? 'Yours' : H.nameOf(cell.owner) + '’s'}${can ? `. Board it${gains[i] ? `, gain ${gains[i]}` : ''}` : ''}`;
    return `<div class="tt-cell ${cls}${can ? ' target' : ''}"><div class="tt-rot" style="transform:rotate(${rot}deg)">
        ${cardHTML(cell.card, { owner: cell.owner, act: can ? 'tt-board' : '', k: i, cls: can ? 'pick' : '', label })}
        ${cell.depth > 1 ? `<span class="depth" title="${cell.depth} cards in this location">×${cell.depth}</span>` : ''}</div>
        ${can ? `<span class="gain">${gains[i] ? '+' + gains[i] : '±0'}</span>` : ''}</div>`;
  }).join('');

  const seats = g.order.map(pid => {
    const rel = (g.sides[pid] - view + 4) % 4;
    const turn = g.phase === 'play' && g.turn === pid;
    return `<div class="tt-seat s-${SIDE_CLASS[rel]}${turn ? ' turn' : ''}${pid === me ? ' me' : ''}" style="--own:hsl(${H.hueOf(pid)} 72% 56%)">
      ${H.avatar(pid, rel === 0 ? 34 : 30)}<span class="who"><span class="n">${esc(nm(pid, st))}</span>
      <small><span title="Locations controlled">⚑ ${owned(pid)}</span><span title="Cards in hand">✋ ${g.handCounts[pid]}</span></small>${turn ? '<em>turn</em>' : ''}</span></div>`;
  }).join('');

  const html = `<section class="tt" aria-label="The Turning Tide"${art('table') ? ` style="--table:url('${esc(art('table'))}')"` : ''}>
    <div class="tt-top">
      ${art('logo') ? `<img class="tt-logo" src="${esc(art('logo'))}" alt="The Turning Tide: A Pirate’s Claim">` : '<div class="tt-title">The Turning Tide<small>A Pirate’s Claim</small></div>'}
      <span class="tt-count"><b>${g.hiddenLeft}</b> hidden · <b>${g.pileLeft}</b> in the pile</span>
      ${H.dd('tt-log', 'What happened', `<ol>${g.log.slice().reverse().map(e => `<li>${logLine(e, st)}</li>`).join('')}</ol>`, 'tt-log')}
      ${H.dd('tt-rules', 'How to play', cycleHTML() + rulesList(), 'tt-rules')}
      ${H.isHost() && g.phase !== 'final' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}
    </div>
    <div class="tt-main">
      <div class="tt-table">
        ${seats}
        <div class="tt-sea"><div class="tt-chart" style="transform:rotate(${-view * 90}deg)">${cells}</div></div>
      </div>
      <div class="tt-side">
        ${actHTML(g, st, { myTurn, one, gains, hand, playing })}
        ${playing && g.phase !== 'final' ? handHTML(g, hand, myTurn) : ''}
        <div class="tt-legend">${cycleHTML()}</div>
      </div>
    </div>
  </section>`;
  if (html === L.lastHTML && main.querySelector('.tt')) return;
  L.lastHTML = html;
  H.keepFocus(main, () => { main.innerHTML = html; });
}
function around(i) {
  const r = Math.floor(i / 4), c = i % 4, out = [];
  if (r > 0) out.push(i - 4);
  if (r < 3) out.push(i + 4);
  if (c > 0) out.push(i - 1);
  if (c < 3) out.push(i + 1);
  return out;
}

function handHTML(g, hand, myTurn) {
  const ups = g.grid.filter(c => c.up).map(c => c.card);
  const cards = hand.map(c => {
    const can = ups.some(u => beats(c, u));
    const sel = L.sel.includes(c.id);
    return cardHTML(c, { act: myTurn ? 'tt-hand' : '', k: c.id, cls: `${sel ? 'sel' : ''}${can ? ' can' : ''}`, label: `${sel ? 'Selected' : 'In your hand'}${can ? ', can board' : ''}` });
  }).join('');
  return `<div class="tt-hand"><div class="lbl">Your hand <small>${hand.length} of ${g.handMax}${myTurn ? ' · ⚔ = can board something' : ''}</small></div>
    <div class="cards">${cards || '<span class="muted">No cards in hand.</span>'}</div></div>`;
}

function actHTML(g, st, o) {
  const me = st.you;
  if (g.phase === 'final') return summaryHTML(g, st);
  const last = g.last.seq ? `<p class="tt-last">${logLine(Object.assign({}, g.last), st)}</p>` : '';
  if (!o.playing) return `<div class="tt-act"><h3>${esc(H.nameOf(g.turn))}’s turn</h3><p class="muted">You joined after this game started, so you’re watching this one.</p>${last}</div>`;
  if (!o.myTurn) return `<div class="tt-act"><h3>${esc(H.nameOf(g.turn))} is choosing a move…</h3>${last}</div>`;
  const n = L.sel.length;
  const full = o.hand.length >= g.handMax;
  const drawBtn = `<button type="button" class="btn" data-act="tt-draw" ${full || !g.pileLeft ? 'disabled' : ''}>${!g.pileLeft ? 'Pile is empty' : full ? `Hand full (${g.handMax})` : 'Draw 1 card'}</button>`;
  const canTrade = n >= 2 && g.pileLeft >= n;
  const tradeBtn = `<button type="button" class="btn${canTrade ? ' primary' : ''}" data-act="tt-trade" ${canTrade ? '' : 'disabled'}>${n >= 2 ? `Trade these ${n}` : 'Trade 2 or 3'}</button>`;
  let hint;
  if (!n) hint = 'Tap a <b>hidden location</b> to scout it, or pick a card from your hand to <b>board</b> a face-up location. To trade, pick 2 or 3 cards.';
  else if (n === 1) {
    const t = Object.keys(o.gains).length;
    hint = t ? `Now tap a glowing location to board it with <b>${esc(cardName(o.one))}</b>. The badge shows how many locations you’d gain.` : `<b>${esc(cardName(o.one))}</b> can’t defeat any face-up card. Pick another card, or more cards to trade.`;
  } else hint = n >= 2 && g.pileLeft < n ? `Only ${g.pileLeft} card${g.pileLeft === 1 ? '' : 's'} left in the pile, not enough to trade ${n}.` : `Trade these ${n} cards for ${n} new ones from the pile.`;
  return `<div class="tt-act mine"><h3>Your turn, captain</h3>${last}<p>${hint}</p>
    <div class="row">${drawBtn}${tradeBtn}${n ? '<button type="button" class="linkbtn" data-act="tt-clear">Clear</button>' : ''}</div></div>`;
}

function summaryHTML(g, st) {
  const r = g.result;
  if (!r) return '';
  const w = r.winners.map(p => esc(nm(p, st)));
  const head = w.length > 1 ? `${w.join(' & ')} share the victory!` : (w[0] === 'You' ? 'You win!' : `${w[0]} wins!`);
  const why = ['Most locations controlled.', 'Tied on locations: fewer cards in hand wins.', 'Tied on locations and hand: the lower total of top cards wins.', 'Tied on locations, hand and total.'][r.by];
  let place = 0;
  const rows = r.rows.map((x, i) => {
    const prev = r.rows[i - 1];
    if (!prev || prev.locations !== x.locations || prev.hand !== x.hand || prev.sum !== x.sum) place = i + 1;
    return `<tr class="${r.winners.includes(x.pid) ? 'win' : ''}"><td class="pl">${place}</td><td class="who">${H.avatar(x.pid, 28)}${esc(nm(x.pid, st))}</td><td>${x.locations}</td><td>${x.hand}</td><td>${x.sum}</td></tr>`;
  }).join('');
  return `<div class="tt-act"><div class="tt-winner">${head}</div><p class="muted">${why}</p>
    <table class="tt-sum"><thead><tr><th></th><th>Captain</th><th title="Locations controlled">⚑</th><th title="Cards in hand">✋</th><th title="Total of top cards (Sun Ship = 10)">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row">${H.isHost()
      ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
      : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
}

const ROWS = ['top', 'second', 'third', 'bottom'];
function where(i, st) {
  // Named from your own side of the chart.
  const g = st.game, v = g.order.includes(st.you) ? g.sides[st.you] : 0;
  let r = Math.floor(i / 4), c = i % 4;
  for (let k = 0; k < v; k++) [r, c] = [3 - c, r];
  return `${ROWS[r]} row, ${['1st', '2nd', '3rd', '4th'][c]} from the left`;
}
function logLine(e, st) {
  const p = esc(nm(e.pid, st));
  const took = (e.fights || []).filter(f => f.took).length + (e.k === 'board' && e.from && e.from !== e.pid ? 1 : 0);
  const gain = took ? ` and took <b>${took}</b> location${took === 1 ? '' : 's'}` : '';
  const card = c => `<b style="color:${colorOf(c)}">${esc(cardName(c))}</b>`;
  switch (e.k) {
    case 'start': return `<b>The hunt begins.</b> ${p} ${e.pid === st.you ? 'go' : 'goes'} first.`;
    case 'scout': return `${p} scouted ${card(e.card)} (${where(e.cell, st)})${gain}.`;
    case 'board': return `${p} boarded ${e.from === e.pid ? 'their own' : esc(nm(e.from, st)) + (e.from === st.you ? 'r' : '’s')} ${card(e.under)} with ${card(e.card)}${gain}.`;
    case 'draw': return `${p} drew a card.`;
    case 'trade': return `${p} traded ${e.n} cards.`;
    case 'end': return '<b>The last location is revealed. The hunt is over.</b>';
  }
  return '';
}

Hub.registerGame('tide', {
  title: 'The Turning Tide',
  settings,
  render,
  tick(st) {
    if (L.flashAt && Date.now() - L.flashAt > 1500) { L.flashAt = 0; document.querySelectorAll('.tt .tt-cell.flash').forEach(el => el.classList.remove('flash')); }
  }
});
})();
