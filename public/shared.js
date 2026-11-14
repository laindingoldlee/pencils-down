/*
 * Shared by the party room (hub.js) and the Pencils Down page:
 *  - a sound on/off switch remembered by this browser,
 *  - a soft chime and a flashing tab title when it's your turn while you're looking elsewhere,
 *  - keeping the phone screen awake during a game,
 *  - the emote bar and emotes floating above players' avatars.
 */
window.Shared = (() => {
'use strict';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};

/* ---------- sound ---------- */
let soundOn = store.get('gn.sound') !== 'off';
let actx = null;
function audio() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
  } catch (e) { actx = null; }
  return actx;
}
// Browsers only allow sound after the player has touched the page once.
document.addEventListener('pointerdown', () => audio(), { once: true, capture: true });
function soundButtonHTML() {
  return `<button type="button" class="soundbtn" data-act="sound-toggle" aria-pressed="${soundOn}" title="${soundOn ? 'Sound on: click to mute' : 'Sound off: click to turn on'}" aria-label="${soundOn ? 'Mute sound' : 'Turn sound on'}">${soundOn ? '🔊' : '🔇'}</button>`;
}
function setSound(on) {
  soundOn = !!on;
  store.set('gn.sound', soundOn ? 'on' : 'off');
  document.querySelectorAll('[data-act="sound-toggle"]').forEach(b => { b.outerHTML = soundButtonHTML(); });
  if (soundOn) chime();
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-act="sound-toggle"]');
  if (b) setSound(!soundOn);
});
/* Two soft rising notes. */
function chime() {
  if (!soundOn) return;
  const ctx = audio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  [[660, 0], [880, 0.14]].forEach(([f, d]) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + d);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.45);
    o.connect(g).connect(ctx.destination);
    o.start(t0 + d); o.stop(t0 + d + 0.5);
  });
}

/* ---------- "your turn" while you're looking elsewhere ---------- */
let flashTimer = null, savedTitle = '';
const lookingAway = () => document.hidden || !document.hasFocus();
function stopFlash() {
  if (!flashTimer) return;
  clearInterval(flashTimer); flashTimer = null;
  document.title = savedTitle;
}
/* Call when it becomes this player's move. Only does something if they're in another tab or app. */
function attention(msg) {
  if (!lookingAway()) return false;
  chime();
  stopFlash();
  savedTitle = document.title.replace(/^🔔 .*? · /, '');
  let on = false;
  flashTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${msg} · ${savedTitle}` : savedTitle;
  }, 1000);
  document.title = `🔔 ${msg} · ${savedTitle}`;
  return true;
}
window.addEventListener('focus', stopFlash);
document.addEventListener('visibilitychange', () => { if (!document.hidden) stopFlash(); });

/* ---------- keep the screen awake during a game ---------- */
let wakeWanted = false, wake = null;
async function keepAwake(on) {
  wakeWanted = !!on;
  if (!('wakeLock' in navigator)) return;
  if (wakeWanted && !wake && document.visibilityState === 'visible') {
    try {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    } catch (e) { wake = null; }
  } else if (!wakeWanted && wake) {
    try { await wake.release(); } catch (e) {}
    wake = null;
  }
}
// The lock is dropped whenever the page is hidden; take it again on return.
document.addEventListener('visibilitychange', () => { if (wakeWanted && document.visibilityState === 'visible') keepAwake(true); });

/* ---------- emotes ---------- */
const E = { list: [], send: null, at: 0, closeT: null };
const $ = id => document.getElementById(id);
function face(e) { return e.src ? `<img src="${esc(e.src)}" alt="">` : esc(e.emoji || '🙂'); }
function ensureBar() {
  if (!$('emotebar')) {
    document.body.insertAdjacentHTML('beforeend', `<nav class="emotebar" id="emotebar" aria-label="Emotes" hidden><button type="button" class="etoggle" id="emoteToggle" data-act="emote-toggle" aria-expanded="false" aria-controls="emoteIn">Emotes</button><div class="in" id="emoteIn"></div></nav>`);
  }
  if (!$('emotelayer')) document.body.insertAdjacentHTML('beforeend', '<div class="emotelayer" id="emotelayer" aria-hidden="true"></div>');
}
function setEmotes(list) {
  E.list = Array.isArray(list) ? list : [];
  ensureBar();
  $('emoteIn').innerHTML = E.list.map(e =>
    `<button type="button" data-act="emote-send" data-k="${esc(e.id)}" aria-label="${esc(e.label)}" data-label="${esc(e.label)}">${face(e)}<span class="elbl">${esc(e.label)}</span></button>`).join('');
  const first = E.list[0];
  $('emoteToggle').innerHTML = `${first ? face(first) : ''}<span>Emotes</span>`;
}
function showBar(on) {
  ensureBar();
  const show = !!on && E.list.length > 0;
  $('emotebar').hidden = !show;
  document.body.classList.toggle('inroom', show);
}
function closeGrid() {
  clearTimeout(E.closeT);
  const bar = $('emotebar');
  if (!bar) return;
  bar.classList.remove('open');
  $('emoteToggle').setAttribute('aria-expanded', 'false');
}
function sendEmote(id) {
  // On phones the grid closes a few seconds after your last emote, so it never sits over the game.
  clearTimeout(E.closeT);
  E.closeT = setTimeout(closeGrid, 3000);
  const t = Date.now();
  if (t - E.at < 650 || !E.send) return;
  E.at = t;
  const btns = $('emoteIn').querySelectorAll('button');
  btns.forEach(b => b.classList.add('cool'));
  setTimeout(() => btns.forEach(b => b.classList.remove('cool')), 650);
  E.send(id);
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('#emotebar [data-act]');
  if (!b) return;
  if (b.dataset.act === 'emote-send') sendEmote(b.dataset.k);
  if (b.dataset.act === 'emote-toggle') {
    const open = !$('emotebar').classList.contains('open');
    $('emotebar').classList.toggle('open', open);
    b.setAttribute('aria-expanded', String(open));
  }
});
// Tapping anywhere else closes the phone grid.
document.addEventListener('pointerdown', e => {
  const bar = $('emotebar');
  if (bar && bar.classList.contains('open') && !e.target.closest('#emotebar')) closeGrid();
}, true);
/* Hovering an emote in the bar shows it large, with its name, until the mouse moves away. */
function showPreview(b) {
  const e = E.list.find(x => x.id === b.dataset.k);
  if (!e || !e.src) return;
  let p = $('emotePreview');
  if (!p) { p = document.createElement('div'); p.id = 'emotePreview'; p.className = 'emotepreview'; p.setAttribute('aria-hidden', 'true'); document.body.appendChild(p); }
  p.innerHTML = `<img src="${esc(e.src)}" alt=""><span>${esc(e.label)}</span>`;
  const r = b.getBoundingClientRect();
  p.style.left = Math.min(window.innerWidth - 108, Math.max(108, r.left + r.width / 2)) + 'px';
  p.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  p.hidden = false;
}
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const b = e.target.closest && e.target.closest('#emoteIn button');
  if (b) showPreview(b);
});
document.addEventListener('pointerout', e => {
  const b = e.target.closest && e.target.closest('#emoteIn button');
  if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) { const p = $('emotePreview'); if (p) p.hidden = true; }
});
/* Float the emote up from above the player's avatar ([data-avatar="pid"]), wherever it is on screen. */
function playEmote(pid, id) {
  const e = E.list.find(x => x.id === id);
  if (!e) return;
  ensureBar();
  const els = [...document.querySelectorAll(`[data-avatar="${CSS.escape(pid)}"]`)].filter(el => el.offsetParent);
  let x, y;
  if (els.length) {
    const r = els[0].getBoundingClientRect();
    const h = window.innerWidth < 620 ? 140 : 190;
    x = r.left + r.width / 2; y = r.top - h + 10;
  } else { x = window.innerWidth / 2; y = window.innerHeight / 2; }
  x += (Math.random() - 0.5) * 18;
  const el = document.createElement('div');
  el.className = 'floatemote';
  el.innerHTML = face(e);
  el.style.left = Math.min(window.innerWidth - 20, Math.max(20, x)) + 'px';
  el.style.top = Math.max(4, y) + 'px';
  $('emotelayer').appendChild(el);
  setTimeout(() => el.remove(), 4400);
}

return {
  esc, store,
  soundOn: () => soundOn, setSound, soundButtonHTML, chime,
  attention, keepAwake,
  emotes: { init(send) { E.send = send; ensureBar(); }, set: setEmotes, show: showBar, play: playEmote }
};
})();
