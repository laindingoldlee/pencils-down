/*
 * Countercurrent: The Pelagos Protocol. What each player sees and clicks.
 * Rules live on the server (games/countercurrent.js). Your own hand is sent only to you;
 * everyone else just sees how many cards each team holds.
 *
 * Pictures are optional: drop files into public/games/countercurrent/art/ (names in the
 * README) and they replace the drawn stand-ins.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

const COLORS = ['crimson', 'amber', 'jade', 'cobalt'];
const COUNTS = { crimson: 2, amber: 3, jade: 4, cobalt: 5 };
const SAME = 6;
const PROFILES = [['crimson', 'amber'], ['crimson', 'jade'], ['crimson', 'cobalt'], ['amber', 'jade'], ['amber', 'cobalt'], ['jade', 'cobalt'], null];
const TILE = {
  scan: { name: 'Scan', icon: '🔍', short: 'Give one A, it comes back. They privately tell you how many B they hold.' },
  transfer: { name: 'Transfer', icon: '⇄', short: 'Give one A. They give you all their B.' },
  synthesize: { name: 'Synthesize', icon: '⚗', short: 'They give you one of each colour on the profile, if they have them.' },
  acquire: { name: 'Acquire', icon: '🤲', short: 'Name a colour on the profile. They give you one if they have one.' },
  declare: { name: 'Declare', icon: '📣', short: 'Claim the profile you think is the formula.' }
};
const SET_NAME = { intro: 'Introductory', standard: 'Standard', full: 'Full Protocol' };
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const an = c => (c === 'amber' ? 'an amber' : 'a ' + c);
const pName = p => (p === SAME ? 'Same colour' : PROFILES[p].map(cap).join(' + '));
const nm = (pid, st) => (pid === st.you ? 'You' : H.nameOf(pid));
const nmObj = (pid, st) => (pid === st.you ? 'you' : H.nameOf(pid));
const art = () => (H.catalog && H.catalog.cc && H.catalog.cc.art) || {};

const L = { sel: {}, selKey: '', mode: '', lastHTML: '', queue: [], showing: false };

/* ---------- pictures (or drawn stand-ins) ---------- */
function dot(c, size) {
  const a = art()['compound-' + c];
  return a
    ? `<img class="ccdot img" src="${esc(a)}" alt="" style="${size ? `--d:${size}px` : ''}">`
    : `<span class="ccdot ${c}" style="${size ? `--d:${size}px` : ''}" aria-hidden="true"></span>`;
}
function sampleCard(c, o) {
  o = o || {};
  const a = art()['sample-' + c];
  const n = o.n != null ? `<span class="ccn">×${o.n}</span>` : '';
  if (a) return `<span class="ccsample pic${o.size ? ' ' + o.size : ''}" aria-label="${cap(c)} sample"><img src="${esc(a)}" alt="">${n}</span>`;
  return `<span class="ccsample ${c}${o.size ? ' ' + o.size : ''}" aria-label="${cap(c)} sample">${dot(c)}<b>${cap(c)}</b>${n}</span>`;
}
function backCard(o) {
  o = o || {};
  const a = art()['card-back'];
  return a ? `<span class="ccsample back pic${o.size ? ' ' + o.size : ''}"><img src="${esc(a)}" alt=""></span>`
    : `<span class="ccsample back${o.size ? ' ' + o.size : ''}" aria-label="Face-down sample"><span>Ⓟ</span></span>`;
}
function tileIcon(t) {
  const a = art()['protocol-' + t];
  return a ? `<img class="cctileimg" src="${esc(a)}" alt="">` : `<span class="cctileico" aria-hidden="true">${TILE[t].icon}</span>`;
}
function markerIcon(kind, fallback) {
  const a = art()['marker-' + kind];
  return a ? `<span class="ccmask" style="--m:url('${esc(a)}')" aria-hidden="true"></span>` : `<span aria-hidden="true">${fallback}</span>`;
}
function profileFace(p) {
  const a = art()['profile-' + p];
  if (a) return `<img class="ccprofimg" src="${esc(a)}" alt="">`;
  if (p === SAME) return `<span class="ccpair same"><span class="ccdot any"></span><span class="eq">=</span><span class="ccdot any"></span></span>`;
  return `<span class="ccpair">${dot(PROFILES[p][0])}${dot(PROFILES[p][1])}</span>`;
}

/* ---------- private notes (paper and pencil, kept in this browser) ---------- */
const NOTE_STEPS = ['', '0', '1', '2', '3', '4', '5', '✓', '?'];
function notesKey(st) { return `cc.notes.${st.code}.${st.game.round}.${st.game.order.join('')}`; }
function loadNotes(st) {
  const k = notesKey(st);
  if (L.notesK === k) return L.notes;
  let n = null;
  try { n = JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { n = null; }
  L.notesK = k;
  L.notes = n && typeof n === 'object' ? n : { cells: {}, cross: {} };
  return L.notes;
}
function saveNotes() { try { localStorage.setItem(L.notesK, JSON.stringify(L.notes)); } catch (e) { /* private mode */ } }

/* ---------- host settings (in the room) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.cc;
  const online = st.players.filter(p => p.connected).length;
  const seg = (act, k, on, label) => `<button type="button" data-act="${act}" data-k="${k}" aria-pressed="${on}" ${host ? '' : 'disabled'}>${label}</button>`;
  const step = (v, lo, hi) => `<span class="ccstep">${host ? `<button type="button" data-act="cc-target" data-k="-1" ${v <= lo ? 'disabled' : ''} aria-label="Less">−</button>` : ''}<output>${v}</output>${host ? `<button type="button" data-act="cc-target" data-k="1" ${v >= hi ? 'disabled' : ''} aria-label="More">+</button>` : ''}</span>`;
  return `
  ${online < 3 || online > 4 ? `<p class="muted" style="margin:0 0 6px">Countercurrent is for <b>3 or 4 players</b>. ${online} ${online === 1 ? 'is' : 'are'} here now.</p>` : ''}
  <div class="setting"><span class="label">Protocols<br><small class="muted" style="font-weight:400">${esc(setLine(s.protocols))}</small></span>
    <div class="ccset">${['intro', 'standard', 'full'].map(k => seg('cc-set', k, s.protocols === k, SET_NAME[k])).join('')}</div></div>
  <div class="setting"><span class="label">Points to win</span>${step(s.target, 3, 15)}</div>
  <div class="setting"><span class="label">Trace analysis (advanced)<br><small class="muted" style="font-weight:400">After a protocol, secretly bet on one formula colour: +1 if right, −1 if wrong</small></span>
    <div class="ccset">${seg('cc-trace', 0, !s.trace, 'Off')}${seg('cc-trace', 1, s.trace, 'On')}</div></div>
  <div class="setting stack"><span class="label">How to play</span>${rulesList(s)}</div>`;
}
const setLine = k => ({ intro: 'Scan and Declare', standard: 'Transfer, Acquire and Declare', full: 'All five: Scan, Transfer, Synthesize, Acquire, Declare' }[k]);
function rulesList(s) {
  const tiles = { intro: ['scan', 'declare'], standard: ['transfer', 'acquire', 'declare'], full: Object.keys(TILE) }[s.protocols];
  return `<ul class="rules">
    <li>There are 14 samples: 2 crimson, 3 amber, 4 jade and 5 cobalt. Each round, 2 are sealed away as the <b>formula</b> and the rest are dealt out.</li>
    <li>On your turn, move your Field Team to a reaction profile <b>other than the one it was on last turn</b>, then use one unused protocol with that profile’s two colours.</li>
    ${tiles.map(t => `<li><b>${TILE[t].name}</b>: ${esc(TILE[t].short)}</li>`).join('')}
    <li>On the <b>same-colour</b> profile you name a colour, and it’s used as both colours.</li>
    <li>You can’t Scan or Transfer without a sample to give. If you can’t use any protocol left, you pass.</li>
    <li>A cycle is one turn per protocol (${tiles.length} turns). Then all the protocols come back.</li>
    <li><b>Declaring</b>: claim a profile. Going round, the other teams may claim a different profile, back one that’s been claimed, or pass.</li>
    <li>Right claim <b>+3</b>, right back <b>+1</b>, wrong back <b>−1</b> straight away (you keep your marker). A wrong claim loses your claim marker for the round. The last team with a marker must declare.</li>
    ${s.trace ? '<li><b>Trace</b>: after Scan, Transfer, Synthesize or Acquire you may secretly bet on a formula colour (8 markers shared). Right +1, wrong −1 when the formula is revealed.</li>' : ''}
    <li>Scores never go below 0. First to <b>${s.target}</b> wins; a tie plays another round.</li>
  </ul>`;
}
function setCC(patch) {
  Object.assign(H.st.settings.cc, patch);
  H.render();
  H.emit('settings', { game: 'cc', patch });
}
H.on('cc-set', (b, k) => setCC({ protocols: k }));
H.on('cc-trace', (b, k) => setCC({ trace: k === '1' }));
H.on('cc-target', (b, k) => setCC({ target: Math.max(3, Math.min(15, H.st.settings.cc.target + Number(k))) }));

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('cc-prof', (b, k) => {
  const g = H.st.game, me = H.st.you, p = Number(k);
  if (L.mode === 'reply-claim') { L.mode = ''; return move({ a: 'reply', type: 'claim', profile: p }); }
  if (!g.turn || g.turn.pid !== me || g.turn.step !== 'act') {
    // Not your turn: tapping a profile crosses it out in your own notes.
    const n = loadNotes(H.st); n.cross[p] = !n.cross[p]; saveNotes(); return H.render();
  }
  if (L.sel.tile === 'declare' && L.sel.profile != null) { L.sel.claim = p; return H.render(); }
  if (p === g.field[me]) return H.toast('Your Field Team has to move to a different profile from last turn.');
  L.sel.profile = p;
  // A change of profile can make the chosen colours meaningless.
  if (L.sel.give && (p === SAME || !PROFILES[p].includes(L.sel.give))) delete L.sel.give;
  if (L.sel.color && p !== SAME && !PROFILES[p].includes(L.sel.color)) delete L.sel.color;
  H.render();
});
H.on('cc-tile', (b, k) => {
  if (L.sel.tile === k) delete L.sel.tile; else L.sel.tile = k;
  if (k !== 'declare') delete L.sel.claim;
  H.render();
});
H.on('cc-give', (b, k) => { L.sel.give = k; H.render(); });
H.on('cc-color', (b, k) => { L.sel.color = k; H.render(); });
H.on('cc-target-pl', (b, k) => { L.sel.target = k; H.render(); });
H.on('cc-go', b => {
  const s = L.sel;
  b.disabled = true;
  move(Object.assign({ a: 'act' }, s)).then(r => { if (r.ok) L.sel = {}; });
});
H.on('cc-pass', b => {
  if (!H.armed('ccpass')) return H.arm('ccpass');
  b.disabled = true; move({ a: 'pass' });
});
H.on('cc-trace-pick', (b, k) => { b.disabled = true; move({ a: 'trace', color: k === 'none' ? null : k }); });
H.on('cc-reply-claim', () => { L.mode = L.mode === 'reply-claim' ? '' : 'reply-claim'; H.render(); });
H.on('cc-reply-back', (b, k) => { b.disabled = true; L.mode = ''; move({ a: 'reply', type: 'back', profile: Number(k) }); });
H.on('cc-reply-pass', b => { b.disabled = true; L.mode = ''; move({ a: 'reply', type: 'pass' }); });
H.on('cc-note', (b, k) => {
  const n = loadNotes(H.st);
  const cur = n.cells[k] || '';
  n.cells[k] = NOTE_STEPS[(NOTE_STEPS.indexOf(cur) + 1) % NOTE_STEPS.length];
  saveNotes(); H.render();
});
H.on('cc-cross', (b, k) => { const n = loadNotes(H.st); n.cross[k] = !n.cross[k]; saveNotes(); H.render(); });
H.on('cc-notes-clear', () => { const n = loadNotes(H.st); n.cells = {}; n.cross = {}; saveNotes(); H.render(); });
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (H.st && H.st.game && H.st.game.id === 'cc') { L.lastHTML = ''; H.render(); } }, 150); });

/* ---------- rendering ---------- */
function render(main, st) {
  const g = st.game;
  H.S.built = 'cc:' + st.code;
  const me = st.you, t = g.turn;
  const playing = g.order.includes(me);
  // Reset a half-made choice when the turn moves on.
  const key = t ? `${g.round}:${t.pid}:${t.step}:${g.log.length ? g.log[g.log.length - 1].n : 0}:${g.decl ? g.decl.cur : ''}` : g.phase;
  if (key !== L.selKey) { L.selKey = key; L.sel = {}; L.mode = ''; }
  const myTurn = t && t.pid === me && t.step === 'act';
  const notes = playing ? loadNotes(st) : { cells: {}, cross: {} };
  const reveal = g.phase === 'roundEnd' || g.phase === 'over';
  const right = reveal && g.summary ? g.summary.right : -1;

  // ---- the seven profiles ----
  const claimsOn = p => (g.decl ? g.decl.claims.filter(c => c.profile === p) : (reveal && g.summary ? g.summary.claims.filter(c => c.profile === p) : []));
  const tapProfile = myTurn || L.mode === 'reply-claim' || playing;
  const profs = [0, 1, 2, 3, 4, 5, 6].map(p => {
    const teams = g.order.filter(pid => g.field[pid] === p);
    const cls = ['ccprof'];
    if (g.dead.includes(p)) cls.push('dead');
    if (notes.cross[p]) cls.push('crossed');
    if (myTurn && L.sel.profile === p) cls.push('sel');
    if (myTurn && L.sel.tile === 'declare' && L.sel.claim === p) cls.push('claim');
    if (myTurn && p === g.field[me] && !(L.sel.tile === 'declare' && L.sel.profile != null)) cls.push('nope');
    if (L.mode === 'reply-claim' && !g.dead.includes(p) && !claimsOn(p).length) cls.push('pickable');
    if (p === right) cls.push('right');
    const flags = claimsOn(p).map(c => `<span class="ccflag ${c.type}" title="${esc(nm(c.pid, st))} ${c.type === 'claim' ? 'claims' : 'backs'} this">${markerIcon('claim', c.type === 'claim' ? '🚩' : '🤝')}${H.avatar(c.pid, 18)}</span>`).join('');
    return `<button type="button" class="${cls.join(' ')}" data-act="cc-prof" data-k="${p}" ${tapProfile ? '' : 'disabled'} aria-label="${esc(pName(p))}${g.dead.includes(p) ? ', shown wrong' : ''}">
      ${profileFace(p)}<span class="ccpname">${esc(pName(p))}</span>
      <span class="ccteams">${teams.map(pid => `<span class="ccfield" title="${esc(nm(pid, st))}’s Field Team">${H.avatar(pid, 20)}</span>`).join('')}</span>
      ${flags ? `<span class="ccflags">${flags}</span>` : ''}
    </button>`;
  }).join('');

  // ---- the sealed formula ----
  const formula = `<div class="ccformula${art().formula ? ' pic' : ''}"${art().formula ? ` style="--fbg:url('${esc(art().formula)}')"` : ''}>
      <span class="cclabel">Sealed formula</span>
      <div class="ccrow">${g.formula ? g.formula.map(c => sampleCard(c, { size: 'mid' })).join('') : backCard({ size: 'mid' }) + backCard({ size: 'mid' })}</div>
    </div>`;

  // ---- protocol tiles ----
  const tiles = `<div class="cctiles" aria-label="Protocols">${g.tiles.map(k => {
    const used = g.used.includes(k);
    const canPick = myTurn && (g.forced === me ? k === 'declare' : !used) && (k !== 'declare' || t.canDeclare);
    return `<button type="button" class="cctile${used ? ' used' : ''}${myTurn && L.sel.tile === k ? ' sel' : ''}" data-act="cc-tile" data-k="${k}" ${canPick ? '' : 'disabled'} title="${esc(TILE[k].short)}">${tileIcon(k)}<span>${TILE[k].name}</span></button>`;
  }).join('')}<span class="ccmeta">${g.used.length}/${g.tiles.length} this cycle${g.settings.trace ? ` · ${markerIcon('trace', '◆')} ${g.traceLeft} trace${g.traceLeft === 1 ? '' : 's'} left` : ''}</span></div>`;

  // ---- teams ----
  const around = playing ? [...g.order.slice(g.order.indexOf(me) + 1), ...g.order.slice(0, g.order.indexOf(me))] : g.order;
  const team = pid => {
    const isTurn = t && t.pid === pid, answering = g.decl && g.decl.cur === pid;
    const traces = g.traces.filter(x => x.pid === pid);
    const pick = myTurn && L.sel.tile && L.sel.tile !== 'declare';
    const handBacks = reveal && g.hands ? COLORS.filter(c => g.hands[pid][c]).map(c => sampleCard(c, { size: 'tiny', n: g.hands[pid][c] })).join('') : '';
    const inner = `${H.avatar(pid, 32)}<span class="ccnm">${esc(nm(pid, st))}${pid === g.firstPid ? ` <span class="ccfirst" title="First player this round">${markerIcon('first', '①')}</span>` : ''}
        <small>${g.counts[pid]} sample${g.counts[pid] === 1 ? '' : 's'} · ${g.marker[pid] ? `${markerIcon('claim', '🚩')} marker` : '<s>marker lost</s>'}${traces.length ? ` · ${traces.map(x => x.color ? dot(x.color, 10) : markerIcon('trace', '◆')).join('')}` : ''}</small></span>
      <span class="ccscore">${g.scores[pid]}</span>
      ${isTurn ? `<span class="ccbadge">${g.decl ? 'declared' : 'turn'}</span>` : ''}${answering ? '<span class="ccbadge ans">answering</span>' : ''}
      ${handBacks ? `<span class="ccreveal">${handBacks}</span>` : ''}`;
    return pick
      ? `<button type="button" class="ccteam pickme${L.sel.target === pid ? ' sel' : ''}${isTurn ? ' turn' : ''}" data-act="cc-target-pl" data-k="${esc(pid)}">${inner}</button>`
      : `<div class="ccteam${isTurn || answering ? ' turn' : ''}">${inner}</div>`;
  };

  // ---- your hand ----
  const hand = playing ? `<div class="cchand"><div class="ccmeline">${H.avatar(me, 34)}<span class="ccnm">You<small>${g.marker[me] ? `${markerIcon('claim', '🚩')} claim marker ready` : '<s>claim marker lost this round</s>'}${g.traces.filter(x => x.pid === me).map(x => ` · trace ${dot(x.color, 10)}`).join('')}</small></span><span class="ccscore">${g.scores[me]}</span></div>
      <div class="ccrow">${COLORS.filter(c => g.hand[c]).map(c => sampleCard(c, { n: g.hand[c] })).join('') || '<span class="muted">No samples in hand</span>'}</div></div>` : '';

  const notesPanel = playing ? notesHTML(g, st, notes) : '';

  const html = `<section class="cc${art().table ? ' pic' : ''}" aria-label="Countercurrent"${art().table ? ` style="--tbg:url('${esc(art().table)}')"` : ''}>
      <div class="cc-top"><div class="cc-title">${art().logo ? `<img src="${esc(art().logo)}" alt="Countercurrent">` : 'Countercurrent'}<small>Round ${g.round} · ${SET_NAME[g.settings.protocols]} · first to ${g.settings.target}</small></div>
        ${H.dd('cc-log', 'What happened', `<ol>${g.log.slice().reverse().map(e => logLine(e, st)).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ol>`, 'cc-log')}
        ${playing ? H.dd('cc-notes', 'Notes', notesPanel, 'cc-notesdd') : ''}
        ${H.dd('cc-rules', 'How to play', rulesList(g.settings), 'cc-rules')}
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}</div>
      <div class="cc-teams">${around.map(team).join('')}</div>
      <div class="cc-board">${formula}<div class="cc-profiles">${profs}</div></div>
      ${tiles}
      <div class="cc-bottom">${hand}${actHTML(g, st)}</div>
      ${playing ? '' : '<p class="muted" style="margin:0">You’re watching this game.</p>'}
    </section>`;
  if (html === L.lastHTML && main.querySelector('.cc')) return;
  L.lastHTML = html;
  H.keepFocus(main, () => { main.innerHTML = html; });
}

function notesHTML(g, st, notes) {
  const others = g.order.filter(p => p !== st.you);
  const mine = g.hand;
  return `<div class="ccnotes">
    <p class="muted">Your own notes, only in this browser. Tap a box to cycle 0–5, ✓ (has some), ?. Tap a profile here or on the table to cross it out.</p>
    <table><thead><tr><th></th>${COLORS.map(c => `<th>${dot(c, 14)}</th>`).join('')}</tr></thead><tbody>
      <tr><th>In game</th>${COLORS.map(c => `<td>${COUNTS[c]}</td>`).join('')}</tr>
      <tr><th>You</th>${COLORS.map(c => `<td><b>${mine[c]}</b></td>`).join('')}</tr>
      ${others.map(p => `<tr><th>${esc(H.nameOf(p))} <small class="muted">(${g.counts[p]})</small></th>${COLORS.map(c => { const k = p + ':' + c; return `<td><button type="button" class="ccnote" data-act="cc-note" data-k="${esc(k)}">${esc(notes.cells[k] || '')}</button></td>`; }).join('')}</tr>`).join('')}
      <tr><th>Formula</th>${COLORS.map(c => { const k = 'formula:' + c; return `<td><button type="button" class="ccnote" data-act="cc-note" data-k="${esc(k)}">${esc(notes.cells[k] || '')}</button></td>`; }).join('')}</tr>
    </tbody></table>
    <div class="cccross">${[0, 1, 2, 3, 4, 5, 6].map(p => `<button type="button" data-act="cc-cross" data-k="${p}" aria-pressed="${!!notes.cross[p]}" ${g.dead.includes(p) ? 'disabled' : ''}>${esc(pName(p))}</button>`).join('')}</div>
    <button type="button" class="linkbtn" data-act="cc-notes-clear">Clear my notes</button>
  </div>`;
}

function recent(g, st) {
  const last = g.log.slice(-3).reverse().map(e => logLine(e, st)).filter(Boolean);
  return last.length ? `<div class="cc-recent">${last.map(x => `<div>${x}</div>`).join('')}</div>` : '';
}

function actHTML(g, st) {
  const me = st.you, t = g.turn;
  if (g.phase === 'roundEnd' || g.phase === 'over') return summaryHTML(g, st);
  if (!t) return '';
  const who = esc(nm(t.pid, st));
  // ---- a declaration is going round ----
  if (g.decl) {
    const d = g.decl;
    const claimed = d.claims.filter(c => c.type === 'claim');
    const left = Math.max(0, Math.ceil((d.ends - H.now()) / 1000));
    const list = d.claims.map(c => `<li>${H.avatar(c.pid, 20)} ${esc(nm(c.pid, st))} ${c.type === 'claim' ? 'claim' + (c.pid === me ? '' : 's') : 'back' + (c.pid === me ? '' : 's')} <b>${esc(pName(c.profile))}</b></li>`).join('');
    if (d.cur === me) {
      return `<div class="cc-act"><h3>📣 ${esc(nm(d.by, st))} declared. Your answer <span class="muted" id="ccLeft">(${left}s)</span></h3><ul class="ccclaims">${list}</ul>
        <div class="row">
          <button type="button" class="btn${L.mode === 'reply-claim' ? ' primary' : ''}" data-act="cc-reply-claim">${L.mode === 'reply-claim' ? 'Now tap a free profile above' : 'Make my own claim (+3 if right)'}</button>
          ${claimed.map(c => `<button type="button" class="btn" data-act="cc-reply-back" data-k="${c.profile}">Back ${esc(pName(c.profile))} (+1 / −1)</button>`).join('')}
          <button type="button" class="btn" data-act="cc-reply-pass">Pass</button></div>
        <p class="muted">A wrong claim loses your marker for the round. A wrong back costs 1 point now, but you keep your marker.</p></div>`;
    }
    return `<div class="cc-act"><h3>📣 ${esc(nm(d.by, st))} declared</h3><ul class="ccclaims">${list}</ul>
      <p class="muted">${d.cur ? `Waiting for ${esc(nm(d.cur, st))} to claim, back or pass… <span id="ccLeft">(${left}s)</span>` : 'Checking the formula…'}</p></div>`;
  }
  if (t.pid !== me) {
    const what = t.step === 'trace' ? 'is deciding on a Trace marker…' : (g.forced === t.pid ? 'is the last team with a claim marker and must declare…' : 'is choosing a profile and protocol…');
    return `<div class="cc-act"><h3>${who} ${what}</h3>${recent(g, st)}</div>`;
  }
  if (t.step === 'trace') {
    return `<div class="cc-act"><h3>Place a Trace marker?</h3><p class="muted">Secretly bet on one colour in the formula: +1 if it’s in it, −1 if not, when the formula is revealed. ${g.traceLeft} left.</p>
      <div class="row">${COLORS.map(c => `<button type="button" class="btn ccc" data-act="cc-trace-pick" data-k="${c}">${dot(c)} ${cap(c)}</button>`).join('')}
      <button type="button" class="btn" data-act="cc-trace-pick" data-k="none">No trace</button></div></div>`;
  }
  // ---- your turn: build the move one choice at a time ----
  const s = L.sel, hand = g.hand;
  const steps = [];
  const forced = g.forced === me;
  steps.push(s.profile == null
    ? `<li class="now">Tap a reaction profile above to move your Field Team${g.field[me] != null ? ` (not ${esc(pName(g.field[me]))} again)` : ''}.</li>`
    : `<li class="done">Field Team → <b>${esc(pName(s.profile))}</b></li>`);
  if (s.profile != null) {
    steps.push(!s.tile ? `<li class="now">Pick a protocol${forced ? ': you must <b>Declare</b>' : ''}.</li>` : `<li class="done">${TILE[s.tile].icon} <b>${TILE[s.tile].name}</b>: ${esc(TILE[s.tile].short)}</li>`);
  }
  let ready = false;
  if (s.profile != null && s.tile) {
    const same = s.profile === SAME, pair = PROFILES[s.profile];
    if (s.tile === 'declare') {
      steps.push(s.claim == null ? '<li class="now">Now tap the profile you claim is the formula.</li>' : `<li class="done">Claim <b>${esc(pName(s.claim))}</b></li>`);
      ready = s.claim != null;
    } else {
      let colourOk = true;
      if (same) {
        const need = s.tile === 'scan' || s.tile === 'transfer';
        steps.push(`<li class="${s.color ? 'done' : 'now'}">Name the colour (everyone will see it):<div class="row">${COLORS.map(c => `<button type="button" class="btn ccc" data-act="cc-color" data-k="${c}" aria-pressed="${s.color === c}" ${need && !hand[c] ? 'disabled' : ''}>${dot(c)} ${cap(c)}</button>`).join('')}</div></li>`);
        colourOk = !!s.color;
      } else if (s.tile === 'scan' || s.tile === 'transfer') {
        steps.push(`<li class="${s.give ? 'done' : 'now'}">Which colour do you give?<div class="row">${pair.map(c => { const o = pair.find(x => x !== c); return `<button type="button" class="btn ccc" data-act="cc-give" data-k="${c}" aria-pressed="${s.give === c}" ${hand[c] ? '' : 'disabled'}>Give ${dot(c)} ${cap(c)} → ${s.tile === 'scan' ? 'ask' : 'get'} ${dot(o)} ${cap(o)}</button>`; }).join('')}</div>${pair.every(c => !hand[c]) ? '<p class="muted">You have neither colour, so pick another profile or protocol.</p>' : ''}</li>`);
        colourOk = !!s.give;
      } else if (s.tile === 'acquire') {
        steps.push(`<li class="${s.color ? 'done' : 'now'}">Name a colour (everyone will see it):<div class="row">${pair.map(c => `<button type="button" class="btn ccc" data-act="cc-color" data-k="${c}" aria-pressed="${s.color === c}">${dot(c)} ${cap(c)}</button>`).join('')}</div></li>`);
        colourOk = !!s.color;
      }
      if (colourOk) steps.push(s.target ? `<li class="done">Target: <b>${esc(H.nameOf(s.target))}</b></li>` : '<li class="now">Tap a team at the top to target.</li>');
      ready = colourOk && !!s.target;
    }
  }
  const go = ready ? goLabel(s) : '';
  return `<div class="cc-act"><h3>Your turn${forced ? ' · you must declare' : ''}</h3><ol class="ccsteps">${steps.join('')}</ol>
    <div class="row">${ready ? `<button type="button" class="btn primary big" data-act="cc-go">${go}</button>` : ''}
    ${t.canPass ? `<button type="button" class="btn${H.armed('ccpass') ? ' danger' : ''}" data-act="cc-pass">${H.armed('ccpass') ? 'Tap again to pass' : 'Pass (no protocol I can use)'}</button>` : ''}</div>
    ${recent(g, H.st)}</div>`;
}
function goLabel(s) {
  const who = s.target ? esc(H.nameOf(s.target)) : '';
  if (s.tile === 'declare') return `📣 Declare ${esc(pName(s.claim))}`;
  return `${TILE[s.tile].icon} ${TILE[s.tile].name} ${who}`;
}

function summaryHTML(g, st) {
  const s = g.summary;
  if (!s) return '';
  const rows = g.order.slice().sort((a, b) => g.scores[b] - g.scores[a]).map(pid => {
    const d = s.delta[pid];
    const bits = [];
    if (d.claim) bits.push(`right claim +${d.claim}`);
    if (d.back) bits.push(`right back +${d.back}`);
    const wb = s.wrongBacks.filter(x => x.pid === pid).length;
    if (wb) bits.push(`wrong back −${wb} (earlier)`);
    if (d.trace) bits.push(`traces ${d.trace > 0 ? '+' : '−'}${Math.abs(d.trace)}`);
    const tr = s.traces.filter(x => x.pid === pid).map(x => `${dot(x.color, 12)}${x.ok ? '✓' : '✗'}`).join(' ');
    return `<li>${H.avatar(pid, 30)}<span>${esc(nm(pid, st))}<br><small class="muted">${bits.join(' · ') || 'no change'} ${tr}</small></span><span class="pt">${g.scores[pid]}</span></li>`;
  }).join('');
  const head = s.found ? `The formula was <b>${esc(pName(s.right))}</b>: ${s.formula.map(cap).join(' and ')}.` : `Nobody found it. The formula was <b>${esc(pName(s.right))}</b>: ${s.formula.map(cap).join(' and ')}.`;
  if (g.phase === 'over') {
    const w = (g.winners || []).map(p => esc(nm(p, st)));
    return `<div class="cc-act"><div class="cc-winner">${w[0] === 'You' ? 'You win' : w[0] + ' wins'}!</div><p>${head}</p><ol class="cc-sum">${rows}</ol>
      <div class="row">${H.isHost()
        ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
        : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
  }
  const secs = Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000));
  return `<div class="cc-act"><h3>Round ${g.round} is over</h3><p>${head}</p>${s.tie ? '<p><b>Tied at the top!</b> Another round breaks the tie.</p>' : ''}<ol class="cc-sum">${rows}</ol>
    <p class="muted">Next round in <span id="ccNext">${secs}</span> seconds. Everyone’s samples are shown at the top.</p></div>`;
}

function logLine(e, st) {
  const me = st.you;
  const p = esc(nm(e.pid, st)), to = e.target ? esc(nmObj(e.target, st)) : '';
  const on = e.profile != null ? ` on <b>${esc(pName(e.profile))}</b>${e.color && e.profile === SAME ? ` (${cap(e.color)})` : ''}` : '';
  const sec = e.sec, active = e.pid === me, target = e.target === me;
  const pl = n => `${n} card${n === 1 ? '' : 's'}`;
  switch (e.k) {
    case 'round': return `<b>Round ${e.round}</b>: two samples sealed away, the rest dealt out. ${esc(nm(e.first, st))} start${e.first === me ? '' : 's'}.`;
    case 'cycle': return '<i>All protocols used: they come back for a new cycle.</i>';
    case 'scan': {
      let s = `🔍 ${p} scanned ${to}${on}`;
      if (sec && active) s += `: you gave ${an(sec.give)} (returned). They hold <b>${sec.answer} ${sec.ask}</b>.`;
      else if (sec && target) s += `: they passed you ${an(sec.give)} (returned). You told them you hold <b>${sec.answer} ${sec.ask}</b>.`;
      return s;
    }
    case 'transfer': {
      let s = `⇄ ${p} transferred with ${to}${on}: gave 1 card, got ${pl(e.got)}`;
      if (sec && active) s += ` (you gave ${an(sec.give)}, got ${e.got} ${sec.take})`;
      else if (sec && target) s += ` (you got ${an(sec.give)}, gave ${e.got} ${sec.take})`;
      return s;
    }
    case 'synthesize': {
      let s = `⚗ ${p} synthesized from ${to}${on}: got ${pl(e.got)}`;
      if (sec && (active || target) && sec.got.length) s += ` (${sec.got.join(' and ')})`;
      return s;
    }
    case 'acquire': return `🤲 ${p} asked ${to} for ${e.color === 'amber' ? 'an' : 'a'} <b>${esc(e.color)}</b>${e.profile != null ? ` (${esc(pName(e.profile))})` : ''}: ${e.got ? 'got one' : 'they had none'}`;
    case 'trace': return sec ? `◆ You placed a Trace marker on <b>${esc(sec.color)}</b>` : `◆ ${p} placed a Trace marker`;
    case 'skip': return `${p} passed (no protocol ${e.pid === me ? 'you' : 'they'} could use)`;
    case 'declare': return `📣 ${p} declared <b>${esc(pName(e.profile))}</b>`;
    case 'claim': return `🚩 ${p} also claimed <b>${esc(pName(e.profile))}</b>`;
    case 'back': return `🤝 ${p} backed <b>${esc(pName(e.profile))}</b>`;
    case 'pass': return `${p} passed on the declaration`;
    case 'wrong': return `✗ Wrong: ${e.claims.map(c => `${esc(nm(c.pid, st))} (${esc(pName(c.profile))}${c.type === 'back' ? ', backer −1' : ', loses marker'})`).join(', ')}`;
    case 'reveal': return `<b>The formula: ${e.formula.map(cap).join(' and ')}</b>${e.found ? '' : ' (nobody found it)'}`;
  }
  return '';
}

/* ---------- announcements ---------- */
function banner(html) { L.queue.push(html); if (!L.showing) showNext(); }
function showNext() {
  const h = L.queue.shift();
  if (!h) { L.showing = false; return; }
  L.showing = true;
  const el = document.createElement('div');
  el.className = 'cc-banner';
  el.innerHTML = h;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, 1600);
}
function fx(e) {
  const st = H.st;
  if (!st) return;
  if (e.type === 'declare') banner(`📣 DECLARE!<small>${esc(nm(e.pid, st))} claims ${esc(pName(e.profile))}</small>`);
  else if (e.type === 'wrong') banner('✗ WRONG<small>The formula is still sealed</small>');
}

Hub.registerGame('cc', {
  title: 'Countercurrent',
  settings,
  render,
  fx: e => fx(e),
  tick(st) {
    const g = st.game;
    if (!g) return;
    if (g.decl && g.decl.cur) H.setText('ccLeft', '(' + Math.max(0, Math.ceil((g.decl.ends - H.now()) / 1000)) + 's)');
    if (g.phase === 'roundEnd') H.setText('ccNext', String(Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000))));
  }
});
})();
