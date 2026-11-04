/*
 * The Triple Seven: what each player sees and clicks.
 * Rules live on the server (games/triple-seven.js). A card's face is only sent to the
 * players allowed to see it: cards you've looked at, cards in the Spotlight, and every
 * card once the round is over.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

/* What each card does, as printed on the card. */
const POWER = {
  A: { lbl: 'Add a card', long: 'Add a card: the top card of the pile goes face down onto any player’s row.' },
  2: { lbl: 'Spy row', long: 'Spy row: secretly look at another player’s whole row.' },
  3: { lbl: 'Full sight', long: 'Full sight: look at all of your own cards.' },
  6: { lbl: 'Echo', long: 'Echo: repeat the last power that was played.' },
  7: { lbl: '= 0 · Remove', long: 'Remove: remove one of your own cards (at least one has to stay). Its power happens too.' },
  8: { lbl: 'Skip', long: 'Skip: the next player loses their turn.' },
  9: { lbl: 'Go again', long: 'Go again: take another turn.' },
  10: { lbl: 'Spotlight', long: 'Spotlight: turn any card face up for everyone, for good.' },
  J: { lbl: 'Peek', long: 'Peek: look at any one card.' },
  Q: { lbl: 'Swap 2', long: 'Swap: swap any two cards on the table.' },
  K: { lbl: 'Lock / Unlock', long: 'Lock / Unlock: lock a card so it can’t be looked at, moved or replaced, or unlock a locked one.' },
  X: { lbl: 'Swap rows', long: 'Joker: swap the whole rows of any two players, locked cards included.' }
};
const ORDER = ['A', '2', '3', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'X'];
const rankName = r => (r === 'X' ? 'Joker' : r);
const L = { sel: [], selKey: '', flashSeq: 0, flashAt: 0, flashIds: [], queue: [], showing: false };
const nm = (pid, st) => (pid === st.you ? 'You' : H.nameOf(pid));
const pos = (i, len) => (len === 3 ? ['left', 'middle', 'right'][i] : `card ${i + 1}`);

/* ---------- drawing a card ---------- */
function cardHTML(face, o) {
  o = o || {};
  const powers = (H.st && H.st.game && H.st.game.settings && H.st.game.settings.powers) || {};
  const cls = ['pc'];
  if (o.size) cls.push(o.size);
  if (o.locked) cls.push('locked');
  if (o.up) cls.push('up');
  if (o.priv) cls.push('priv');
  if (o.pick) cls.push('pick');
  if (o.sel) cls.push('sel');
  if (o.flash) cls.push('flash');
  const attrs = o.act ? ` data-act="${o.act}" data-k="${esc(o.k)}" role="button" tabindex="0"` : '';
  if (!face) return `<span class="${cls.concat('back').join(' ')}"${attrs} aria-label="Face-down card${o.locked ? ', locked' : ''}"><span class="seven7">777</span></span>`;
  const red = face.s === '♥' || face.s === '♦';
  if (red) cls.push('red');
  if (face.r === '7') cls.push('seven');
  if (face.r === 'X') cls.push('joker');
  const p = POWER[face.r];
  const lbl = face.r === '7' ? (powers['7'] === false ? '= 0' : p.lbl) : (p && powers[face.r] !== false ? p.lbl : '');
  const corner = face.r === 'X' ? 'JKR' : `${face.r}${face.s}`;
  const mid = face.r === 'X' ? '🃏' : face.s;
  return `<span class="${cls.join(' ')}"${attrs} aria-label="${esc(rankName(face.r))}${face.s ? ' of ' + face.s : ''}${lbl ? ', ' + esc(lbl) : ''}${o.locked ? ', locked' : ''}"><span class="corner">${esc(corner)}</span><span class="mid">${esc(mid)}</span>${lbl ? `<span class="lbl">${esc(lbl)}</span>` : '<span></span>'}</span>`;
}

/* ---------- host settings (in the room) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.t7;
  const online = st.players.filter(p => p.connected).length;
  const auto = Math.max(1, Math.ceil(online / 6));
  const seg = (act, k, on, label) => `<button type="button" data-act="${act}" data-k="${k}" aria-pressed="${on}" ${host ? '' : 'disabled'}>${label}</button>`;
  const step = (key, v, lo, hi) => `<span class="t7step">${host ? `<button type="button" data-act="t7-set" data-k="${key}|-1" ${v <= lo ? 'disabled' : ''} aria-label="Less">−</button>` : ''}<output>${v}</output>${host ? `<button type="button" data-act="t7-set" data-k="${key}|1" ${v >= hi ? 'disabled' : ''} aria-label="More">+</button>` : ''}</span>`;
  return `
  <div class="setting"><span class="label">Decks<br><small class="muted" style="font-weight:400">Automatic: 1 deck for up to 6 players</small></span>
    <div class="t7set">${[0, 1, 2, 3, 4].map(n => seg('t7-decks', n, s.decks === n, n ? n : `Auto (${auto})`)).join('')}</div></div>
  <div class="setting"><span class="label">Rounds<br><small class="muted" style="font-weight:400">Lowest total after the last round wins</small></span>${step('rounds', s.rounds, 1, 10)}</div>
  <div class="setting"><span class="label">Calling “last round”<br><small class="muted" style="font-weight:400">Otherwise the round ends when the pile runs out</small></span>
    <div class="t7set">${seg('t7-call', 0, !s.allowCall, 'Off')}${seg('t7-call', 1, s.allowCall, 'On')}</div></div>
  ${s.allowCall ? `<div class="setting"><span class="label">Penalty if the caller isn’t lowest</span>${step('penalty', s.penalty, 0, 30)}</div>` : ''}
  <div class="setting stack"><span class="label">Card powers <small class="muted" style="font-weight:400">tap to turn one off</small></span>
    <div class="t7set">${ORDER.map(r => seg('t7-power', r, s.powers[r] !== false, `${rankName(r)} · ${esc(POWER[r].lbl)}`)).join('')}</div></div>
  <div class="setting stack"><span class="label">How to play</span>${rulesList(s)}</div>`;
}
function rulesList(s) {
  return `<ul class="rules">
    <li>Everyone gets 3 face-down cards and looks at one of them. Everyone sees which one.</li>
    <li>On your turn, draw a card. Play it, or put it in place of one of your cards and play that one instead.</li>
    <li>A played card’s power always happens. Locked cards can’t be looked at, moved or replaced, except by a Joker.</li>
    <li>Lowest total wins: <b>7 = 0</b>, A = 1, J/Q/K/Joker = 10, the rest count their number. Three 7s is a perfect 0.</li>
    <li>The round ends when the pile runs out${s.allowCall ? `, or one lap after someone calls “last round” instead of drawing. If the caller isn’t the lowest, they get +${s.penalty}` : ''}.</li>
  </ul>`;
}
function setT7(patch) {
  Object.assign(H.st.settings.t7, patch);
  H.render();
  H.emit('settings', { game: 't7', patch });
}
H.on('t7-decks', (b, k) => setT7({ decks: Number(k) }));
H.on('t7-call', (b, k) => setT7({ allowCall: k === '1' }));
H.on('t7-power', (b, k) => { const p = Object.assign({}, H.st.settings.t7.powers); p[k] = !(p[k] !== false); setT7({ powers: p }); });
H.on('t7-set', (b, k) => {
  const [key, d] = k.split('|');
  const lim = { rounds: [1, 10], penalty: [0, 30] }[key];
  setT7({ [key]: Math.max(lim[0], Math.min(lim[1], H.st.settings.t7[key] + Number(d))) });
});

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('t7-draw', b => { b.disabled = true; move({ a: 'draw' }); });
H.on('t7-call-now', b => {
  if (!H.armed('t7call')) return H.arm('t7call');
  b.disabled = true; move({ a: 'call' });
});
H.on('t7-play', b => { b.disabled = true; move({ a: 'play' }); });
H.on('t7-card', (b, k) => {
  const g = H.st.game, me = H.st.you, id = Number(k);
  if (g.phase === 'peek') return move({ a: 'peek', id });
  const t = g.turn;
  if (!t || t.pid !== me) return;
  if (t.step === 'decide') return move({ a: 'keep', id });
  if (t.step === 'power' && t.power && t.power.opts && t.power.opts.cards) {
    const n = t.power.opts.n;
    L.sel = L.sel.includes(id) ? L.sel.filter(x => x !== id) : [...L.sel, id].slice(-n);
    if (L.sel.length === n) { const ids = L.sel.slice(); L.sel = []; move({ a: 'power', ids }); }
    else H.render();
  }
});
H.on('t7-player', (b, k) => {
  const t = H.st.game.turn;
  if (!t || !t.power || !t.power.opts || !t.power.opts.players) return;
  const n = t.power.opts.n;
  L.sel = L.sel.includes(k) ? L.sel.filter(x => x !== k) : [...L.sel, k].slice(-n);
  if (L.sel.length === n) { const pids = L.sel.slice(); L.sel = []; move({ a: 'power', pids }); }
  else H.render();
});
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.pc[data-act]')) { e.preventDefault(); e.target.click(); }
});

/* ---------- rendering ---------- */
function render(main, st) {
  const g = st.game;
  H.S.built = 't7:' + st.code;
  const me = st.you, t = g.turn;
  const playing = g.order.includes(me);
  // Reset a half-made choice when the step changes.
  const key = t ? `${t.pid}:${t.step}:${t.power ? t.power.r : ''}:${g.discardCount}` : g.phase;
  if (key !== L.selKey) { L.selKey = key; L.sel = []; }
  if (g.touched && g.touched.seq !== L.flashSeq) { L.flashSeq = g.touched.seq; L.flashAt = Date.now(); L.flashIds = g.touched.ids; }
  const flashing = Date.now() - L.flashAt < 1200 ? L.flashIds : [];

  // Which cards and players can be tapped right now.
  let pickCards = [], pickPlayers = [];
  if (g.phase === 'peek' && playing && !g.peeked.includes(me)) pickCards = g.rows[me].map(c => c.id);
  if (t && t.pid === me && t.step === 'decide') pickCards = g.rows[me].filter(c => !c.locked).map(c => c.id);
  if (t && t.pid === me && t.step === 'power' && t.power && t.power.opts) {
    if (t.power.opts.cards) pickCards = t.power.opts.cards;
    if (t.power.opts.players) pickPlayers = t.power.opts.players;
  }
  const reveal = g.phase === 'roundEnd' || g.phase === 'over';
  const seat = pid => {
    const row = g.rows[pid] || [];
    const isMe = pid === me;
    const cards = row.map(c => cardHTML(c.face, {
      locked: c.locked, up: c.up && !reveal, priv: c.priv, flash: flashing.includes(c.id),
      pick: pickCards.includes(c.id), sel: L.sel.includes(c.id),
      act: pickCards.includes(c.id) ? 't7-card' : '', k: c.id
    })).join('');
    const score = reveal && g.summary ? ` · ${g.summary.scores[pid]} pts` : '';
    const status = t && t.pid === pid ? (t.step === 'power' && t.power ? `using ${rankName(t.power.r)}…` : 'their turn') : (g.phase === 'peek' ? (g.peeked.includes(pid) ? 'ready' : 'peeking…') : '');
    return `<div class="t7seat${t && t.pid === pid ? ' turn' : ''}${isMe ? ' me' : ''}">
      <div class="t7head">${H.avatar(pid, 38)}<span class="nm">${esc(isMe ? 'You' : H.nameOf(pid))}<small>${esc(isMe && t && t.pid === me ? 'your turn' : status)}${score}</small></span>${g.settings.rounds > 1 ? `<span class="tot">${g.totals[pid]} total</span>` : ''}</div>
      <div class="t7row">${cards}</div></div>`;
  };
  const top = g.discard[g.discard.length - 1];
  const others = g.order.filter(p => p !== me);
  H.keepFocus(main, () => {
    main.innerHTML = `<section class="t7" aria-label="The Triple Seven">
      <div class="t7-top"><div class="t7-title">The Triple Seven<small>${g.settings.rounds > 1 ? `Round ${g.round} of ${g.settings.rounds}` : ''}</small></div>
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}</div>
      <div class="t7-table">
        <div class="t7-pilebox"><span class="pilestack">${g.pileLeft ? cardHTML(null) : ''}</span><span class="pilecount"><b>${g.pileLeft}</b><small>card${g.pileLeft === 1 ? '' : 's'} left in the pile</small></span></div>
        <div class="t7-pilebox">${top ? cardHTML(top) : '<span class="muted">Nothing played yet</span>'}<span class="pilecount"><small>Last played</small></span></div>
      </div>
      ${g.called && g.phase === 'play' ? `<div class="called">📣 ${esc(nm(g.called, st))} called last round! Everyone else gets one more turn.</div>` : ''}
      ${actHTML(g, st, pickPlayers)}
      <div class="t7-seats">${others.map(seat).join('')}</div>
      ${playing ? `<div class="t7-seats">${seat(me)}</div>` : '<p class="muted" style="margin:0">You joined after this game started, so you’re watching this one.</p>'}
      <details class="t7-log"${L.logOpen ? ' open' : ''}><summary>What happened</summary><ol>${g.log.slice().reverse().map(e => `<li>${logLine(e, st)}</li>`).join('')}</ol></details>
      <details class="t7-rules"><summary>How to play</summary>${rulesList(g.settings)}
        <ul>${ORDER.filter(r => g.settings.powers[r] !== false).map(r => `<li><b>${rankName(r)}</b>: ${esc(POWER[r].long)}</li>`).join('')}</ul></details>
    </section>`;
  });
  const lg = main.querySelector('.t7-log');
  if (lg) lg.addEventListener('toggle', () => { L.logOpen = lg.open; });
}

function powerText(r) { return POWER[r] ? POWER[r].long : ''; }
function recent(g, st) {
  const last = g.log.slice(-3).reverse().map(e => logLine(e, st)).filter(Boolean);
  return last.length ? `<div class="t7-recent">${last.map(x => `<div>${x}</div>`).join('')}</div>` : '';
}

function actHTML(g, st, pickPlayers) {
  const me = st.you, t = g.turn;
  if (g.phase === 'roundEnd' || g.phase === 'over') return summaryHTML(g, st);
  if (g.phase === 'peek') {
    const left = Math.max(0, Math.ceil((g.peekEnds - H.now()) / 1000));
    if (g.order.includes(me) && !g.peeked.includes(me)) return `<div class="t7-act"><h3>Pick one of your cards to look at</h3><p class="muted">Only you will see it. Everyone sees which one you picked. <span id="t7Left">(${left}s)</span></p></div>`;
    return `<div class="t7-act"><h3>Waiting for everyone to look at a card…</h3><p class="muted"><span id="t7Left">(${left}s)</span></p></div>`;
  }
  if (!t) return '';
  const who = esc(nm(t.pid, st));
  if (t.pid !== me) {
    let what = 'is drawing…';
    if (t.step === 'start') what = 'is deciding whether to draw or call last round…';
    if (t.step === 'decide') what = 'drew a card and is deciding…';
    if (t.step === 'power' && t.power) what = `is using ${t.power.echo ? 'Echo → ' : ''}<b>${rankName(t.power.r)}</b>: ${esc(POWER[t.power.r].lbl)}…`;
    return `<div class="t7-act"><h3>${who} ${what}</h3>${t.extra ? '<p class="muted">They have another turn coming.</p>' : ''}${recent(g, st)}</div>`;
  }
  if (t.step === 'start') {
    return `<div class="t7-act"><h3>Your turn${t.extra ? ' (again!)' : ''}</h3>${recent(g, st)}
      <div class="row"><button type="button" class="btn primary big" data-act="t7-draw">Draw a card</button>
      <button type="button" class="btn${H.armed('t7call') ? ' danger' : ''}" data-act="t7-call-now">${H.armed('t7call') ? `Tap again to call it (+${g.settings.penalty} if you’re not lowest)` : 'Call last round'}</button></div></div>`;
  }
  if (t.step === 'decide' && t.drawn && t.drawn !== true) {
    const p = POWER[t.drawn.r];
    return `<div class="t7-act"><h3>You drew:</h3>
      <div class="t7-drawn">${cardHTML(t.drawn, { size: 'big' })}<div style="display:grid;gap:8px;max-width:46ch">
        ${p && g.settings.powers[t.drawn.r] !== false ? `<p class="muted">${esc(p.long)}</p>` : ''}
        <div class="row"><button type="button" class="btn primary" data-act="t7-play">Play it</button></div>
        <p class="muted">Or tap one of your cards to keep this one in its place. That card gets played instead.</p></div></div></div>`;
  }
  if (t.step === 'power' && t.power) {
    const r = t.power.r, o = t.power.opts || {};
    let ask = '';
    if (o.players) {
      ask = `<div class="t7-players">${o.players.map(p => `<button type="button" data-act="t7-player" data-k="${esc(p)}" aria-pressed="${L.sel.includes(p)}">${H.avatar(p, 28)}${esc(nm(p, st))}</button>`).join('')}</div>`;
    } else ask = `<p class="muted">Tap ${o.n === 2 ? `two cards${L.sel.length ? ' (one more)' : ''}` : 'a highlighted card'} on the table.</p>`;
    return `<div class="t7-act"><h3>${t.power.echo ? 'Echo → ' : ''}${rankName(r)}: ${esc(POWER[r].lbl)}</h3><p>${esc(powerText(r))}</p>${ask}</div>`;
  }
  return `<div class="t7-act"><h3>…</h3></div>`;
}

function summaryHTML(g, st) {
  const s = g.summary;
  const ranked = g.order.slice().sort((a, b) => g.totals[a] - g.totals[b]);
  let place = 0, prev = null;
  const rows = ranked.map((pid, i) => {
    if (g.totals[pid] !== prev) { place = i + 1; prev = g.totals[pid]; }
    const pen = s && s.penalty && s.caller === pid ? ` <span class="pen">+${s.penalty} penalty</span>` : '';
    const round = s ? `${s.scores[pid]} this round${pen}` : '';
    return `<li><span class="pl">${place}</span>${H.avatar(pid, 30)}<span>${esc(nm(pid, st))}<br><small class="muted">${round}</small></span><span class="pt">${g.totals[pid]}</span></li>`;
  }).join('');
  const why = s ? (s.why === 'call' ? `${esc(nm(s.caller, st))} called last round.${s.penalty ? ' They weren’t the lowest!' : ' They were right.'}` : 'The pile ran out.') : '';
  if (g.phase === 'over') {
    const w = (g.winners || []).map(p => esc(nm(p, st)));
    return `<div class="t7-act"><div class="t7-winner">${w.length > 1 ? `${w.join(' & ')} tie!` : `${w[0] === 'You' ? 'You win' : w[0] + ' wins'}!`}</div>
      <p class="muted">${why} Everyone’s cards are face up below.</p><ol class="t7-sum">${rows}</ol>
      <div class="row">${H.isHost()
        ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
        : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
  }
  const secs = Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000));
  return `<div class="t7-act"><h3>Round ${g.round} is over</h3><p class="muted">${why} Everyone’s cards are face up below.</p><ol class="t7-sum">${rows}</ol>
    <p class="muted">Next round in <span id="t7Next">${secs}</span> seconds.</p></div>`;
}

function logLine(e, st) {
  const p = esc(nm(e.pid, st));
  const owner = (pid, i) => `${pid === st.you ? 'your' : esc(H.nameOf(pid)) + '’s'} ${pos(i, ((st.game.rows[pid] || []).length) || 3)} card`;
  const card = c => `<b>${esc(rankName(c.r))}${c.s ? esc(c.s) : ''}</b>`;
  switch (e.k) {
    case 'round': return `<b>Round ${e.n} started</b> (${e.decks} deck${e.decks > 1 ? 's' : ''})`;
    case 'peek0': return `${p} looked at ${e.pid === st.you ? 'your' : 'their'} ${pos(e.idx, 3)} card`;
    case 'play':
      if (e.k2 === 'swapped') return `${p} kept the drawn card as ${e.pid === st.you ? 'your' : 'their'} ${pos(e.idx, ((st.game.rows[e.pid] || []).length) || 3)} card and played ${card(e.card)}`;
      if (e.k2 === 'removed') return `${p} removed ${card(e.card)} from ${e.pid === st.you ? 'your' : 'their'} row`;
      return `${p} played the drawn ${card(e.card)}`;
    case 'echo': return `${p}’s Echo repeats <b>${esc(rankName(e.r))}</b>`;
    case 'fizzle': return `${p}’s ${esc(rankName(e.r))} had nothing to do`;
    case 'fullsight': return `${p} looked at all of ${e.pid === st.you ? 'your' : 'their'} cards`;
    case 'skip': return `${p} will skip the next player`;
    case 'skipped': return `⏭ ${p} ${e.pid === st.you ? 'were' : 'was'} skipped`;
    case 'again': return `${p} get${e.pid === st.you ? '' : 's'} another turn`;
    case 'add': return `${p} added a card to ${esc(nm(e.target, st))}${e.target === st.you ? 'r' : '’s'} row`;
    case 'spy': return `${p} spied on ${esc(nm(e.target, st))}${e.target === st.you ? 'r' : '’s'} whole row`;
    case 'rows': return `🃏 ${p} swapped ${esc(nm(e.a, st))}${e.a === st.you ? 'r' : '’s'} and ${esc(nm(e.b, st))}${e.b === st.you ? 'r' : '’s'} rows`;
    case 'remove': return '';
    case 'spot': return `💡 ${p} turned ${owner(e.target, e.idx)} face up: ${card(e.card)}`;
    case 'jpeek': return `${p} peeked at ${owner(e.target, e.idx)}`;
    case 'lock': return `🔒 ${p} locked ${owner(e.target, e.idx)}`;
    case 'unlock': return `🔓 ${p} unlocked ${owner(e.target, e.idx)}`;
    case 'swap': return `🔀 ${p} swapped ${owner(e.a, e.ai)} with ${owner(e.b, e.bi)}`;
    case 'call': return `📣 ${p} called last round`;
    case 'roundEnd': return `<b>Round ${e.n} over</b>`;
  }
  return '';
}

/* ---------- announcements ---------- */
function banner(html) {
  L.queue.push(html);
  if (!L.showing) showNext();
}
function showNext() {
  const h = L.queue.shift();
  if (!h) { L.showing = false; return; }
  L.showing = true;
  const el = document.createElement('div');
  el.className = 't7-banner';
  el.innerHTML = h;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, 1500);
}
function fx(e) {
  const st = H.st;
  if (!st) return;
  if (e.type === 'call') banner(`📣 LAST ROUND!<small>${esc(nm(e.pid, st))} called it</small>`);
  else if (e.type === 'skipped') banner(`⏭ SKIPPED<small>${esc(nm(e.pid, st))} loses a turn</small>`);
  else if (e.type === 'rows') banner(`🃏 ROWS SWAPPED<small>${esc(nm(e.a, st))} ⇄ ${esc(nm(e.b, st))}</small>`);
}

Hub.registerGame('t7', {
  title: 'The Triple Seven',
  settings,
  render,
  fx: e => fx(e),
  tick(st) {
    const g = st.game;
    if (!g) return;
    if (g.phase === 'peek') H.setText('t7Left', '(' + Math.max(0, Math.ceil((g.peekEnds - H.now()) / 1000)) + 's)');
    if (g.phase === 'roundEnd') H.setText('t7Next', String(Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000))));
    // take the highlight off recently changed cards
    if (L.flashAt && Date.now() - L.flashAt > 1300) { L.flashAt = 0; document.querySelectorAll('.t7 .pc.flash').forEach(el => el.classList.remove('flash')); }
  }
});
})();
