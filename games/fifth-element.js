'use strict';
/*
 * The Fifth Element: a speed game played inside a party room.
 *
 * There are five items, each with its own color. Every card shows two items:
 *  - If one of them is shown in its own color, that item is the answer.
 *  - If both are shown in the wrong color, the answer is the one item that is
 *    neither on the card nor in a color on the card.
 * The first correct click wins the card, plus any cards carried over from earlier
 * cards nobody won. A wrong click burns one card from the player's pile and locks
 * them out of that card. Most cards at the end wins; a tie goes to sudden death.
 *
 * Item sets ("themes") live in public/games/fifth-element/themes/<id>/theme.json,
 * each with five SVG files. They are read once when the server starts.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const THEME_DIR = path.join(__dirname, '..', 'public', 'games', 'fifth-element', 'themes');
const DEFAULT_THEME = 'magic';
const DECK_SIZES = [30, 60, 90, 120];
const FIRST_READY_MS = 3000;     // countdown before the first card
const NEXT_MIN_MS = 1000;        // pause before each later card, picked at random between these
const NEXT_MAX_MS = 2200;
const RESULT_MS = 2400;          // how long the answer stays up after each card
const CARD_MS = 20000;           // a card nobody wins in this time carries over
const SUDDEN_INTRO_MS = 3500;
const BURN = 1;

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Fifth Element error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const between = (lo, hi) => lo + crypto.randomInt(hi - lo + 1);

/* ---------- themes ---------- */
function loadThemes() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(THEME_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch (e) { console.error('No Fifth Element themes folder:', e.message); }
  for (const id of dirs) {
    try {
      if (!/^[a-z0-9-]{1,40}$/.test(id)) throw new Error('folder names use only lowercase letters, numbers and dashes');
      const t = JSON.parse(fs.readFileSync(path.join(THEME_DIR, id, 'theme.json'), 'utf8'));
      if (!Array.isArray(t.items) || t.items.length !== 5) throw new Error('theme.json needs exactly 5 items');
      const items = t.items.map((it, i) => {
        const file = String(it.file || '');
        if (!/^[A-Za-z0-9_.-]+\.(svg|png)$/.test(file)) throw new Error(`item ${i + 1} needs a "file" like flame.svg`);
        if (!fs.existsSync(path.join(THEME_DIR, id, file))) throw new Error(`can't find ${file}`);
        if (!/^#[0-9A-Fa-f]{6}$/.test(String(it.color))) throw new Error(`item ${i + 1} needs a "color" like #E5392F`);
        return {
          name: String(it.name || file.replace(/\.\w+$/, '')).slice(0, 30),
          color: it.color,
          colorName: String(it.colorName || '').slice(0, 20),
          src: `/games/fifth-element/themes/${id}/${file}`
        };
      });
      if (new Set(items.map(x => x.color.toLowerCase())).size !== 5) throw new Error('the five colors must all be different');
      out.push({ id, name: String(t.name || id).slice(0, 40), items });
    } catch (e) { console.error(`Skipping Fifth Element theme "${id}": ${e.message}`); }
  }
  out.sort((a, b) => (a.id === DEFAULT_THEME ? -1 : b.id === DEFAULT_THEME ? 1 : a.name.localeCompare(b.name)));
  return out;
}
const THEMES = loadThemes();
if (!THEMES.length) console.error('Fifth Element has no usable themes.');

/* ---------- cards ----------
   Items and colors are numbered 0-4; item k's own color is color k.
   A card is two { item, color } pairs plus its answer. */
function allCards() {
  const cards = [];
  // One item in its own color. The other item is in a color that is neither
  // its own nor the first item's, so only one item on the card is "right".
  for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
    if (j === i) continue;
    for (let c = 0; c < 5; c++) {
      if (c === i || c === j) continue;
      cards.push({ shows: [{ item: i, color: i }, { item: j, color: c }], answer: i });
    }
  }
  // Both items in the wrong color. Both colors belong to items that are not on
  // the card, so crossing out the shown items and colors leaves exactly one item.
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) {
    const others = [0, 1, 2, 3, 4].filter(k => k !== i && k !== j);
    for (const ci of others) for (const cj of others) {
      if (ci === cj) continue;
      cards.push({ shows: [{ item: i, color: ci }, { item: j, color: cj }], answer: others.find(k => k !== ci && k !== cj) });
    }
  }
  return cards; // 60 + 60 = 120
}
/* Deal a card ready to show: random left/right order and a little tilt and size for each item. */
function dress(card) {
  const shows = crypto.randomInt(2) ? card.shows.slice() : card.shows.slice().reverse();
  return {
    answer: card.answer,
    shows: shows.map(s => ({ item: s.item, color: s.color, rot: between(-28, 28), size: between(86, 112) }))
  };
}

/* ---------- settings ---------- */
const defaults = () => ({ deck: 60, theme: THEMES.length ? THEMES[0].id : DEFAULT_THEME });
function cleanSettings(p, base) {
  const s = { deck: base.deck, theme: base.theme };
  if (DECK_SIZES.includes(Number(p.deck))) s.deck = Number(p.deck);
  if (typeof p.theme === 'string' && THEMES.some(t => t.id === p.theme)) s.theme = p.theme;
  return s;
}

/* ---------- game flow ----------
   ctx comes from the party room:
     ctx.broadcast()      send everyone the new state
     ctx.fx(data)         send everyone a one-off effect (card won, cards burned)
     ctx.playerIds()      everyone in the room
     ctx.onlineIds()      everyone in the room who is connected right now */
function start(ctx, settings) {
  const g = {
    id: 'fifth', ctx,
    theme: settings.theme, deckSize: settings.deck,
    deck: shuffle(allCards()).slice(0, settings.deck), dealt: 0,
    phase: 'ready', revealAt: 0, shownAt: 0, seq: 0,
    card: null, pot: 0, locked: new Set(), result: null,
    piles: {}, burned: 0, sudden: null, winner: null, timer: null
  };
  for (const pid of ctx.playerIds()) g.piles[pid] = 0;
  queueNext(g, FIRST_READY_MS);
  return g;
}
function clear(g) { if (g.timer) { clearTimeout(g.timer); g.timer = null; } }
function stop(g) { clear(g); }

function queueNext(g, delay) {
  clear(g);
  if (g.sudden) {
    const left = g.sudden.filter(pid => g.ctx.onlineIds().includes(pid));
    if (left.length < 2) return finish(g, left[0] || null);
  } else if (g.dealt >= g.deck.length) {
    return finish(g);
  }
  g.phase = g.sudden && g.phase === 'sudden' ? 'sudden' : 'ready';
  g.card = null; g.locked = new Set(); g.result = null;
  g.readyAt = Date.now();
  g.revealAt = g.readyAt + delay;
  g.timer = setTimeout(safe(() => reveal(g)), delay);
  g.ctx.broadcast();
}
function reveal(g) {
  clear(g);
  g.card = g.sudden ? dress(allCards()[crypto.randomInt(120)]) : dress(g.deck[g.dealt++]);
  g.pot += 1;
  g.seq += 1;
  g.phase = 'card';
  g.shownAt = Date.now();
  g.timer = setTimeout(safe(() => noWinner(g, 'time')), CARD_MS);
  g.ctx.broadcast();
}

function canPlay(g, pid) { return !g.sudden || g.sudden.includes(pid); }
function eligible(g) { return g.ctx.onlineIds().filter(pid => canPlay(g, pid)); }

function pick(g, pid, payload) {
  if (g.phase !== 'card' || payload.seq !== g.seq) return { ok: false, late: true };
  if (!canPlay(g, pid)) return { ok: false, error: 'Only the tied players play the sudden-death card.' };
  if (g.locked.has(pid)) return { ok: false, error: 'You’re locked out of this card.' };
  const item = Number(payload.item);
  if (!Number.isInteger(item) || item < 0 || item > 4) return { ok: false };
  if (!(pid in g.piles)) g.piles[pid] = 0;

  if (item === g.card.answer) {
    clear(g);
    const won = g.pot;
    g.piles[pid] += won;
    g.pot = 0;
    g.phase = 'result';
    g.result = { winner: pid, answer: item, cards: won, ms: Date.now() - g.shownAt };
    g.ctx.fx({ type: 'win', pid, n: won });
    g.timer = g.sudden
      ? setTimeout(safe(() => finish(g, pid)), RESULT_MS)
      : setTimeout(safe(() => queueNext(g, between(NEXT_MIN_MS, NEXT_MAX_MS))), RESULT_MS);
    g.ctx.broadcast();
    return { ok: true, correct: true };
  }

  g.locked.add(pid);
  let burned = 0;
  if (!g.sudden) {
    burned = Math.min(BURN, g.piles[pid]);
    g.piles[pid] -= burned;
    g.burned += burned;
  }
  g.ctx.fx({ type: 'burn', pid, n: burned, item });
  if (!checkAllLocked(g)) g.ctx.broadcast();
  return { ok: true, correct: false, burned };
}

/* Everyone who can still play this card has been locked out: nobody wins it. */
function checkAllLocked(g) {
  if (g.phase !== 'card') return false;
  const el = eligible(g);
  if (el.length && !el.every(pid => g.locked.has(pid))) return false;
  noWinner(g, 'locked');
  return true;
}
function noWinner(g, why) {
  if (g.phase !== 'card') return;
  clear(g);
  const last = !g.sudden && g.dealt >= g.deck.length;
  g.phase = 'result';
  g.result = { winner: null, answer: g.card.answer, why, carried: last ? 0 : g.pot, lost: last ? g.pot : 0 };
  if (last) g.pot = 0;
  g.timer = setTimeout(safe(() => queueNext(g, between(NEXT_MIN_MS, NEXT_MAX_MS))), RESULT_MS);
  g.ctx.broadcast();
}

function finish(g, suddenWinner) {
  clear(g);
  g.pot = 0;
  if (suddenWinner !== undefined) {
    g.phase = 'final';
    g.winner = suddenWinner;
    g.card = null;
    g.ctx.broadcast();
    return;
  }
  const ids = Object.keys(g.piles);
  const top = Math.max(0, ...ids.map(pid => g.piles[pid]));
  const tied = ids.filter(pid => g.piles[pid] === top);
  const tiedHere = tied.filter(pid => g.ctx.onlineIds().includes(pid));
  if (tied.length > 1 && tiedHere.length > 1) {
    g.sudden = tiedHere;
    g.phase = 'sudden';
    g.card = null; g.result = null; g.locked = new Set();
    g.revealAt = Date.now() + SUDDEN_INTRO_MS;
    g.timer = setTimeout(safe(() => reveal(g)), SUDDEN_INTRO_MS);
    g.ctx.broadcast();
    return;
  }
  g.phase = 'final';
  g.winner = tied.length === 1 ? tied[0] : (tiedHere[0] || null);
  g.card = null;
  g.ctx.broadcast();
}

/* Someone left or dropped out: they might have been the last one we were waiting for. */
function playersChanged(g) {
  if (g.phase === 'card') checkAllLocked(g);
}
function playerJoined(g, pid) {
  if (!(pid in g.piles) && g.phase !== 'final') g.piles[pid] = 0;
}

/* What each player's page gets. The answer stays on the server until the card is over,
   and the card itself until the moment it is revealed. */
function view(g) {
  const showCard = g.phase === 'card' || g.phase === 'result';
  return {
    id: 'fifth',
    theme: g.theme,
    deckSize: g.deckSize,
    left: g.deck.length - g.dealt,
    phase: g.phase,
    readyAt: g.readyAt,
    revealAt: g.revealAt,
    shownAt: g.shownAt,
    seq: g.seq,
    card: showCard && g.card ? { shows: g.card.shows } : null,
    pot: g.pot,
    piles: g.piles,
    locked: [...g.locked],
    result: g.phase === 'result' ? g.result : null,
    sudden: g.sudden,
    winner: g.phase === 'final' ? g.winner : null,
    burned: g.burned
  };
}

/* ---------- bots ----------
   A practice opponent with a human-ish reaction time. It works the answer out from the
   card exactly as everyone sees it (view()), takes 2-5 seconds (a bit longer when both
   items are in the wrong color, so the answer is the "fifth" one) and clicks a wrong item
   about 15% of the time, which also burns one of its cards, like anyone else's.

   The server asks bot() once to schedule a move and again when the timer fires, and plays
   whatever that second answer is straight away. A timer set for one card can fire on the
   next one (someone else won it first), so the bot remembers whether its last answer was a
   plan; if so this call is the timer firing, and a move that isn't due yet returns null.
   The server then asks again right away and gets the remaining wait. */
const BOT_REACT_MS = [2000, 5000];
const BOT_HARD_MS = 800;
const BOT_WRONG = 0.15;
const botState = new WeakMap();   // game -> { pid: { expecting, seq, at, item } }
function answerOf(shows) {
  const own = shows.find(s => s.item === s.color);
  if (own) return own.item;
  return [0, 1, 2, 3, 4].find(k => !shows.some(s => s.item === k || s.color === k));
}
function bot(g, pid) {
  let all = botState.get(g);
  if (!all) botState.set(g, all = {});
  const st = all[pid] || (all[pid] = { expecting: false, seq: -1 });
  const fromTimer = st.expecting;
  st.expecting = false;
  const v = view(g);
  if (v.phase !== 'card' || !v.card) return null;
  if (v.sudden && !v.sudden.includes(pid)) return null;
  if (v.locked.includes(pid)) return null;
  if (st.seq !== v.seq) {
    const right = answerOf(v.card.shows);
    const hard = !v.card.shows.some(s => s.item === s.color);
    const wrong = [0, 1, 2, 3, 4].filter(k => k !== right);
    st.seq = v.seq;
    st.item = Math.random() < BOT_WRONG ? wrong[crypto.randomInt(wrong.length)] : right;
    st.at = v.shownAt + between(...BOT_REACT_MS) + (hard ? BOT_HARD_MS : 0);
  }
  const wait = st.at - Date.now();
  const move = { seq: st.seq, item: st.item };
  if (fromTimer) return wait > 0 ? null : { move };
  st.expecting = true;
  return { move, delay: Math.max(0, wait) };
}

module.exports = {
  id: 'fifth', name: 'The Fifth Element', minPlayers: 2,
  THEMES, DECK_SIZES, defaults, cleanSettings,
  start, stop, pick, view, playersChanged, playerJoined, bot,
  allCards // for tests
};
