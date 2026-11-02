/*
 * The Fifth Element: what each player sees and clicks.
 * Rules and scoring live on the server (games/fifth-element.js). Card counts are
 * never shown as numbers during the game, only as the thickness of each pile.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;
const L = { built: '', cardKey: '', pickedSeq: -1, pending: false, wrong: null };

function theme(id) {
  const ts = H.catalog.fifth.themes || [];
  return ts.find(t => t.id === id) || ts[0] || { items: [] };
}
/* One item drawn in a given color. */
function ico(item, color, style) {
  if (!item) return '';
  return `<span class="ico" style="--c:${esc(color)};--src:url('${esc(item.src)}');${style || ''}"></span>`;
}
const perCard = deck => Math.min(6, 200 / Math.max(1, deck)); // pile height in px for each card
const pileH = (n, deck) => Math.min(150, Math.max(n > 0 ? 5 : 0, n * perCard(deck)));

/* ---------- room settings (shown in the game picker) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.fifth || {};
  const sizes = H.catalog.fifth.deckSizes || [];
  const themes = H.catalog.fifth.themes || [];
  const t = theme(s.theme);
  const it = t.items;
  const ex = it.length === 5 ? {
    one: `<span class="ex">${ico(it[0], it[0].color)}${ico(it[1], it[3].color)}</span>`,
    two: `<span class="ex">${ico(it[0], it[3].color)}${ico(it[1], it[4].color)}</span>`
  } : null;
  return `
  <div class="setting"><span class="label" id="feDeckLbl">Cards in the deck</span>
    <div class="seg" role="group" aria-labelledby="feDeckLbl">${sizes.map(n => `<button type="button" data-act="fe-deck" data-k="${n}" aria-pressed="${s.deck === n}" ${host ? '' : 'disabled'}>${n}</button>`).join('')}</div></div>
  <div class="setting stack"><span class="label">Item set</span>
    <div class="themes">${themes.map(th => `<button type="button" class="theme" data-act="fe-theme" data-k="${esc(th.id)}" aria-pressed="${s.theme === th.id}" ${host ? '' : 'disabled'}>
      <strong>${esc(th.name)}</strong><span class="row">${th.items.map(x => ico(x, x.color)).join('')}</span></button>`).join('')}</div></div>
  <div class="setting stack"><span class="label">How to play</span>
    <ul class="rules">
      <li>Each card shows two items. Be the first to click the right one of the five items below the card.</li>
      ${ex ? `<li>If an item on the card is in its own color, click that item. ${esc(it[0].colorName || '')} ${esc(it[0].name)} + ${esc(it[3].colorName || '')} ${esc(it[1].name)} → <b>${esc(it[0].name)}</b>.</li>
      <li>If both items are in the wrong color, cross out the two items and the two colors on the card. Click the one item that’s left. ${esc(it[3].colorName || '')} ${esc(it[0].name)} + ${esc(it[4].colorName || '')} ${esc(it[1].name)} → <b>${esc(it[2].name)}</b>.</li>` : ''}
      <li>The fastest correct click wins the card. A wrong click burns one of your cards and locks you out until the next card.</li>
      <li>If nobody gets it, the card carries over and the next winner takes both.</li>
      <li>Piles show how many cards you have, but nobody sees the numbers until the end. Most cards wins; a tie goes to sudden death.</li>
    </ul></div>`;
}
H.on('fe-deck', (b, k) => { const st = H.st; st.settings.fifth.deck = Number(k); H.render(); H.emit('settings', { game: 'fifth', patch: { deck: Number(k) } }); });
H.on('fe-theme', (b, k) => { const st = H.st; st.settings.fifth.theme = k; H.render(); H.emit('settings', { game: 'fifth', patch: { theme: k } }); });

/* ---------- picking an item ---------- */
async function pick(item) {
  const st = H.st, g = st && st.game;
  if (!g || g.phase !== 'card' || L.pending || L.pickedSeq === g.seq) return;
  if (g.locked.includes(st.you) || (g.sudden && !g.sudden.includes(st.you))) return;
  L.pickedSeq = g.seq;
  L.pending = true;
  const seq = g.seq;
  updateItems(st, g);
  const r = await H.emit('pick', { seq, item });
  L.pending = false;
  if (r.ok && !r.correct) {
    L.wrong = { seq, item };
  } else if (!r.ok) {
    // Too late (someone else got it) or not allowed: let them try again if the card is still up.
    if (H.st && H.st.game && H.st.game.seq === seq && !r.late) L.pickedSeq = -1;
    if (r.error) H.toast(r.error);
  }
  if (H.st && H.st.game) update(H.st, H.st.game);
}
// pointerdown answers a few milliseconds sooner than click, which matters in a speed game.
document.addEventListener('pointerdown', e => {
  const b = e.target.closest('.fe-item');
  if (!b || e.button > 0) return;
  e.preventDefault();
  pick(Number(b.dataset.k));
});
H.on('fe-pick', (b, k) => pick(Number(k)));
document.addEventListener('keydown', e => {
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const st = H.st;
  if (!st || !st.game || st.game.id !== 'fifth') return;
  const n = Number(e.key);
  if (n >= 1 && n <= 5) { e.preventDefault(); pick(n - 1); }
});

/* ---------- rendering ---------- */
function render(main, st) {
  const g = st.game;
  if (g.phase === 'final') return renderFinal(main, st, g);
  const t = theme(g.theme);
  const key = 'fe:' + st.code + ':' + g.theme;
  if (H.S.built !== key || !document.getElementById('feSeats')) {
    H.S.built = key;
    L.cardKey = '';
    main.innerHTML = `
    <section class="fe" aria-label="The Fifth Element">
      <div class="fe-top">
        <div class="fe-title">The Fifth Element</div>
        <div class="fe-left"><span class="deckpile" id="feDeck"></span><span id="feLeft"></span></div>
        <span id="feHostCtl"></span>
      </div>
      <div class="fe-seats" id="feSeats"></div>
      <div class="fe-stage">
        <div class="fe-cardwrap" id="feCardWrap"></div>
        <div class="fe-msg" id="feMsg" aria-live="polite"></div>
      </div>
      <div class="fe-items" id="feItems">${t.items.map((it, i) =>
        `<button type="button" class="fe-item" data-act="fe-pick" data-k="${i}" aria-label="${esc(it.name)}"><kbd>${i + 1}</kbd>${ico(it, it.color)}<span class="iname">${esc(it.name)}</span></button>`).join('')}</div>
      <details class="fe-how"><summary>How to play</summary>
        <ul>
          <li>An item on the card in its <b>own color</b>? Click that item.</li>
          <li>Both items in the <b>wrong color</b>? Cross out the two items and the two colors on the card. Click the item that’s left.</li>
          <li>A wrong click burns one of your cards and locks you out until the next card. On a computer, keys 1–5 work too.</li>
        </ul>
      </details>
    </section>`;
  }
  update(st, g);
}

function update(st, g) {
  const t = theme(g.theme);
  const host = H.isHost();
  // cards left in the deck
  H.setText('feLeft', g.sudden ? 'Sudden death' : (g.left > 0 ? 'Deck' : 'Last card'));
  const deckEl = document.getElementById('feDeck');
  if (deckEl) deckEl.style.setProperty('--dh', Math.max(2, Math.round(26 * g.left / Math.max(1, g.deckSize))) + 'px');
  const ctl = document.getElementById('feHostCtl');
  if (ctl) ctl.innerHTML = host ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : '';
  updateSeats(st, g);
  updateCard(st, g, t);
  updateItems(st, g);
  updateMsg(st, g, t);
}

/* Seats are updated in place, so piles grow and shrink smoothly. */
function updateSeats(st, g) {
  const box = document.getElementById('feSeats');
  if (!box) return;
  const ids = st.players.map(p => p.pid);
  const max = Math.max(0, ...ids.map(pid => g.piles[pid] || 0));
  box.style.setProperty('--pbh', Math.max(40, pileH(max, g.deckSize) + 4) + 'px');
  const have = new Map([...box.children].map(el => [el.dataset.pid, el]));
  ids.forEach((pid, i) => {
    let el = have.get(pid);
    if (!el) {
      el = document.createElement('div');
      el.className = 'seat';
      el.dataset.pid = pid;
      el.innerHTML = '<div class="pilebox"><div class="pile"></div></div><span class="avslot"></span><span class="sname"></span>';
    }
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    have.delete(pid);
    const n = g.piles[pid] || 0;
    const pile = el.querySelector('.pile');
    pile.style.height = pileH(n, g.deckSize) + 'px';
    pile.classList.toggle('empty', n === 0);
    const av = H.avatar(pid, 44);
    const slot = el.querySelector('.avslot');
    if (slot.dataset.html !== av) { slot.innerHTML = av; slot.dataset.html = av; }
    const p = H.player(pid);
    const nm = (p ? p.name : '') + (pid === st.you ? ' (you)' : '');
    if (el.querySelector('.sname').textContent !== nm) el.querySelector('.sname').textContent = nm;
    el.classList.toggle('locked', g.phase === 'card' && g.locked.includes(pid));
    el.classList.toggle('duel', !!g.sudden && g.sudden.includes(pid));
    el.classList.toggle('benched', !!g.sudden && !g.sudden.includes(pid));
  });
  for (const el of have.values()) el.remove();
}

function updateCard(st, g, t) {
  const wrap = document.getElementById('feCardWrap');
  if (!wrap) return;
  const key = g.phase + ':' + g.seq + ':' + (g.card ? 'f' : 'b');
  if (L.cardKey === key) return;
  L.cardKey = key;
  if (g.card) {
    wrap.innerHTML = `<div class="fe-card face${g.phase === 'result' ? ' done' : ''}" id="feCard">${g.card.shows.map(s =>
      `<span class="slot">${ico(t.items[s.item], t.items[s.color].color, `transform:rotate(${Number(s.rot) || 0}deg) scale(${(Number(s.size) || 100) / 100})`)}</span>`).join('')}</div>`;
  } else if (g.phase === 'ready' && g.seq > 0) {
    // Between cards: a ring fills up, so everyone can see exactly when the next card lands.
    wrap.innerHTML = `<div class="fe-card back" id="feCard"><svg class="fe-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="bg" cx="50" cy="50" r="${RING_R}"/><circle class="fg" id="feRing" cx="50" cy="50" r="${RING_R}"/></svg><span class="sigil small">✦</span></div>`;
    const ring = document.getElementById('feRing');
    const total = Math.max(1, g.revealAt - g.readyAt);
    const left = Math.max(0, Math.min(total, g.revealAt - H.now()));
    ring.style.strokeDasharray = RING_C;
    ring.animate([{ strokeDashoffset: RING_C * left / total }, { strokeDashoffset: 0 }], { duration: left, easing: 'linear', fill: 'forwards' });
  } else {
    wrap.innerHTML = `<div class="fe-card back wait" id="feCard"><span class="sigil" id="feSigil">✦</span></div>`;
  }
}
const RING_R = 34, RING_C = 2 * Math.PI * RING_R;

function canPick(st, g) {
  return g.phase === 'card' && !g.locked.includes(st.you) && !(g.sudden && !g.sudden.includes(st.you)) && L.pickedSeq !== g.seq && !L.pending;
}
function updateItems(st, g) {
  const live = canPick(st, g);
  const lockedOut = g.phase === 'card' && (g.locked.includes(st.you) || (g.sudden && !g.sudden.includes(st.you)));
  document.querySelectorAll('.fe-item').forEach(b => {
    const i = Number(b.dataset.k);
    b.classList.toggle('live', live);
    b.classList.toggle('idle', !live && !lockedOut);
    b.classList.toggle('off', lockedOut && !(L.wrong && L.wrong.seq === g.seq && L.wrong.item === i));
    b.classList.toggle('wrong', !!(L.wrong && L.wrong.seq === g.seq && L.wrong.item === i && g.phase === 'card'));
    b.classList.toggle('answer', g.phase === 'result' && g.result && g.result.answer === i);
    b.setAttribute('aria-disabled', String(!live));
  });
}

function updateMsg(st, g, t) {
  const el = document.getElementById('feMsg');
  if (!el) return;
  const left = Math.max(0, g.revealAt - H.now());
  const names = pids => pids.map(pid => esc(pid === st.you ? 'You' : H.nameOf(pid)));
  let html = '';
  const sigil = document.getElementById('feSigil');
  if (g.phase === 'sudden') {
    html = `<span class="gold">Sudden death!</span><small>${names(g.sudden).join(' vs ')} · first correct click wins the game</small>`;
    if (sigil) sigil.textContent = left > 0 ? String(Math.ceil(left / 1000)) : '✦';
  } else if (g.phase === 'ready') {
    if (g.seq === 0) {
      html = 'Get ready…<small>Watch the card. Fastest correct click wins it.</small>';
      if (sigil) sigil.textContent = left > 0 ? String(Math.ceil(left / 1000)) : '✦';
    } else {
      html = (g.pot > 0 ? `<span class="gold">Next card…</span><small>Cards from the last one carry over to whoever wins it</small>` : 'Next card…<small>&nbsp;</small>');
      if (sigil) sigil.textContent = '✦';
    }
  } else if (g.phase === 'card') {
    const worth = g.pot > 1 ? `<small class="gold">Worth ${g.pot} cards!</small>` : '<small>&nbsp;</small>';
    if (g.sudden && !g.sudden.includes(st.you)) html = `Sudden death<small>Only ${names(g.sudden).join(' and ')} can grab this one</small>`;
    else if (g.locked.includes(st.you)) html = `<span class="bad">Wrong! Your pile burns.</span><small>You’re locked out until the next card</small>`;
    else html = 'Grab it!' + worth;
  } else if (g.phase === 'result' && g.result) {
    const r = g.result;
    const ans = t.items[r.answer] ? esc(t.items[r.answer].name) : '';
    if (r.winner) {
      const who = r.winner === st.you ? 'You' : esc(H.nameOf(r.winner));
      const extra = r.cards > 1 ? ` · ${r.cards} cards` : '';
      html = `<span class="${r.winner === st.you ? 'good' : ''}">${who} grabbed the ${ans}!</span><small>${(r.ms / 1000).toFixed(2)}s${extra}</small>`;
    } else if (r.lost) {
      html = `Nobody got it. It was the ${ans}.<small>That was the last card, so it’s discarded</small>`;
    } else {
      html = `Nobody got it. It was the ${ans}.<small class="gold">The card carries over to the next winner</small>`;
    }
  }
  if (el.innerHTML !== html) el.innerHTML = html;
}

/* ---------- effects ---------- */
function seatOf(pid) { return document.querySelector(`.seat[data-pid="${CSS.escape(pid)}"]`); }
function fx(e, g) {
  if (e.type === 'win') {
    const card = document.getElementById('feCard');
    const seat = seatOf(e.pid);
    if (!card || !seat) return;
    const from = card.getBoundingClientRect();
    const to = seat.querySelector('.pile').getBoundingClientRect();
    const fly = card.cloneNode(true);
    fly.removeAttribute('id');
    fly.className = 'fe-fly fe-card face';
    Object.assign(fly.style, { inset: 'auto', position: 'fixed', left: from.left + 'px', top: from.top + 'px', width: from.width + 'px', height: from.height + 'px' });
    document.body.appendChild(fly);
    const sx = 42 / from.width, dx = to.left + to.width / 2 - 21 - from.left, dy = to.top - 10 - from.top;
    const anim = fly.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(${sx},${12 / from.height})`, opacity: 0.85 }
    ], { duration: 520, delay: 650, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' });
    anim.onfinish = () => { fly.remove(); seat.classList.remove('gain'); void seat.offsetWidth; seat.classList.add('gain'); };
    setTimeout(() => fly.remove(), 2000);
  } else if (e.type === 'burn') {
    const st = H.st;
    const seat = seatOf(e.pid);
    if (seat) {
      seat.classList.remove('shake'); void seat.offsetWidth; seat.classList.add('shake');
      const r = seat.querySelector('.pile').getBoundingClientRect();
      for (let i = 0; i < e.n; i++) {
        const b = document.createElement('div');
        b.className = 'fe-burn';
        b.style.left = (r.left + r.width / 2) + 'px';
        b.style.top = (r.top + i * 4) + 'px';
        b.style.setProperty('--dx', (i ? 16 : -14) + 'px');
        b.style.setProperty('--rot', (i ? 35 : -30) + 'deg');
        b.style.animationDelay = (i * 120) + 'ms';
        document.body.appendChild(b);
        setTimeout(() => b.remove(), 1400);
      }
      const m = document.createElement('div');
      m.className = 'fe-ember';
      m.textContent = e.n ? '🔥' : '✕';
      m.style.left = (r.left + r.width / 2) + 'px';
      m.style.top = (r.top - 24) + 'px';
      document.body.appendChild(m);
      setTimeout(() => m.remove(), 1200);
    }
    if (st && e.pid === st.you) { L.wrong = { seq: g.seq, item: e.item }; updateItems(st, g); }
  }
}

/* ---------- final scores ---------- */
function renderFinal(main, st, g) {
  H.S.built = 'fe-final:' + st.code;
  L.cardKey = '';
  const ids = Object.keys(g.piles).filter(pid => H.player(pid));
  ids.sort((a, b) => (b === g.winner) - (a === g.winner) || (g.piles[b] || 0) - (g.piles[a] || 0));
  const top = g.winner;
  const headline = top ? `${esc(top === st.you ? 'You win' : H.nameOf(top) + ' wins')}!` : 'Nobody won this time';
  let place = 0, prev = null;
  const rows = ids.map((pid, i) => {
    const n = g.piles[pid] || 0;
    if (pid === top) { place = 1; prev = null; }
    else if (n !== prev) { place = i + 1; prev = n; }
    const sub = g.sudden && g.sudden.includes(pid) ? (pid === top ? ' <small>won sudden death</small>' : ' <small>lost sudden death</small>') : '';
    return `<li><span class="place">${place}</span>${H.avatar(pid, 40)}<span class="rname">${esc(H.nameOf(pid))}${pid === st.you ? ' <small>(you)</small>' : ''}${sub}</span>
      <span class="rcount"><span class="mini" style="height:${Math.max(3, Math.min(60, n * perCard(g.deckSize) * 0.8))}px"></span>${n}</span></li>`;
  }).join('');
  H.keepFocus(main, () => {
    main.innerHTML = `<section class="fe fe-final" aria-label="Final scores">
      <div class="fe-top"><div class="fe-title">The Fifth Element</div></div>
      <div><div class="eyebrow muted">Final piles · ${g.deckSize} cards · ${g.burned} burned</div><div class="fe-winner">${headline}</div></div>
      <ol class="fe-rank">${rows}</ol>
      <div class="fe-actions">${H.isHost()
        ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
        : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div>
    </section>`;
  });
}

Hub.registerGame('fifth', {
  title: 'The Fifth Element',
  settings,
  render,
  fx: (e, g) => fx(e, g),
  tick(st) {
    const g = st.game;
    if (g && g.phase !== 'final' && document.getElementById('feMsg')) updateMsg(st, g, theme(g.theme));
  }
});
})();
