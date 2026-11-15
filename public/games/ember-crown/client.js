/*
 * The Ember Crown: what each player sees and clicks.
 * Rules live on the server (games/ember-crown.js). Only cards you're allowed to see are
 * ever sent to you: your own hand, face-up played cards, and what your abilities showed you.
 *
 * Card art goes in public/games/ember-crown/art/ (card-0.webp … card-9.webp, card-wraith.webp,
 * card-back.webp, plus optional crown, renown and table pictures). The server lists the files
 * it finds, so missing pictures fall back to the drawn placeholders here.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;
const WRAITH = 10;

/* The Adventurers, as printed on the reference card. */
const CARD = {
  0: { name: 'Apprentice', icon: '📜', short: 'Two others swap a card', long: 'Choose two other players. Each secretly gives one card to the other. With only two players left, this does nothing.' },
  1: { name: 'Warrior', icon: '🛡️', short: 'Take a named card', long: 'Name a number from 2 to 9. If another player holds it, they give it to you. Then you give them one card from your hand.' },
  2: { name: 'Barbarian', icon: '🪓', short: 'Hands over 10 are shown', long: 'Every other player whose hand totals more than 10 shows you their whole hand.' },
  3: { name: 'Duelist', icon: '🤺', short: 'Three hand guesses', long: 'Choose a player and make three guesses at their whole hand, one at a time. Each is answered only “right” or “wrong”.' },
  4: { name: 'Shadow Hunter', icon: '🏹', short: 'See others’ 5–9s', long: 'Look at every other player’s cards numbered 5 or higher.' },
  5: { name: 'Princess Knight', icon: '🌹', short: 'See others’ even cards', long: 'Look at every other player’s even cards (2, 4, 6, 8). Zero isn’t even.' },
  6: { name: 'Doomblade', icon: '⚔️', short: 'Others discard lowest', long: 'Every other player discards their lowest card, face up. Its ability doesn’t happen. A player with one card keeps it.' },
  7: { name: 'Spirit Caller', icon: '👻', short: 'Two 0s are knocked out', long: 'Every other player holding exactly two 0s is knocked out, and you score their hand sizes. Not on your first turn of the round.' },
  8: { name: 'Plague Doctor', icon: '🧪', short: 'Take back, bury one', long: 'Take back the other cards you’ve played and every center card. Then put one card from your hand face down in the center. You can play it as your only card.' },
  9: { name: 'Water Goddess', icon: '🌊', short: 'Alone at turn start: win', long: 'Begin your turn holding only this card and you win the round, scoring the other survivors’ hand sizes. Playing it does nothing.' },
  10: { name: 'Ember Wraith', icon: '🔥', short: 'Counts as 0 and 1', long: 'Counts as both a 0 and a 1: to name a hand holding it, say 0 and 1. Not even, not 5 or higher. Playing it does nothing. Doomblade and Spirit Caller ignore it.' }
};
const L = { sel: null, guess: [], target: null, key: '', lastHTML: '', queue: [], showing: false, seenLog: 0 };
const nm = (pid, st) => (pid === st.you ? 'You' : H.nameOf(pid));
const poss = (pid, st) => (pid === st.you ? 'your' : esc(H.nameOf(pid)) + '’s');
const label = n => (n === WRAITH ? 'W' : String(n));
const list = ns => (ns && ns.length ? ns.map(n => `<b>${label(n)}</b>`).join(' ') : 'nothing');
const art = () => ((H.catalog && H.catalog.ember) || {}).art || {};
const renownIcon = () => (art().renown ? `<img class="renown" src="${esc(art().renown)}" alt="">` : '');

/* ---------- drawing a card ---------- */
function cardHTML(n, o) {
  o = o || {};
  const cls = ['ecc'];
  if (o.size) cls.push(o.size);
  if (o.pick) cls.push('pick');
  if (o.sel) cls.push('sel');
  if (o.dim) cls.push('dim');
  const attrs = o.act ? ` data-act="${o.act}" data-k="${esc(o.k)}" role="button" tabindex="0"` : '';
  if (n === null || n === undefined) {
    const back = art()['card-back'];
    return `<span class="${cls.concat('back').join(' ')}"${attrs} aria-label="Face-down card">${back ? `<img src="${esc(back)}" alt="">` : '<span class="emb">♛</span>'}</span>`;
  }
  const c = CARD[n];
  const pic = art()[n === WRAITH ? 'card-wraith' : 'card-' + n];
  cls.push('n' + n);
  const tip = o.tip === false ? '' : ` title="${esc(`${label(n)} · ${c.name}: ${c.long}`)}"`;
  return `<span class="${cls.join(' ')}"${attrs}${tip} aria-label="${esc(`${n === WRAITH ? '10, Ember Wraith' : n + ', ' + c.name}`)}">
    ${pic ? `<img src="${esc(pic)}" alt="">` : `<span class="ico">${c.icon}</span>`}
    <span class="num">${n === WRAITH ? '10' : n}</span><span class="nm">${esc(c.name)}</span></span>`;
}

/* ---------- host settings (in the room) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.ember;
  const online = st.players.filter(p => p.connected).length;
  const seg = (act, k, on, text) => `<button type="button" data-act="${act}" data-k="${k}" aria-pressed="${on}" ${host ? '' : 'disabled'}>${text}</button>`;
  const step = (key, v, lo, hi) => `<span class="ecstep">${host ? `<button type="button" data-act="ec-set" data-k="${key}|-1" ${v <= lo ? 'disabled' : ''} aria-label="Less">−</button>` : ''}<output>${v}</output>${host ? `<button type="button" data-act="ec-set" data-k="${key}|1" ${v >= hi ? 'disabled' : ''} aria-label="More">+</button>` : ''}</span>`;
  const warn = online > 4 ? `<div class="setting"><span class="label" style="color:var(--danger)">${online} players are here. The Ember Crown is for 3 or 4.</span></div>` : '';
  return `${warn}
  <div class="setting"><span class="label">How to win<br><small class="muted" style="font-weight:400">Renown: score for every rival you expose. Last standing: just survive.</small></span>
    <div class="ecset">${seg('ec-mode', 'renown', s.mode === 'renown', 'Renown')}${seg('ec-mode', 'last', s.mode === 'last', 'Last Adventurer Standing')}</div></div>
  ${s.mode === 'renown'
    ? `<div class="setting"><span class="label">Renown to win<br><small class="muted" style="font-weight:400">Checked when a round ends. A tie at the top plays on.</small></span>${step('target', s.target, 5, 40)}</div>`
    : `<div class="setting"><span class="label">Rounds<br><small class="muted" style="font-weight:400">Most rounds survived wins. A tie plays on.</small></span>${step('rounds', s.rounds, 1, 15)}</div>`}
  <div class="setting"><span class="label">Ember Wraith (advanced)<br><small class="muted" style="font-weight:400">Adds the Wraith, which counts as 0 and 1. One random card is removed face up each round.</small></span>
    <div class="ecset">${seg('ec-wraith', 0, !s.wraith, 'Off')}${seg('ec-wraith', 1, s.wraith, 'On')}</div></div>
  ${s.wraith ? `<div class="setting"><span class="label">Wraith in a Barbarian total</span>
    <div class="ecset">${seg('ec-wtotal', 10, s.wraithTotal === 10, 'Counts 10')}${seg('ec-wtotal', 1, s.wraithTotal === 1, 'Counts 1')}</div></div>` : ''}
  <div class="setting stack"><span class="label">How to play</span>${rulesHTML(s)}</div>`;
}
function rulesHTML(s) {
  return `<ul class="ecrules">
    <li>4 cards each, 2 face down in the center. With 3 players, 4 cards are removed and shown to everyone first.${s.wraith ? ' With the Wraith, one more card is removed face up.' : ''}</li>
    <li>On your turn, do one thing: <b>scout</b> a center card (look, then swap it or put it back), <b>play</b> an Adventurer for its ability (needs 2+ cards, except the Plague Doctor), or <b>challenge</b> a rival by naming their whole hand.</li>
    <li>A right challenge knocks them out and scores their hand size, and you may challenge again. A wrong one ends your turn. ${s.wraith ? 'A Wraith is named as 0 and 1.' : ''}</li>
    <li>The round ends when one player is left${s.mode === 'renown' ? `. First to <b>${s.target}</b> renown wins (checked at the end of a round).` : `. Most rounds survived after <b>${s.rounds}</b> wins.`}</li>
  </ul>
  <ul class="ecref">${Object.keys(CARD).map(Number).filter(n => n !== WRAITH || s.wraith).map(n => `<li><b>${label(n)} · ${esc(CARD[n].name)}</b>: ${esc(CARD[n].long)}</li>`).join('')}</ul>`;
}
function setEC(patch) {
  Object.assign(H.st.settings.ember, patch);
  H.render();
  H.emit('settings', { game: 'ember', patch });
}
H.on('ec-mode', (b, k) => setEC({ mode: k }));
H.on('ec-wraith', (b, k) => setEC({ wraith: k === '1' }));
H.on('ec-wtotal', (b, k) => setEC({ wraithTotal: Number(k) }));
H.on('ec-set', (b, k) => {
  const [key, d] = k.split('|');
  const lim = { target: [5, 40], rounds: [1, 15] }[key];
  setEC({ [key]: Math.max(lim[0], Math.min(lim[1], H.st.settings.ember[key] + Number(d))) });
});

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
const g0 = () => H.st.game;
H.on('ec-hand', (b, k) => {
  const g = g0(), t = g.turn, id = Number(k), me = H.st.you;
  if (!t) return;
  if (t.step === 'apprentice') return move({ a: 'give', id });
  if (t.pid !== me) return;
  if (t.step === 'choose') { L.sel = L.sel === id ? null : id; L.target = null; return H.render(); }
  if (t.step === 'scout') return move({ a: 'swap', id });
  if (t.step === 'warrior') return move({ a: 'give', id });
  if (t.step === 'bury') return move({ a: 'bury', id });
});
H.on('ec-play', b => { b.disabled = true; const id = L.sel; L.sel = null; move({ a: 'play', id }); });
H.on('ec-scout', (b, k) => move({ a: 'scout', slot: Number(k) }));
H.on('ec-return', b => { b.disabled = true; move({ a: 'return' }); });
H.on('ec-target', (b, k) => {
  const g = g0(), t = g.turn;
  if (t.step === 'duelTarget') return move({ a: 'target', pid: k });
  if (t.step === 'pair') {
    L.pair = (L.pair || []).includes(k) ? L.pair.filter(x => x !== k) : [...(L.pair || []), k].slice(-2);
    if (L.pair.length === 2) { const pids = L.pair; L.pair = []; return move({ a: 'targets', pids }); }
    return H.render();
  }
  L.target = L.target === k ? null : k; L.guess = []; L.sel = null; H.render();
});
H.on('ec-name', (b, k) => move({ a: 'name', n: Number(k) }));
H.on('ec-add', (b, k) => { if (L.guess.length < 8) L.guess.push(Number(k)); H.render(); });
H.on('ec-unadd', (b, k) => { L.guess.splice(Number(k), 1); H.render(); });
H.on('ec-clear', () => { L.guess = []; H.render(); });
H.on('ec-guess', b => {
  const t = g0().turn, guess = L.guess.slice();
  b.disabled = true;
  L.guess = [];
  if (t.step === 'duel') return move({ a: 'guess', guess });
  const target = L.target; L.target = null;
  move({ a: 'challenge', target, guess });
});
H.on('ec-done', b => { b.disabled = true; move({ a: 'done' }); });
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ecc[data-act]')) { e.preventDefault(); e.target.click(); }
});
let resizeT = null;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (H.st && H.st.game && H.st.game.id === 'ember') { L.lastHTML = ''; H.render(); } }, 150); });

/* ---------- rendering ---------- */
function render(main, st) {
  const g = st.game, me = st.you, t = g.turn;
  H.S.built = 'ember:' + st.code;
  const mine = g.players[me];
  const playing = !!mine;
  // Throw away a half-made choice when the step changes.
  const key = t ? `${g.round}:${t.pid}:${t.step}:${t.left}:${g.log.length && g.log[g.log.length - 1].seq}` : g.phase;
  if (key !== L.key) {
    const keepTarget = t && t.step === 'chain' && L.key.split(':')[2] === 'chain';
    L.key = key; L.sel = null; L.pair = [];
    if (!keepTarget) { L.target = null; L.guess = []; }
  }
  const myTurn = t && t.pid === me;
  const step = t ? t.step : '';
  const handPick = playing && mine.alive && t && (
    (myTurn && ['choose', 'scout', 'warrior', 'bury'].includes(step)) ||
    (step === 'apprentice' && t.pair.includes(me) && !t.given.includes(me)));

  const seat = pid => {
    const P = g.players[pid], isMe = pid === me;
    let cards;
    if (isMe && P.alive && Array.isArray(P.hand) && P.hand.length && typeof P.hand[0] === 'object') {
      cards = P.hand.map(c => cardHTML(c.n, { pick: handPick, sel: L.sel === c.id, act: handPick ? 'ec-hand' : '', k: c.id })).join('');
    } else if (P.hand) cards = P.hand.map(n => cardHTML(n, { size: 'sm' })).join('') || '<span class="muted">no cards</span>';
    else cards = Array.from({ length: P.count }, () => cardHTML(null, { size: 'sm' })).join('');
    const tally = g.settings.mode === 'renown' ? `<span class="v">${renownIcon()}${g.scores[pid]}</span><small>renown</small>` : `<span class="v">${g.wins[pid]}</span><small>won</small>`;
    let status = '';
    if (!P.alive) status = 'knocked out';
    else if (t && t.pid === pid) status = isMe ? 'your turn' : 'their turn';
    else if (g.waiting.includes(pid)) status = 'choosing…';
    const played = P.played.length ? `<div class="ecplayed" aria-label="Played cards">${P.played.map(n => cardHTML(n, { size: 'xs' })).join('')}</div>` : '';
    return `<div class="ecseat${t && t.pid === pid ? ' turn' : ''}${isMe ? ' me' : ''}${P.alive ? '' : ' out'}">
      <div class="echead">${H.avatar(pid, isMe ? 34 : 28)}<span class="nm">${esc(nm(pid, st))}<small>${esc([status, P.alive && !isMe && !P.hand ? `${P.count} card${P.count === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</small></span><span class="tally">${tally}</span></div>
      <div class="echand">${cards}</div>${played}${P.alive ? '' : `<span class="ecout" aria-hidden="true">${art().eliminated ? `<img src="${esc(art().eliminated)}" alt="">` : '💀'}</span>`}</div>`;
  };

  const around = playing ? [me, ...g.order.slice(g.order.indexOf(me) + 1), ...g.order.slice(0, g.order.indexOf(me))] : g.order;
  const n = around.length, narrow = window.innerWidth < 620;
  // Round the table, you at the bottom and the others clockwise. On a phone: rivals in a row
  // on top (still clockwise, left to right), the center, then you.
  const seats = around.map((pid, i) => {
    if (narrow) return `<div class="ecspot${pid === me ? ' mine' : ''}">${seat(pid)}</div>`;
    const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
    const x = 50 + 35 * Math.cos(a), y = 50 + 34 * Math.sin(a);
    // The seats straight below and above the center hug the table's edge, so they never spill out.
    const pos = i === 0 ? 'left:50%;bottom:0' : (n === 4 && i === 2 ? 'left:50%;top:0' : `left:${x.toFixed(2)}%;top:${y.toFixed(2)}%`);
    const edge = i === 0 ? ' at-bottom' : (n === 4 && i === 2 ? ' at-top' : '');
    return `<div class="ecspot${pid === me ? ' mine' : ''}${edge}" style="${pos}">${seat(pid)}</div>`;
  });
  const mineIdx = playing ? 0 : -1;
  const scoutable = myTurn && step === 'choose';
  const center = `<div class="eccenter">
      <div class="ecpile"><div class="ecrow">${Array.from({ length: g.centerCount }, (_, i) => cardHTML(null, { pick: scoutable, act: scoutable ? 'ec-scout' : '', k: i })).join('') || '<span class="muted">empty</span>'}</div><small>Center${scoutable ? ' · tap to scout' : ''}</small></div>
      ${g.removed.length ? `<div class="ecpile"><div class="ecrow">${g.removed.map(x => cardHTML(x, { size: 'xs' })).join('')}</div><small>Removed</small></div>` : ''}
      ${g.discard.length ? `<div class="ecpile"><div class="ecrow">${g.discard.map(x => cardHTML(x, { size: 'xs' })).join('')}</div><small>Discarded</small></div>` : ''}
    </div>`;
  const roundLbl = g.settings.mode === 'renown' ? `Round ${g.round} · first to ${g.settings.target}` : `Round ${g.round} of ${g.settings.rounds}`;
  const html = `<section class="ec" aria-label="The Ember Crown">
    <div class="ec-top"><div class="ec-title">${art().crown ? `<img src="${esc(art().crown)}" alt="">` : '♛'} The Ember Crown<small>${esc(roundLbl)}${g.tiebreak ? ' · tie-break' : ''}</small></div>
      ${H.dd('ec-log', 'What happened', `<ol>${g.log.slice().reverse().map(e => logLine(e, st)).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ol>`, 'ec-log')}
      ${H.dd('ec-rules', 'How to play', rulesHTML(g.settings), 'ec-rules')}
      ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}</div>
    <div class="ec-main">${narrow
      ? `<div class="ec-stack"${art().table ? ` style="background-image:radial-gradient(ellipse at 50% 45%,rgba(140,60,20,.3),rgba(10,4,2,.6)),url('${esc(art().table)}');background-size:cover"` : ''}><div class="ec-rivals">${seats.filter((_, i) => i !== mineIdx).join('')}</div>${center}${mineIdx === 0 ? seats[0] : ''}</div>`
      : `<div class="ec-round p${n}"><div class="ec-felt" aria-hidden="true"${art().table ? ` style="background-image:radial-gradient(ellipse at 50% 42%,rgba(140,60,20,.35),rgba(20,8,4,.15) 55%,rgba(10,4,2,.7)),url('${esc(art().table)}')"` : ''}></div>${center}${seats.join('')}</div>`}
    <div class="ec-side">${playing ? '' : '<p class="muted" style="margin:0">You joined after this game started, so you’re watching this one.</p>'}
    ${actHTML(g, st)}${playing ? knowHTML(g, st) : ''}</div></div>
  </section>`;
  if (html === L.lastHTML && main.querySelector('.ec')) return;
  L.lastHTML = html;
  H.keepFocus(main, () => { main.innerHTML = html; });
}

/* The number pad for naming a whole hand. */
function guessPad(g, st, target, verb) {
  const P = g.players[target];
  const need = P.count;
  const okLen = L.guess.length === need || (g.settings.wraith && L.guess.length === need + 1);
  const chips = L.guess.map((x, i) => `<button type="button" class="ecchip" data-act="ec-unadd" data-k="${i}" aria-label="Remove ${x}">${x} ✕</button>`).join('');
  return `<div class="ecguess">
    <p class="muted">${esc(nm(target, st))} ${target === st.you ? 'have' : 'has'} <b>${need}</b> card${need === 1 ? '' : 's'}. Tap a number for each one${g.settings.wraith ? ' (name a Wraith as both 0 and 1)' : ''}.</p>
    <div class="ecpad">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(x => `<button type="button" data-act="ec-add" data-k="${x}" title="${esc(CARD[x].name)}">${x}</button>`).join('')}</div>
    <div class="row"><span class="ecchips">${chips || '<span class="muted">Your guess shows here</span>'}</span>
      ${L.guess.length ? '<button type="button" class="linkbtn" data-act="ec-clear">clear</button>' : ''}
      <button type="button" class="btn primary" data-act="ec-guess" ${okLen ? '' : 'disabled'}>${verb}</button></div></div>`;
}
function targetButtons(g, st, pids, chosen) {
  return `<div class="ectargets">${pids.map(p => `<button type="button" data-act="ec-target" data-k="${esc(p)}" aria-pressed="${(chosen || []).includes(p)}">${H.avatar(p, 28)}${esc(nm(p, st))}<small>${g.players[p].count}</small></button>`).join('')}</div>`;
}

function actHTML(g, st) {
  const me = st.you, t = g.turn;
  if (g.phase === 'roundEnd' || g.phase === 'over') return summaryHTML(g, st);
  if (!t) return '';
  const who = esc(nm(t.pid, st));
  const rivals = g.order.filter(p => p !== t.pid && g.players[p].alive);
  const mine = g.players[me];

  // Apprentice: the two chosen players each give a card, whoever's turn it is.
  if (t.step === 'apprentice') {
    if (t.pair.includes(me) && !t.given.includes(me)) {
      const other = t.pair.find(p => p !== me);
      return `<div class="ec-act"><h3>📜 Apprentice: give ${esc(nm(other, st))} a card</h3><p class="muted">Tap one of your cards. Only the two of you will know what was swapped.</p></div>`;
    }
    const left = t.pair.filter(p => !t.given.includes(p)).map(p => esc(nm(p, st)));
    return `<div class="ec-act"><h3>📜 ${esc(nm(t.pair[0], st))} and ${esc(nm(t.pair[1], st))} are swapping a card</h3><p class="muted">Waiting for ${left.join(' and ')}…</p>${recent(g, st)}</div>`;
  }

  if (t.pid !== me) {
    const doing = {
      choose: 'is deciding…', scout: 'is looking at a center card…', pair: 'is choosing two players for the Apprentice…',
      name: 'is naming a number for the Warrior…', warrior: `took a card from ${esc(nm(t.holder, st))} and is giving one back…`,
      duelTarget: 'is choosing a Duelist target…', duel: `is dueling ${esc(nm(t.target, st))} (${t.left} guess${t.left === 1 ? '' : 'es'} left)…`,
      chain: 'exposed a rival and may challenge again…', bury: 'is burying a card in the center…'
    }[t.step] || '…';
    return `<div class="ec-act"><h3>${who} ${doing}</h3>${recent(g, st)}</div>`;
  }

  switch (t.step) {
    case 'choose': {
      const hand = mine.hand || [];
      const selCard = hand.find(c => c.id === L.sel);
      let playBox = '<p class="muted">Tap one of your cards to see it and play it.</p>';
      if (selCard) {
        const c = CARD[selCard.n];
        const why = hand.length < 2 && selCard.n !== 8 ? 'You need 2 or more cards to play one (except the Plague Doctor).'
          : selCard.n === 7 && t.first ? 'Not on your first turn of the round.' : '';
        playBox = `<div class="ecpicked">${cardHTML(selCard.n, { size: 'big', tip: false })}<div><p><b>${label(selCard.n)} · ${esc(c.name)}</b>: ${esc(c.long)}</p>
          ${why ? `<p class="bad">${esc(why)}</p>` : `<button type="button" class="btn primary" data-act="ec-play">Play the ${esc(c.name)}</button>`}</div></div>`;
      }
      const tgt = L.target && g.players[L.target] && g.players[L.target].alive ? L.target : null;
      return `<div class="ec-act"><h3>Your turn. Do one thing:</h3>${recent(g, st)}
        <div class="ecopts">
          <div class="ecopt"><h4>🔎 Scout the center</h4><p class="muted">Tap a face-down center card on the table to look at it.</p></div>
          <div class="ecopt"><h4>🃏 Play an Adventurer</h4>${playBox}</div>
          <div class="ecopt"><h4>⚔️ Challenge a rival</h4><p class="muted">Name every card in their hand. Right: they’re out and you score ${tgt ? g.players[tgt].count : 'their hand size'}. Wrong: your turn ends.</p>
            ${targetButtons(g, st, rivals, tgt ? [tgt] : [])}${tgt ? guessPad(g, st, tgt, `Challenge ${esc(nm(tgt, st))}`) : ''}</div>
        </div></div>`;
    }
    case 'scout':
      return `<div class="ec-act"><h3>🔎 You’re looking at a center card</h3><div class="ecpicked">${cardHTML(t.look, { size: 'big' })}<div>
        <p>Tap one of your cards to swap it into the center, or put this one back. Everyone is told whether you swapped.</p>
        <button type="button" class="btn" data-act="ec-return">Put it back</button></div></div></div>`;
    case 'pair':
      return `<div class="ec-act"><h3>📜 Apprentice: choose two players</h3><p class="muted">Each secretly gives the other one card.</p>${targetButtons(g, st, rivals, L.pair)}</div>`;
    case 'name':
      return `<div class="ec-act"><h3>🛡️ Warrior: name a number</h3><p class="muted">If another player holds it, they give it to you, and you give them a card back.</p>
        <div class="ecpad">${[2, 3, 4, 5, 6, 7, 8, 9].map(x => `<button type="button" data-act="ec-name" data-k="${x}" title="${esc(CARD[x].name)}">${x}<small>${esc(CARD[x].name)}</small></button>`).join('')}</div></div>`;
    case 'warrior':
      return `<div class="ec-act"><h3>🛡️ You took it from ${esc(nm(t.holder, st))}!</h3><p>Now tap one of your cards to give to ${esc(nm(t.holder, st))}. It can be the one you just took.</p></div>`;
    case 'duelTarget':
      return `<div class="ec-act"><h3>🤺 Duelist: choose a rival</h3><p class="muted">You get three whole-hand guesses, each answered right or wrong.</p>${targetButtons(g, st, rivals)}</div>`;
    case 'duel': {
      const tried = g.log.filter(e => e.k === 'duelGuess' && e.round === g.round && e.pid === me && e.target === t.target && e.seq > (duelStart(g) || 0));
      return `<div class="ec-act"><h3>🤺 Duel with ${esc(nm(t.target, st))}: ${t.left} guess${t.left === 1 ? '' : 'es'} left</h3>
        ${tried.length ? `<ul class="ectried">${tried.map(e => `<li>${list(e.guess)}: ${e.right ? '<b class="good">right</b>' : '<b class="bad">wrong</b>'}</li>`).join('')}</ul>` : ''}
        ${guessPad(g, st, t.target, 'Guess')}<div class="row"><button type="button" class="linkbtn" data-act="ec-done">Stop dueling</button></div></div>`;
    }
    case 'chain': {
      const tgt = L.target && rivals.includes(L.target) ? L.target : null;
      return `<div class="ec-act"><h3>⚔️ Exposed! Challenge another rival?</h3>${recent(g, st)}
        ${targetButtons(g, st, rivals, tgt ? [tgt] : [])}${tgt ? guessPad(g, st, tgt, `Challenge ${esc(nm(tgt, st))}`) : ''}
        <div class="row"><button type="button" class="btn" data-act="ec-done">End my turn</button></div></div>`;
    }
    case 'bury':
      return `<div class="ec-act"><h3>🧪 Plague Doctor: bury a card</h3><p>Tap one of your cards to put face down in the center.</p></div>`;
  }
  return '<div class="ec-act"><h3>…</h3></div>';
}
function duelStart(g) {
  for (let i = g.log.length - 1; i >= 0; i--) if (g.log[i].k === 'play' && g.log[i].n === 3) return g.log[i].seq;
  return 0;
}
function recent(g, st) {
  const last = g.log.filter(e => e.round === g.round).slice(-3).reverse().map(e => logLine(e, st)).filter(Boolean);
  return last.length ? `<div class="ec-recent">${last.map(x => `<div>${x}</div>`).join('')}</div>` : '';
}

/* Everything you've learned this round that others haven't. */
function knowHTML(g, st) {
  const lines = g.log.filter(e => e.round === g.round && e.mine).map(e => logLine(e, st, true)).filter(Boolean);
  const pub = g.log.filter(e => e.round === g.round && ['duelGuess', 'challenge'].includes(e.k) && !e.right).map(e => logLine(e, st)).filter(Boolean);
  return `<div class="ec-know"><h3>🕯️ What you know this round</h3>
    ${lines.length ? `<ul>${lines.slice().reverse().map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="muted">Nothing secret yet. Scouting and abilities add to this list.</p>'}
    ${pub.length ? `<h4>Wrong guesses so far</h4><ul class="muted">${pub.slice().reverse().map(x => `<li>${x}</li>`).join('')}</ul>` : ''}</div>`;
}

function summaryHTML(g, st) {
  const s = g.summary || {};
  const tally = g.settings.mode === 'renown' ? g.scores : g.wins;
  const ranked = g.order.slice().sort((a, b) => tally[b] - tally[a]);
  const rows = ranked.map(pid => `<li>${H.avatar(pid, 30)}<span>${esc(nm(pid, st))}<br><small class="muted">${s.hands ? `held ${list(s.hands[pid])}` : ''}</small></span><span class="pt"><span class="v">${g.settings.mode === 'renown' ? renownIcon() : ''}${tally[pid]}</span><small>${g.settings.mode === 'renown' ? 'renown' : 'won'}</small></span></li>`).join('');
  const why = s.why === 'goddess' ? `🌊 ${esc(nm(s.winner, st))} began a turn holding only the Water Goddess${s.pts ? ` (+${s.pts})` : ''}.`
    : s.winner ? `${esc(nm(s.winner, st))} ${s.winner === st.you ? 'are' : 'is'} the last adventurer standing.` : '';
  const center = s.center && s.center.length ? ` The center held ${list(s.center)}.` : '';
  if (g.phase === 'over') {
    const w = (g.winners || []).map(p => nm(p, st));
    return `<div class="ec-act"><div class="ec-winner">♛ ${esc(w[0] === 'You' ? 'You claim' : w[0] + ' claims')} the Ember Crown!</div>
      <p class="muted">${why}${center}</p><ol class="ec-sum">${rows}</ol>
      <div class="row">${H.isHost()
        ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
        : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
  }
  const secs = Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000));
  return `<div class="ec-act"><h3>Round ${g.round} is over</h3><p class="muted">${why}${center}</p><ol class="ec-sum">${rows}</ol>
    <p class="muted">${g.tiebreak ? 'It’s a tie at the top, so play goes on. ' : ''}Next round in <span id="ecNext">${secs}</span> seconds. ${esc(nm(s.winner || g.order[0], st))} start${s.winner === st.you ? '' : 's'}.</p></div>`;
}

/* One line of the story. `privateOnly` is for the "What you know" list. */
function logLine(e, st, privateOnly) {
  const p = esc(nm(e.pid, st)), m = e.mine;
  const P = pid => esc(nm(pid, st));
  if (privateOnly && !m) return '';
  switch (e.k) {
    case 'round': return `<b>Round ${e.n}</b>${e.removed && e.removed.length ? `: removed ${list(e.removed)}` : ''}`;
    case 'scout':
      if (m) return privateOnly ? `Center card: you saw ${list([m.saw])}${e.swapped ? ` and swapped in your ${list([m.gave])}` : ' and put it back'}`
        : `🔎 You scouted ${list([m.saw])}${e.swapped ? ` and swapped in your ${list([m.gave])}` : ' and put it back'}`;
      return `🔎 ${p} scouted the center and ${e.swapped ? '<b>swapped</b>' : 'didn’t swap'}`;
    case 'play': return `🃏 ${p} played ${list([e.n])} ${esc(CARD[e.n].name)}`;
    case 'fizzle': return `${p}’s ${esc(CARD[e.n].name)} had no effect`;
    case 'pair': return `📜 ${p} chose ${P(e.a)} and ${P(e.b)} to swap a card`;
    case 'swapped': {
      if (m && m[st.you]) return `📜 You gave ${P(st.you === e.a ? e.b : e.a)} your ${list([m[st.you].gave])} and got ${list([m[st.you].got])}`;
      return privateOnly ? '' : `📜 ${P(e.a)} and ${P(e.b)} swapped a card`;
    }
    case 'warrior': return `🛡️ ${p} named <b>${e.n}</b>: ${e.holder ? `${P(e.holder)} had it` : 'nobody had it'}`;
    case 'warriorGive':
      if (m) return e.pid === st.you ? `🛡️ You gave ${P(e.holder)} your ${list([m.n])}` : `🛡️ ${p} gave you ${list([m.n])}`;
      return privateOnly ? '' : `🛡️ ${p} gave ${P(e.holder)} a card back`;
    case 'barbarian':
      if (m) return e.shown.length ? `🪓 Barbarian: ${e.shown.map(x => `${P(x)} holds ${list(m.hands[x])}`).join('; ')}` : '🪓 Barbarian: nobody’s hand is over 10';
      return `🪓 ${e.shown.length ? `${e.shown.map(P).join(' and ')} had to show ${P(e.pid)} their hand` : 'Nobody’s hand was over 10'}`;
    case 'hunter': case 'knight': {
      const what = e.k === 'hunter' ? '5 or higher' : 'even';
      if (m) return `${e.k === 'hunter' ? '🏹' : '🌹'} Cards ${what}: ${Object.keys(m.hands).map(x => `${P(x)} ${list(m.hands[x])}`).join('; ')}`;
      return `${e.k === 'hunter' ? '🏹' : '🌹'} ${p} looked at everyone’s ${what} cards`;
    }
    case 'doom': {
      const ks = Object.keys(e.lost);
      return `⚔️ Doomblade: ${ks.length ? ks.map(x => `${P(x)} discarded ${list([e.lost[x]])}`).join(', ') : 'nobody discarded'}`;
    }
    case 'spirit': return `👻 ${p}’s Spirit Caller ${e.hit.length ? `struck ${e.hit.map(P).join(' and ')}` : 'found no one with two 0s'}`;
    case 'plague':
      if (m) return `🧪 Plague Doctor: you took back ${list(e.back)} and center cards ${list(m.got)}`;
      return `🧪 ${p} took back ${e.back.length ? list(e.back) : 'no played cards'} and ${e.center} center card${e.center === 1 ? '' : 's'}`;
    case 'bury': return m ? `🧪 You buried your ${list([m.n])} in the center` : (privateOnly ? '' : `🧪 ${p} buried a card in the center`);
    case 'noBury': return `🧪 ${p} kept their only card`;
    case 'duelGuess': return `🤺 ${p} guessed ${P(e.target)}${e.target === st.you ? 'r' : '’s'} hand is ${list(e.guess)}: ${e.right ? '<b class="good">right</b>' : '<b class="bad">wrong</b>'}`;
    case 'duelStop': return '';
    case 'challenge': return `⚔️ ${p} challenged ${P(e.target)}: ${list(e.guess)}, ${e.right ? '<b class="good">right!</b>' : '<b class="bad">wrong</b>'}`;
    case 'out': return `💀 ${P(e.pid)} ${e.pid === st.you ? 'are' : 'is'} out, holding ${list(e.hand)}`;
    case 'score': return `♛ ${p} +${e.pts} renown`;
    case 'goddess': return `🌊 ${p} revealed the Water Goddess and won the round${e.pts ? ` (+${e.pts})` : ''}`;
    case 'roundEnd': return `<b>Round ${e.n} over</b>`;
  }
  return '';
}

/* ---------- announcements and sounds ---------- */
function banner(html) {
  L.queue.push(html);
  if (!L.showing) showNext();
}
function showNext() {
  const h = L.queue.shift();
  if (!h) { L.showing = false; return; }
  L.showing = true;
  const el = document.createElement('div');
  el.className = 'ec-banner';
  el.innerHTML = h;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, 1700);
}
/* A short tone made in the browser, until recorded sounds are added. */
function tone(freqs) {
  try {
    const ctx = L.audio || (L.audio = new (window.AudioContext || window.webkitAudioContext)());
    const t0 = ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, t0 + i * 0.09);
      gn.gain.exponentialRampToValueAtTime(0.15, t0 + i * 0.09 + 0.02);
      gn.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.09 + 0.35);
      o.connect(gn).connect(ctx.destination);
      o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.4);
    });
  } catch (e) { /* no sound */ }
}
const TONES = { 'play-card': [523], scout: [392, 440], 'challenge-wrong': [220, 180], eliminated: [330, 247, 165], 'water-goddess': [523, 659, 784, 1047], 'round-end': [440, 554, 659], 'game-win': [523, 659, 784, 1047, 1319] };
function sound(name) {
  const src = (((H.catalog || {}).ember || {}).sounds || {})[name];
  if (!src) return tone(TONES[name] || [440]);
  try { const a = new Audio(src); a.play().catch(() => tone(TONES[name] || [440])); } catch (e) { tone(TONES[name] || [440]); }
}
function fx(e) {
  const st = H.st;
  if (!st) return;
  if (e.type === 'play') sound('play-card');
  else if (e.type === 'scout') sound('scout');
  else if (e.type === 'challenge' && !e.right) sound('challenge-wrong');
  else if (e.type === 'out') {
    sound('eliminated');
    banner(`💀 ${e.how === 'spirit' ? 'SPIRIT CALLED' : 'EXPOSED'}<small>${esc(nm(e.pid, st))} ${e.pid === st.you ? 'are' : 'is'} out${e.by ? ` · ${esc(nm(e.by, st))} ${e.by === st.you ? 'score' : 'scores'}` : ''}</small>`);
  } else if (e.type === 'goddess') {
    sound('water-goddess');
    banner(`🌊 THE WATER GODDESS<small>${esc(nm(e.pid, st))} ${e.pid === st.you ? 'win' : 'wins'} the round</small>`);
  }
}

let lastPhase = '';
Hub.registerGame('ember', {
  title: 'The Ember Crown',
  settings,
  render,
  fx: e => fx(e),
  tick(st) {
    const g = st.game;
    if (!g) return;
    if (g.phase !== lastPhase) {
      if (g.phase === 'roundEnd' && lastPhase) sound('round-end');
      if (g.phase === 'over' && lastPhase) sound('game-win');
      lastPhase = g.phase;
    }
    if (g.phase === 'roundEnd') H.setText('ecNext', String(Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000))));
  }
});
})();
