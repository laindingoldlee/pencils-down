'use strict';
/*
 * Signal Salvage: The Last Signal. A press-your-luck game played inside a party room.
 *
 * On your turn you scan cards from the face-down scanning deck into the shared scan zone.
 * Each new emblem's ability happens. Scan an emblem that's already in the scan zone and
 * the run collapses: the cards go to the signal archive, except any a Shield protected.
 * Or stop and collect: every card in the scan zone goes into your vault, stacked by emblem.
 * The game ends after the turn in which the last card was scanned. Only the top (highest)
 * card of each vault stack scores. Highest total wins; a tie goes to more cards in the vault.
 *
 * Optional: Specialists (each player keeps one of two dealt), one Mission Protocol, and
 * the Aurora Protocol variant. 5 to 8 players use two copies of the deck.
 */
const crypto = require('crypto');

const EMBLEMS = ['shield', 'grapple', 'pulse', 'key', 'vault', 'map', 'predictor', 'breach', 'leviathan', 'aurora'];
const NAMES = {
  shield: 'Shield', grapple: 'Grapple', pulse: 'Pulse', key: 'Access Key', vault: 'Vault',
  map: 'Survey Map', predictor: 'Predictor', breach: 'Breach', leviathan: 'Leviathan', aurora: 'Aurora'
};
const SPECIALISTS = [
  { id: 'tamer', name: 'Leviathan Tamer', text: 'Other players must add four cards, instead of two, when they encounter a Leviathan.' },
  { id: 'gexpert', name: 'Grapple Expert', text: 'Your Grapple moves two cards from your vault instead of one.' },
  { id: 'collector', name: 'Aurora Collector', text: 'Aurora cards you draw are banked immediately. They do not enter the scan zone.', variant: 'With the Aurora Protocol: when you add an Aurora, the card it chooses is banked immediately instead of activating again.' },
  { id: 'custodian', name: 'Black-Box Custodian', text: 'Choose one opponent at the start. When that player’s run collapses, you bank their unprotected cards instead of sending them to the archive.' },
  { id: 'angler', name: 'Void Angler', text: 'Leviathans you draw are banked immediately and do not force you to add more cards.' },
  { id: 'prism', name: 'Prism Analyst', text: 'Your Aurora cards are worth five extra points each.' },
  { id: 'failsafe', name: 'Failsafe Engineer', text: 'Your Grapple and the card it adds are protected from a collapse.' },
  { id: 'navigator', name: 'Archive Navigator', text: 'When you use a Survey Map, choose any card in the signal archive instead of choosing from the revealed cards.' },
  { id: 'pcommander', name: 'Pulse Commander', text: 'Your Pulse removes an entire emblem stack from an opponent’s vault instead of only its top card.' },
  { id: 'backfire', name: 'Backfire Specialist', text: 'When an opponent draws a Pulse, they must discard the top card of one of their own vault stacks.' },
  { id: 'deep', name: 'Deep Scanner', text: 'Your Predictor reveals the top three cards in order instead of one.' },
  { id: 'interceptor', name: 'Breach Interceptor', text: 'An opponent’s Breach must take a Leviathan. If no Leviathan is available, their Breach has no effect.' },
  { id: 'raider', name: 'Data Raider', text: 'Your Access Key and Vault bonus cards come from one opponent’s vault instead of the archive. That vault is shuffled first.' },
  { id: 'planner', name: 'Safe-Route Planner', text: 'Your Shield and the next two cards added after it are protected from collapse.' },
  { id: 'scrap', name: 'Scrap Diver', text: 'Cards removed by your Pulse go into your vault instead of the signal archive.' },
  { id: 'bspec', name: 'Breach Specialist', text: 'Your Breach may take a card from an emblem you already have in your vault.' },
  { id: 'multiplier', name: 'Archive Multiplier', text: 'Your Access Key and Vault bonus gives you twice as many cards.' }
];
const SPEC_IDS = SPECIALISTS.map(s => s.id);
const PROTOCOLS = [
  { id: 'thieves', name: 'Signal Thieves', text: 'When a run collapses, its cards go to the player on the active player’s left instead of the archive.' },
  { id: 'total', name: 'Total Recovery', text: 'Score every card in each vault stack, not only the highest card in each stack.' },
  { id: 'fifty', name: 'First to Fifty', text: 'The first player to reach 50 points wins.' },
  { id: 'spectrum', name: 'Full Spectrum', text: 'At the end of the game, lose 5 points for every emblem missing from your vault.' },
  { id: 'pattern', name: 'Pattern Lock', text: 'A run also collapses when you reveal a number already in the scan zone, whatever its emblem.' },
  { id: 'limit', name: 'Under the Limit', text: 'The winner is the player with the highest score below 60. A score of 60 or more is disqualified.' },
  { id: 'bottom', name: 'Bottom Shelf', text: 'Breach and Pulse take the bottom card of an opponent’s emblem stack instead of the top card.' }
];
const PROTO_IDS = PROTOCOLS.map(p => p.id);
const MAX_PLAYERS = 8;
const DRAFT_MS = 60000;     // time to choose a Specialist
const AWAY_MS = 15000;      // a disconnected player's moves are made for them after this long
const TURN_GAP_MS = 2600;   // how long a collapse or a collect stays on screen before the next turn
const AUTO_ONE = new Set(['grapple', 'pulse', 'breach', 'backfire', 'raider']); // one option: just do it

const safe = fn => (...args) => { try { return fn(...args); } catch (e) { console.error('Signal Salvage error:', e); } };
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickRandom = a => a[crypto.randomInt(a.length)];
const pub = c => ({ id: c.id, e: c.e, v: c.v });

/* ---------- settings ---------- */
const defaults = () => ({ specialists: false, protocol: 'none', aurora: false });
function cleanSettings(p, base) {
  const s = Object.assign({}, base);
  if (typeof p.specialists === 'boolean') s.specialists = p.specialists;
  if (typeof p.aurora === 'boolean') s.aurora = p.aurora;
  if (p.protocol === 'none' || PROTO_IDS.includes(p.protocol)) s.protocol = p.protocol;
  return s;
}
function canStart(s, players) {
  if (players > MAX_PLAYERS) return `Signal Salvage is for 2 to ${MAX_PLAYERS} players.`;
  return null;
}

/* ---------- game ---------- */
function start(ctx, settings) {
  const order = ctx.onlineIds().slice(0, MAX_PLAYERS);
  const copies = order.length >= 5 ? 2 : 1;
  let nextId = 1;
  const deck = [], archive = [];
  for (let k = 0; k < copies; k++) {
    for (const e of EMBLEMS) {
      const lo = e === 'aurora' ? 4 : 2;
      for (let v = lo; v < lo + 6; v++) (v === lo ? archive : deck).push({ id: nextId++, e, v });
    }
  }
  const g = {
    id: 'ss', ctx, s: Object.assign({}, settings), order, copies,
    deck: shuffle(deck), archive: shuffle(archive), zone: [],
    vaults: Object.fromEntries(order.map(p => [p, {}])),
    spec: Object.fromEntries(order.map(p => [p, null])), custodianOf: {}, offers: {},
    phase: 'play', turn: null, first: null, log: [], touched: { seq: 0, ids: [] },
    winners: null, final: null, endWhy: '', timer: null, awayTimer: null, draftEnds: 0, nextAt: 0
  };
  if (g.s.specialists) {
    g.phase = 'draft';
    const pool = shuffle(SPEC_IDS.slice());
    for (const pid of order) g.offers[pid] = pool.splice(0, 2);
    g.draftEnds = Date.now() + DRAFT_MS;
    g.timer = setTimeout(safe(() => {
      for (const pid of g.order) if (!g.spec[pid]) chooseSpec(g, pid, pickRandom(g.offers[pid]), pickRandom(others(g, pid)));
    }), DRAFT_MS);
    g.ctx.broadcast();
  } else beginPlay(g);
  return g;
}
function clear(g) {
  if (g.timer) { clearTimeout(g.timer); g.timer = null; }
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
}
function stop(g) { clear(g); }
function log(g, e) { g.log.push(e); if (g.log.length > 120) g.log.shift(); }
function touch(g, ids) { g.touched = { seq: g.touched.seq + 1, ids: ids.filter(Boolean) }; }
const others = (g, pid) => g.order.filter(p => p !== pid);
const has = (g, pid, spec) => g.spec[pid] === spec;
const oppHas = (g, pid, spec) => others(g, pid).some(p => g.spec[p] === spec);
const proto = (g, id) => g.s.protocol === id;

function chooseSpec(g, pid, id, target) {
  if (g.phase !== 'draft' || g.spec[pid] || !(g.offers[pid] || []).includes(id)) return false;
  if (id === 'custodian') {
    if (!others(g, pid).includes(target)) return false;
    g.custodianOf[pid] = target;
  }
  g.spec[pid] = id;
  if (g.order.every(p => g.spec[p])) {
    clear(g);
    for (const p of g.order) log(g, { k: 'spec', pid: p, spec: g.spec[p], target: g.custodianOf[p] });
    beginPlay(g);
  } else g.ctx.broadcast();
  return true;
}
function beginPlay(g) {
  g.phase = 'play';
  // The Starting Crew card goes to a random player.
  g.first = crypto.randomInt(g.order.length);
  log(g, { k: 'crew', pid: g.order[g.first], copies: g.copies });
  g.ctx.fx({ type: 'crew', pid: g.order[g.first] });
  startTurn(g, g.order[g.first]);
}

/* ---------- vaults ---------- */
// Each vault stack is kept highest value first; index 0 is the top card.
function bank(g, pid, card) {
  const v = g.vaults[pid];
  (v[card.e] = v[card.e] || []).push(card);
  v[card.e].sort((a, b) => b.v - a.v);
}
function stacksOf(g, pid) { return EMBLEMS.filter(e => g.vaults[pid][e] && g.vaults[pid][e].length); }
function takeFrom(g, pid, e, bottom) {
  const st = g.vaults[pid][e];
  const c = bottom ? st.pop() : st.shift();
  if (!st.length) delete g.vaults[pid][e];
  return c;
}
const vaultCount = (g, pid) => Object.values(g.vaults[pid]).reduce((a, s) => a + s.length, 0);

function score(g, pid) {
  let pts = 0, cards = 0;
  for (const e of EMBLEMS) {
    const st = g.vaults[pid][e];
    if (!st || !st.length) continue;
    cards += st.length;
    for (const c of proto(g, 'total') ? st : [st[0]]) pts += c.v + (c.e === 'aurora' && has(g, pid, 'prism') ? 5 : 0);
  }
  const missing = EMBLEMS.filter(e => !(g.vaults[pid][e] && g.vaults[pid][e].length)).length;
  if (proto(g, 'spectrum')) pts -= 5 * missing;
  return { pts, cards, missing, over: proto(g, 'limit') && pts >= 60 };
}
function best(g, pids) {
  if (!pids.length) return [];
  const sc = Object.fromEntries(pids.map(p => [p, score(g, p)]));
  const top = Math.max(...pids.map(p => sc[p].pts));
  const tied = pids.filter(p => sc[p].pts === top);
  const most = Math.max(...tied.map(p => sc[p].cards));
  return tied.filter(p => sc[p].cards === most);
}

/* ---------- turns ---------- */
function startTurn(g, pid) {
  clear(g);
  g.zone = [];
  g.turn = { pid, drawn: 0, need: 0, protN: 0, q: [], pending: null, reveal: null, peek: null, ended: null, collected: false, bonus: 0 };
  g.nextAt = 0;
  log(g, { k: 'turn', pid });
  watchAway(g);
  g.ctx.broadcast();
}
function endTurn(g) {
  const t = g.turn;
  t.q = []; t.pending = null; t.reveal = null; t.peek = null;
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (proto(g, 'fifty')) {
    const reached = g.order.filter(p => score(g, p).pts >= 50);
    if (reached.length) return finish(g, 'fifty', best(g, reached));
  }
  if (!g.deck.length) return finish(g, 'deck');
  g.nextAt = Date.now() + TURN_GAP_MS;
  const i = g.order.indexOf(t.pid);
  g.timer = setTimeout(safe(() => startTurn(g, g.order[(i + 1) % g.order.length])), TURN_GAP_MS);
  g.ctx.broadcast();
}
function finish(g, why, winners) {
  clear(g);
  g.phase = 'over';
  g.endWhy = why;
  g.final = Object.fromEntries(g.order.map(p => [p, score(g, p)]));
  g.winners = winners || best(g, g.order.filter(p => !g.final[p].over));
  log(g, { k: 'over', why });
  g.ctx.broadcast();
}

/* Draw the top card of the scanning deck (a plain scan, or a Predictor's card). */
function drawCard(g, how) {
  const t = g.turn, pid = t.pid;
  const c = g.deck.shift();
  t.drawn += 1;
  if (c.e === 'aurora' && !g.s.aurora && has(g, pid, 'collector')) {
    bank(g, pid, c); log(g, { k: 'quickbank', pid, card: pub(c), spec: 'collector' }); touch(g, [c.id]);
    return;
  }
  if (c.e === 'leviathan' && has(g, pid, 'angler')) {
    bank(g, pid, c); log(g, { k: 'quickbank', pid, card: pub(c), spec: 'angler' }); touch(g, [c.id]);
    return;
  }
  log(g, { k: how, pid, card: pub(c) });
  addToZone(g, c, how);
}
/* Put a card into the scan zone. A repeated emblem (or number, with Pattern Lock) collapses the run. */
function addToZone(g, c, src) {
  const t = g.turn;
  const dup = g.zone.some(z => z.c.e === c.e) || (proto(g, 'pattern') && g.zone.some(z => z.c.v === c.v));
  const entry = { c, prot: false, src };
  if (t.protN > 0) { entry.prot = true; t.protN -= 1; }
  if (src === 'grapple' && has(g, t.pid, 'failsafe')) entry.prot = true;
  g.zone.push(entry);
  touch(g, [c.id]);
  if (dup) { collapse(g, c); return false; }
  if (t.need > 0) t.need -= 1;
  t.q.unshift({ k: 'ability', id: c.id });
  return true;
}
function collapse(g, dupCard) {
  const t = g.turn, pid = t.pid;
  t.ended = 'collapse';
  const kept = g.zone.filter(z => z.prot).map(z => z.c);
  const lost = g.zone.filter(z => !z.prot).map(z => z.c);
  for (const c of kept) bank(g, pid, c);
  const custodian = others(g, pid).find(p => g.spec[p] === 'custodian' && g.custodianOf[p] === pid);
  const left = g.order[(g.order.indexOf(pid) + 1) % g.order.length];
  let to = null;
  if (custodian) to = custodian;
  else if (proto(g, 'thieves')) to = left;
  for (const c of lost) { if (to) bank(g, to, c); else g.archive.push(c); }
  t.result = { kind: 'collapse', dup: pub(dupCard), kept: kept.map(pub), lost: lost.map(pub), to };
  log(g, { k: 'collapse', pid, dup: pub(dupCard), kept: kept.length, lost: lost.length, to, why: custodian ? 'custodian' : to ? 'thieves' : '' });
  g.ctx.fx({ type: 'collapse', pid, dup: pub(dupCard), kept: kept.length, lost: lost.length });
  g.zone = [];
  endTurn(g);
}
function collect(g) {
  const t = g.turn, pid = t.pid;
  const cards = g.zone.map(z => z.c);
  const bonus = g.zone.some(z => z.c.e === 'key') && g.zone.some(z => z.c.e === 'vault');
  for (const c of cards) bank(g, pid, c);
  g.zone = [];
  t.q = []; t.pending = null; t.reveal = null; t.peek = null;
  t.collected = true;
  t.result = { kind: 'collect', n: cards.length, cards: cards.map(pub), bonus: [] };
  log(g, { k: 'collect', pid, n: cards.length });
  touch(g, cards.map(c => c.id));
  if (bonus && cards.length) {
    const count = cards.length * (has(g, pid, 'multiplier') ? 2 : 1);
    if (has(g, pid, 'raider')) t.q.push({ k: 'raider', count });
    else {
      shuffle(g.archive);
      const got = g.archive.splice(0, count);
      for (const c of got) bank(g, pid, c);
      t.result.bonus = got.map(pub);
      log(g, { k: 'bonus', pid, n: got.length, from: null });
    }
  }
  run(g);
}

/* ---------- abilities ---------- */
function ability(g, entry) {
  const t = g.turn, pid = t.pid, e = entry.c.e;
  const fizzle = () => log(g, { k: 'fizzle', pid, e });
  switch (e) {
    case 'shield': {
      const i = g.zone.indexOf(entry);
      g.zone.forEach((z, j) => { if (j < i) z.prot = true; });
      if (has(g, pid, 'planner')) { entry.prot = true; t.protN = 2; }
      log(g, { k: 'shield', pid, n: i });
      touch(g, g.zone.slice(0, i).map(z => z.c.id));
      return;
    }
    case 'grapple': {
      if (!stacksOf(g, pid).length) return fizzle();
      if (has(g, pid, 'failsafe')) entry.prot = true;
      const n = has(g, pid, 'gexpert') ? 2 : 1;
      for (let k = 0; k < n; k++) t.q.unshift({ k: 'grapple' });
      return;
    }
    case 'pulse':
      if (oppHas(g, pid, 'backfire')) t.q.unshift({ k: 'backfire' });
      t.q.unshift({ k: 'pulse' });
      return;
    case 'map': {
      if (!g.archive.length) return fizzle();
      shuffle(g.archive);
      t.reveal = (has(g, pid, 'navigator') ? g.archive : g.archive.slice(0, 3)).map(c => c.id);
      t.q.unshift({ k: 'map' });
      return;
    }
    case 'predictor': {
      if (!g.deck.length) return fizzle();
      t.peek = g.deck.slice(0, has(g, pid, 'deep') ? 3 : 1).map(c => c.id);
      t.q.unshift({ k: 'predict' });
      return;
    }
    case 'breach': t.q.unshift({ k: 'breach' }); return;
    case 'leviathan': {
      const n = oppHas(g, pid, 'tamer') ? 4 : 2;
      t.need += n;
      log(g, { k: 'leviathan', pid, n });
      return;
    }
    case 'aurora':
      if (g.s.aurora) t.q.unshift({ k: 'aurora', id: entry.c.id });
      return;
  }
  // Access Key and Vault do nothing until you collect.
}

/* What the active player may choose for a waiting ability. Options are strings. */
function optionsFor(g, task) {
  const pid = g.turn.pid;
  const oppStacks = filter => others(g, pid).flatMap(p => stacksOf(g, p).filter(e => !filter || filter(e)).map(e => `${p}:${e}`));
  switch (task.k) {
    case 'grapple': case 'backfire': return stacksOf(g, pid);
    case 'pulse': return oppStacks();
    case 'breach': {
      const mine = new Set(stacksOf(g, pid));
      const spec = has(g, pid, 'bspec');
      const intercept = oppHas(g, pid, 'interceptor');
      return oppStacks(e => (spec || !mine.has(e)) && (!intercept || e === 'leviathan'));
    }
    case 'map': return (g.turn.reveal || []).filter(id => g.archive.some(c => c.id === id)).map(String);
    case 'predict': {
      if (!g.deck.length) return [];
      const canCollect = g.turn.need <= 0;
      return canCollect ? ['add', 'return'] : ['add'];
    }
    case 'aurora': return g.zone.filter(z => z.c.id !== task.id).map(z => String(z.c.id));
    case 'raider': return others(g, pid).filter(p => vaultCount(g, p) > 0);
  }
  return [];
}
function applyChoice(g, task, k) {
  const t = g.turn, pid = t.pid;
  t.pending = null;
  switch (task.k) {
    case 'grapple': {
      const c = takeFrom(g, pid, k);
      log(g, { k: 'grapple', pid, card: pub(c) });
      addToZone(g, c, 'grapple');
      return;
    }
    case 'backfire': {
      const c = takeFrom(g, pid, k);
      g.archive.push(c);
      log(g, { k: 'backfire', pid, card: pub(c) });
      return;
    }
    case 'pulse': case 'breach': {
      const [owner, e] = k.split(':');
      const bottom = proto(g, 'bottom');
      if (task.k === 'pulse') {
        const all = has(g, pid, 'pcommander');
        const gone = [];
        do gone.push(takeFrom(g, owner, e, bottom)); while (all && g.vaults[owner][e]);
        const scrap = has(g, pid, 'scrap');
        for (const c of gone) { if (scrap) bank(g, pid, c); else g.archive.push(c); }
        log(g, { k: 'pulse', pid, target: owner, cards: gone.map(pub), scrap });
        g.ctx.fx({ type: 'pulse', pid, target: owner });
        touch(g, gone.map(c => c.id));
      } else {
        const c = takeFrom(g, owner, e, bottom);
        log(g, { k: 'breach', pid, target: owner, card: pub(c) });
        addToZone(g, c, 'breach');
      }
      return;
    }
    case 'map': {
      const i = g.archive.findIndex(c => String(c.id) === k);
      const [c] = g.archive.splice(i, 1);
      t.reveal = null;
      log(g, { k: 'map', pid, card: pub(c) });
      addToZone(g, c, 'map');
      return;
    }
    case 'predict':
      t.peek = null;
      if (k === 'add') { drawCard(g, 'predicted'); return; }
      log(g, { k: 'predictBack', pid });
      collect(g);
      return;
    case 'aurora': {
      const i = g.zone.findIndex(z => String(z.c.id) === k);
      const [z] = g.zone.splice(i, 1);
      if (has(g, pid, 'collector')) {
        bank(g, pid, z.c);
        log(g, { k: 'auroraBank', pid, card: pub(z.c) });
        touch(g, [z.c.id]);
        return;
      }
      g.zone.push(z);
      log(g, { k: 'aurora', pid, card: pub(z.c) });
      touch(g, [z.c.id]);
      t.q.unshift({ k: 'ability', id: z.c.id });
      return;
    }
    case 'raider': {
      const all = shuffle(EMBLEMS.flatMap(e => g.vaults[k][e] || []));
      const got = all.slice(0, task.count);
      for (const c of got) {
        const st = g.vaults[k][c.e];
        st.splice(st.indexOf(c), 1);
        if (!st.length) delete g.vaults[k][c.e];
        bank(g, pid, c);
      }
      t.result.bonus = got.map(pub);
      log(g, { k: 'bonus', pid, n: got.length, from: k });
      return;
    }
  }
}

/* Work through waiting abilities. Stops when the active player has to choose something. */
function run(g) {
  const t = g.turn;
  for (let guard = 0; guard < 200; guard++) {
    if (g.phase !== 'play' || g.turn !== t || (t.ended && !t.collected)) return;
    if (t.pending) break;
    const task = t.q.shift();
    if (!task) break;
    if (task.k === 'ability') {
      const entry = g.zone.find(z => z.c.id === task.id);
      if (entry) ability(g, entry);
      continue;
    }
    const opts = optionsFor(g, task);
    if (!opts.length) {
      log(g, { k: 'fizzle', pid: t.pid, e: { grapple: 'grapple', backfire: 'pulse', pulse: 'pulse', breach: 'breach', map: 'map', predict: 'predictor', aurora: 'aurora', raider: 'vault' }[task.k], why: task.k === 'backfire' ? 'backfire' : '' });
      if (task.k === 'map') t.reveal = null;
      if (task.k === 'predict') t.peek = null;
      continue;
    }
    if (opts.length === 1 && AUTO_ONE.has(task.k)) { applyChoice(g, task, opts[0]); continue; }
    t.pending = Object.assign({}, task, { opts });
    break;
  }
  if (g.turn !== t || g.phase !== 'play' || t.ended) return;
  if (t.collected && !t.pending && !t.q.length) { t.ended = 'collect'; g.ctx.fx({ type: 'collect', pid: t.pid, n: t.result.n, bonus: t.result.bonus.length }); return endTurn(g); }
  watchAway(g);
  g.ctx.broadcast();
}

const canScan = g => { const t = g.turn; return !!t && !t.ended && !t.collected && !t.pending && !t.q.length && g.deck.length > 0; };
const canCollect = g => { const t = g.turn; return !!t && !t.ended && !t.collected && !t.pending && !t.q.length && t.drawn > 0 && (t.need <= 0 || !g.deck.length); };

/* ---------- moves ---------- */
function pick(g, pid, p) {
  if (g.phase === 'draft') {
    if (p.a !== 'spec' || !g.order.includes(pid)) return { ok: false };
    return chooseSpec(g, pid, String(p.id), String(p.target || '')) ? { ok: true } : { ok: false, error: 'Pick one of your two Specialists.' };
  }
  const t = g.turn;
  if (g.phase !== 'play' || !t || t.pid !== pid) return { ok: false, error: 'It’s not your turn.' };
  if (p.a === 'scan') {
    if (!canScan(g)) return { ok: false };
    drawCard(g, 'scan');
    run(g);
    return { ok: true };
  }
  if (p.a === 'collect') {
    if (!canCollect(g)) return { ok: false, error: t.need > 0 ? `The Leviathan needs ${t.need} more card${t.need > 1 ? 's' : ''} first.` : '' };
    collect(g);
    return { ok: true };
  }
  if (p.a === 'choose') {
    if (!t.pending || !t.pending.opts.includes(String(p.k))) return { ok: false, error: 'That choice doesn’t work here.' };
    applyChoice(g, t.pending, String(p.k));
    run(g);
    return { ok: true };
  }
  return { ok: false };
}

function watchAway(g) {
  if (g.awayTimer) { clearTimeout(g.awayTimer); g.awayTimer = null; }
  if (g.phase !== 'play' || !g.turn || g.turn.ended) return;
  const t = g.turn;
  if (g.ctx.onlineIds().includes(t.pid)) return;
  g.awayTimer = setTimeout(safe(() => {
    g.awayTimer = null;
    if (g.phase !== 'play' || g.turn !== t || t.ended || g.ctx.onlineIds().includes(t.pid)) return;
    autoMove(g, t.pid);
  }), AWAY_MS);
}
/* A sensible move for someone who has dropped out: collect once there are a few cards. */
function autoMove(g, pid) {
  const t = g.turn;
  if (t.pending) return pick(g, pid, { a: 'choose', k: t.pending.opts.includes('return') && g.zone.length >= 2 ? 'return' : pickRandom(t.pending.opts) });
  if (canCollect(g) && (g.zone.length >= 2 || !canScan(g))) return pick(g, pid, { a: 'collect' });
  if (canScan(g)) return pick(g, pid, { a: 'scan' });
  return pick(g, pid, { a: 'collect' });
}
function playersChanged(g) { if (g.phase === 'play') watchAway(g); }
function playerJoined() { /* late arrivals watch until the next game */ }

/* ---------- what each player sees ---------- */
function view(g, viewer) {
  const t = g.turn;
  const vaults = {};
  for (const pid of g.order) vaults[pid] = Object.fromEntries(stacksOf(g, pid).map(e => [e, g.vaults[pid][e].map(pub)]));
  const draft = g.phase === 'draft';
  const byId = id => g.archive.find(c => c.id === id);
  return {
    id: 'ss', settings: g.s, phase: g.phase, order: g.order, copies: g.copies,
    deckLeft: g.deck.length, archive: g.archive.map(pub),
    zone: g.zone.map(z => Object.assign(pub(z.c), { prot: z.prot, src: z.src })),
    vaults,
    scores: Object.fromEntries(g.order.map(p => [p, score(g, p)])),
    // While choosing, you only see your own Specialist (and who has chosen).
    spec: Object.fromEntries(g.order.map(p => [p, draft && p !== viewer ? (g.spec[p] ? '?' : null) : g.spec[p]])),
    custodianOf: draft ? (g.custodianOf[viewer] ? { [viewer]: g.custodianOf[viewer] } : {}) : g.custodianOf,
    offers: draft ? g.offers[viewer] || null : null, draftEnds: g.draftEnds,
    first: g.first === null ? null : g.order[g.first],
    turn: t ? {
      pid: t.pid, drawn: t.drawn, need: t.need, protN: t.protN, ended: t.ended, result: t.result || null,
      pending: t.pending ? { k: t.pending.k, opts: t.pending.opts, count: t.pending.count || 0 } : null,
      reveal: t.reveal ? t.reveal.map(byId).filter(Boolean).map(pub) : null,
      // The Predictor's card is secret: only the player using it sees it.
      peek: t.peek ? (t.pid === viewer ? t.peek.map(id => pub(g.deck.find(c => c.id === id) || { id, e: '?', v: 0 })) : t.peek.length) : null,
      canScan: canScan(g), canCollect: canCollect(g),
      bonusReady: g.zone.some(z => z.c.e === 'key') && g.zone.some(z => z.c.e === 'vault')
    } : null,
    nextAt: g.nextAt, touched: g.touched, log: g.log.slice(-50),
    winners: g.winners, final: g.final, endWhy: g.endWhy
  };
}

module.exports = {
  id: 'ss', name: 'Signal Salvage', minPlayers: 2,
  EMBLEMS, NAMES, SPECIALISTS, PROTOCOLS, defaults, cleanSettings, canStart,
  start, stop, pick, view, playersChanged, playerJoined,
  _score: score, _startTurn: startTurn // for tests
};
