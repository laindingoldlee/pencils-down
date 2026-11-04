/*
 * 咒語大亂鬥 Spellbound Mayhem: what each player sees and clicks (in Traditional Chinese).
 * Rules and scoring live on the server (games/spellbound.js). This page never gets the
 * numbers of your own stones, except ones you peeked at with the Wheel of Fate.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

const SP = [null,
  { name: '孤注一擲', icon: '🎲', color: '#C0392B', short: '擲骰：2–6 其他所有人各失去 2 生命；擲到 1 你自己失去 2 生命。' },
  { name: '雙重吸取', icon: '🩸', color: '#8E2A5A', short: '選兩位玩家各失去 1 生命，你獲得 2 生命。' },
  { name: '鳳凰重生', icon: '🔥', color: '#D9731F', short: '本局下一次你會被擊倒時，改為保留 1 生命。' },
  { name: '詛咒', icon: '💀', color: '#4B3B6B', short: '目標每個回合開始時失去 1 生命，直到他成功施放咒語。' },
  { name: '沉默', icon: '🤫', color: '#3C6E8F', short: '目標跳過他的下一個回合。' },
  { name: '生命連結', icon: '🔗', color: '#2E8C7A', short: '直到你的下個回合，你失去多少生命，被連結的人也失去多少。' },
  { name: '迷霧', icon: '🌫️', color: '#6B6F80', short: '直到你的下個回合，沒有人看得到目標的符石。' },
  { name: '命運輪盤', icon: '🎡', color: '#B8860B', short: '轉動輪盤，看看命運給你什麼（大多是小事）。' },
  { name: '治癒', icon: '💚', color: '#2F8F4E', short: '你獲得 1 生命。' }
];
const WHEEL_TEXT = {
  heal: '你獲得 1 生命', hurt: '你失去 1 生命', left: '左邊的玩家失去 1 生命', right: '右邊的玩家失去 1 生命',
  all: '所有人獲得 1 生命', peek: '偷看了自己的一顆符石', laugh: '什麼都沒發生，輪盤在嘲笑你'
};
const WHEEL_SLICES = ['你獲得 1 生命', '你失去 1 生命', '左邊的玩家失去 1 生命', '右邊的玩家失去 1 生命', '所有人獲得 1 生命', '偷看自己的一顆符石', '什麼都沒發生，輪盤在嘲笑你', '什麼都沒發生，輪盤在嘲笑你'];
const ART = n => `/games/spellbound/art/spell-${n}.webp`;
const FOG_ART = '/games/spellbound/art/fog.webp';
/* The description shown when hovering a spell (or holding it on a phone). */
const describe = n => `${n}. ${SP[n].name}：${SP[n].short}` + (n === 8 ? '\n輪盤（每格 1/8）：\n' + WHEEL_SLICES.map(x => '・' + x).join('\n') : '');
function tipHTML(n) {
  return `<span class="tip" role="tooltip"><b>${n}. ${esc(SP[n].name)}</b>${esc(SP[n].short)}${n === 8 ? `<span class="wheel"><b>輪盤（每格 1/8）</b>${WHEEL_SLICES.map(x => `<span>・${esc(x)}</span>`).join('')}</span>` : ''}</span>`;
}
const L = { targets: [], tkey: '', queue: [], showing: false };
const nm = (pid, st) => (pid === st.you ? '你' : H.nameOf(pid));

/* ---------- host settings (in the room) ---------- */
const SET_LINES = [
  ['stones', '每人符石數', 2, 8], ['lives', '起始生命', 1, 15], ['maxLives', '生命上限', 1, 20], ['target', '目標分數', 1, 50],
  ['killPts', '擊倒別人得分', 0, 10], ['clearPts', '施放全部符石得分', 0, 10], ['selfPts', '有人自己倒下，其他人各得', 0, 10]
];
function stepper(key, val, lo, hi, host) {
  return `<span class="spstep">${host ? `<button type="button" data-act="sp-set" data-k="${key}|-1" ${val <= lo ? 'disabled' : ''} aria-label="減少">−</button>` : ''}<output>${val}</output>${host ? `<button type="button" data-act="sp-set" data-k="${key}|1" ${val >= hi ? 'disabled' : ''} aria-label="增加">+</button>` : ''}</span>`;
}
function settings(st) {
  const host = H.isHost();
  const s = st.settings.spell;
  const total = s.copies.reduce((a, b) => a + b, 0);
  const online = st.players.filter(p => p.connected).length;
  const need = online * s.stones;
  return `
  <div class="setting stack" lang="zh-Hant"><span class="label">遊戲設定</span>
    <div class="spset">${SET_LINES.map(([k, label, lo, hi]) => `<div class="line"><span>${label}</span>${stepper(k, s[k], k === 'maxLives' ? s.lives : lo, hi, host)}</div>`).join('')}</div></div>
  <div class="setting stack" lang="zh-Hant"><span class="label">每種咒語的數量 <small class="muted" style="font-weight:400">共 ${total} 顆${total < need ? `，<b style="color:var(--danger)">不夠 ${online} 人用（需要 ${need} 顆）</b>` : ''}</small></span>
    <div class="spset">${SP.slice(1).map((sp, i) => `<div class="line"><span>${i + 1}. ${sp.icon} ${sp.name}</span>${stepper('copies.' + i, s.copies[i], 0, 15, host)}</div>`).join('')}</div></div>
  <div class="setting" lang="zh-Hant"><span class="label">由小到大猜<br><small class="muted" style="font-weight:400">同一回合裡，下一個猜的數字不能比上一次施放的小</small></span>
    <div class="t7set">${tog('ascending', s.ascending, host)}</div></div>
  <div class="setting" lang="zh-Hant"><span class="label">顯示「可能數量」提示<br><small class="muted" style="font-weight:400">關閉時，大家要自己算</small></span>
    <div class="t7set">${tog('showOdds', s.showOdds, host)}</div></div>
  <div class="setting stack" lang="zh-Hant"><span class="label">玩法</span>${rulesList(s)}</div>`;
}
function tog(key, on, host) {
  return `<button type="button" data-act="sp-tog" data-k="${key}|0" aria-pressed="${!on}" ${host ? '' : 'disabled'}>關</button><button type="button" data-act="sp-tog" data-k="${key}|1" aria-pressed="${!!on}" ${host ? '' : 'disabled'}>開</button>`;
}
H.on('sp-tog', (b, k) => {
  const [key, v] = k.split('|');
  H.st.settings.spell[key] = v === '1';
  H.render();
  H.emit('settings', { game: 'spell', patch: { [key]: v === '1' } });
});
function rulesList(s) {
  return `<ul class="rules">
    <li>每人有 ${s.stones} 顆符石。你看得到別人的符石，卻看不到自己的。</li>
    <li>輪到你時，說出一個你覺得自己有的咒語。猜對就施放，還可以繼續；猜錯失去 1 生命，回合結束。</li>
    ${s.ascending ? '<li>同一回合要由小到大猜：可以 3、5、6、8，但猜了 6 之後不能回頭猜 3（同一個數字可以再猜）。</li>' : ''}
    <li>回合結束時補滿符石。至少要施放一次才能主動結束回合。</li>
    <li>有人倒下，或有人把手上的符石全部施放完，這一局就結束。</li>
    <li>擊倒別人得 ${s.killPts} 分，被擊倒的人 0 分。自己倒下（猜錯、自己的骰子或輪盤），其他人各得 ${s.selfPts} 分。施放完全部符石得 ${s.clearPts} 分。</li>
    <li>每局重新開始，生命回到 ${s.lives}。先拿到 ${s.target} 分的人獲勝。</li>
  </ul>`;
}
H.on('sp-set', (b, k) => {
  const st = H.st, s = st.settings.spell;
  const [key, d] = k.split('|');
  const patch = {};
  if (key.startsWith('copies.')) {
    const i = Number(key.split('.')[1]);
    const c = s.copies.slice(); c[i] = Math.max(0, Math.min(15, c[i] + Number(d)));
    patch.copies = c; s.copies = c;
  } else {
    const line = SET_LINES.find(x => x[0] === key);
    patch[key] = Math.max(key === 'maxLives' ? s.lives : line[2], Math.min(line[3], s[key] + Number(d)));
    s[key] = patch[key];
    if (key === 'lives' && s.maxLives < s.lives) { s.maxLives = s.lives; patch.maxLives = s.lives; }
  }
  H.render();
  H.emit('settings', { game: 'spell', patch });
});

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('sp-cast', (b, k) => {
  if (Date.now() < (L.noCastUntil || 0)) return; // that was a long press to read the description
  b.disabled = true; move({ a: 'cast', spell: Number(k) });
});
/* Phones have no hover: holding a spell shows its description instead of casting it. */
document.addEventListener('pointerdown', e => {
  const b = e.target.closest && e.target.closest('.sp .spellcard');
  if (!b || e.pointerType === 'mouse') return;
  clearTimeout(L.press);
  L.press = setTimeout(() => {
    document.querySelectorAll('.sp .spellcard.tipon').forEach(x => x.classList.remove('tipon'));
    b.classList.add('tipon');
    L.noCastUntil = Date.now() + 800;
  }, 450);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => clearTimeout(L.press), true));
document.addEventListener('pointerdown', e => {
  if (!(e.target.closest && e.target.closest('.sp .spellcard'))) document.querySelectorAll('.sp .spellcard.tipon').forEach(x => x.classList.remove('tipon'));
}, true);
H.on('sp-end', b => { b.disabled = true; move({ a: 'end' }); });
H.on('sp-target', (b, k) => {
  const g = H.st.game;
  const want = g.turn.spell === 2 ? Math.min(2, g.order.length - 1) : 1;
  if (want === 1) { L.targets = [k]; move({ a: 'target', targets: [k] }); return; }
  L.targets = L.targets.includes(k) ? L.targets.filter(x => x !== k) : [...L.targets, k].slice(-want);
  if (L.targets.length === want) move({ a: 'target', targets: L.targets.slice() });
  else H.render();
});

/* ---------- drawing ---------- */
function stoneHTML(n, opts) {
  const o = opts || {};
  if (o.fog) return `<span class="stone back fogged" title="迷霧中，看不到"><img src="${FOG_ART}" alt="迷霧"></span>`;
  if (n == null) return '<span class="stone back" title="看不到"><span>?</span></span>';
  return `<span class="stone art${o.known ? ' known' : ''}" title="${esc(describe(n))}"><img src="${ART(n)}" alt="${n}. ${esc(SP[n].name)}"></span>`;
}
function hearts(n, max) {
  let h = '';
  for (let i = 0; i < Math.max(n, max); i++) h += i < n ? '<span>❤️</span>' : '<span class="gone">🖤</span>';
  return `<span class="hearts" aria-label="${n} 生命">${h}</span>`;
}
function tokens(g, pid, st) {
  const s = g.status[pid];
  const out = [];
  if (s.phoenix) out.push('🔥 鳳凰');
  if (s.curse) out.push(`💀 被 ${esc(nm(s.curse, st))} 詛咒`);
  if (s.silenced) out.push('🤫 下回合沉默');
  if (s.link) out.push(`🔗 連結 ${esc(nm(s.link, st))}`);
  if (s.fog) out.push('🌫️ 迷霧');
  return out.length ? `<div class="tokens">${out.map(x => `<span>${x}</span>`).join('')}</div>` : '';
}
function seat(g, pid, st) {
  const t = g.turn;
  const isMe = pid === st.you;
  const fog = !!g.status[pid].fog && g.phase === 'play';
  const stones = g.racks[pid].map(x => isMe
    ? stoneHTML(x.n, { known: x.n != null && g.phase === 'play' })
    : stoneHTML(x.n, { fog: fog && x.n == null }));
  return `<div class="spseat${t && t.pid === pid ? ' turn' : ''}${g.lives[pid] <= 0 ? ' out' : ''}${isMe ? ' me' : ''}" data-seat="${esc(pid)}">
    <div class="sphead">${H.avatar(pid, isMe ? 34 : 28)}<span class="nm">${esc(isMe ? '你' : H.nameOf(pid))}<small>${t && t.pid === pid ? '施法中…' : ''}</small></span><span class="score">⭐ ${g.scores[pid]}</span></div>
    ${hearts(g.lives[pid], g.settings.maxLives)}
    ${tokens(g, pid, st)}
    <div class="stones">${stones.join('') || '<span class="muted">（沒有符石）</span>'}</div>
  </div>`;
}

/* How many of each spell could still be in your rack: total, minus the ones you can see. */
function odds(g, st) {
  const seen = Array(10).fill(0);
  for (const pid of g.order) if (pid !== st.you) for (const x of g.racks[pid]) if (x.n != null) seen[x.n]++;
  for (const n of g.discard) seen[n]++;
  const known = Array(10).fill(0);
  for (const x of g.racks[st.you] || []) if (x.n != null) known[x.n]++;
  const hidden = g.order.some(pid => pid !== st.you && g.racks[pid].some(x => x.n == null));
  return { left: n => Math.max(0, g.settings.copies[n - 1] - seen[n]), known, hidden };
}

function render(main, st) {
  const g = st.game;
  H.S.built = 'spell:' + st.code;
  const me = st.you;
  const playing = g.order.includes(me);
  // Seats go round the table: you at the bottom, the others clockwise in turn order.
  const i0 = g.order.indexOf(me);
  const around = playing ? [...g.order.slice(i0), ...g.order.slice(0, i0)] : g.order;
  const n = around.length;
  const narrow = window.innerWidth < 620;
  const cols = narrow && n >= 3;
  const leftN = Math.ceil((n - 1) / 2), rightN = n - 1 - leftN;
  const spotAt = i => {
    if (!cols) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [50 + (narrow ? 30 : 40) * Math.cos(a), 50 + (narrow ? 41 : 39) * Math.sin(a)];
    }
    if (i === 0) return [50, 86];
    const rows = Math.max(leftN, rightN);
    const yOf = j => (rows === 1 ? 40 : 68 - (j * 56) / (rows - 1));
    if (i <= leftN) return [26, yOf(i - 1)];
    return [74, yOf(rows - 1 - (i - 1 - leftN))];
  };
  const size = n <= 4 ? 'few' : n <= 6 ? 'some' : 'many';
  const seats = around.map((pid, i) => {
    const [x, y] = spotAt(i);
    return `<div class="spspot${pid === me ? ' mine' : ''}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">${seat(g, pid, st)}</div>`;
  }).join('');
  const recent = g.discard.slice(-5);
  const center = `<div class="sp-center${cols ? ' out' : ''}">
      <div class="sp-pile"><span class="stone back"><span>?</span></span><span><b>${g.pileLeft}</b><small>牌堆剩下</small></span></div>
      <div class="sp-cast"><small>這局施放過</small><span class="row">${recent.length ? recent.map(x => stoneHTML(x)).join('') : '<span class="muted">還沒有</span>'}</span></div>
    </div>`;
  H.keepFocus(main, () => {
    main.innerHTML = `<section class="sp" lang="zh-Hant" aria-label="咒語大亂鬥">
      <div class="sp-top"><div class="sp-title">咒語大亂鬥 <small>第 ${g.round} 局 · 先到 ${g.settings.target} 分獲勝</small></div>
        ${H.dd('sp-log', '戰況紀錄', `<ol>${g.log.slice().reverse().map(e => `<li>${logLine(e, st)}</li>`).join('')}</ol>`, 'sp-log')}
        ${H.dd('sp-rules', '玩法說明', rulesList(g.settings) + `<ul>${SP.slice(1).map((sp, i) => `<li><b>${i + 1}. ${sp.name}</b>（${g.settings.copies[i]} 顆）：${sp.short}${i === 7 ? `<br>輪盤（每格 1/8）：${WHEEL_SLICES.join('、')}` : ''}</li>`).join('')}</ul>`, 'sp-rules')}
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? '再按一次結束' : '結束遊戲'}</button>` : ''}</div>
      ${cols ? center : ''}
      <div class="sp-round ${size}${cols ? ' cols' : ''}">
        <div class="sp-felt" aria-hidden="true"></div>
        ${cols ? '' : center}
        ${seats}
      </div>
      ${playing ? '' : '<p class="muted" style="margin:0">你在遊戲開始後才加入，這一場先觀戰。</p>'}
      ${actHTML(g, st)}
    </section>`;
  });
}

function actHTML(g, st) {
  const me = st.you, t = g.turn;
  if (g.phase === 'roundEnd' || g.phase === 'over') return summaryHTML(g, st);
  if (!t) return '';
  const who = esc(nm(t.pid, st));
  if (t.pid !== me) {
    if (t.step === 'target') return `<div class="sp-act"><h3>${who}施放了 ${SP[t.spell].icon} ${SP[t.spell].name}，正在選目標…</h3></div>`;
    return `<div class="sp-act"><h3>輪到 ${who}</h3><p class="muted">${t.casts ? `已施放 ${t.casts} 次，可能繼續…` : '思考中…'}</p></div>`;
  }
  if (t.step === 'target') {
    const sp = SP[t.spell];
    const want = t.spell === 2 ? Math.min(2, g.order.length - 1) : 1;
    const key = `${g.round}:${t.pid}:${t.casts}:${g.discard.length}`; // a fresh choice for every cast
    if (L.tkey !== key) { L.tkey = key; L.targets = []; }
    return `<div class="sp-act"><h3>${sp.icon} ${sp.name}：選${want === 2 ? '兩位' : '一位'}目標</h3><p class="muted">${sp.short}</p>
      <div class="targets">${g.order.filter(p => p !== me).map(p => `<button type="button" data-act="sp-target" data-k="${esc(p)}" aria-pressed="${L.targets.includes(p)}">${H.avatar(p, 28)}${esc(H.nameOf(p))}</button>`).join('')}</div></div>`;
  }
  const showOdds = g.settings.showOdds;
  const o = odds(g, st);
  const floor = g.settings.ascending ? t.last || 0 : 0;
  return `<div class="sp-act">
    <h3>${t.casts ? `猜對了！已施放 ${t.casts} 次。要繼續嗎？` : '輪到你了！你覺得自己有哪一顆符石？'}</h3>
    <p class="muted">猜錯會失去 1 生命並結束回合。${floor ? `這回合已經施放了 ${floor}，只能猜 ${floor} 或更大的數字。` : ''}<span class="hint-hover">把滑鼠移到咒語上可以看說明。</span><span class="hint-touch">按住咒語可以看說明。</span></p>
    <div class="spells">${SP.slice(1).map((sp, i) => {
      const n = i + 1, low = n < floor;
      const left = o.left(n);
      const badge = showOdds ? `<span class="odds">可能 ${left}${o.known[n] ? ` · 確定 ${o.known[n]}` : ''}</span>` : '';
      return `<button type="button" class="spellcard${low ? ' low' : ''}" data-act="sp-cast" data-k="${n}" aria-label="${n}. ${esc(sp.name)}：${esc(sp.short)}" ${low ? 'disabled' : ''}><img src="${ART(n)}" alt="">${badge}${tipHTML(n)}</button>`;
    }).join('')}</div>
    ${t.casts ? '<div class="row"><button type="button" class="btn" data-act="sp-end">結束回合，補充符石</button></div>' : ''}
  </div>`;
}

function summaryHTML(g, st) {
  const s = g.summary;
  const lines = [];
  if (s) {
    for (const d of s.deaths) {
      if (d.by && d.by !== d.pid) lines.push(`💀 ${esc(nm(d.pid, st))}被 ${esc(nm(d.by, st))}擊倒 → ${esc(nm(d.by, st))} +${g.settings.killPts}`);
      else lines.push(`💀 ${esc(nm(d.pid, st))}自己倒下了 → 其他人各 +${g.settings.selfPts}`);
    }
    if (s.cleared) lines.push(`✨ ${esc(nm(s.cleared, st))}施放完全部符石 → +${g.settings.clearPts}`);
  }
  const ranked = g.order.slice().sort((a, b) => g.scores[b] - g.scores[a]);
  let place = 0, prev = null;
  const board = ranked.map((pid, i) => {
    if (g.scores[pid] !== prev) { place = i + 1; prev = g.scores[pid]; }
    const gain = s && s.pts[pid] ? `<span class="gain">+${s.pts[pid]}</span>` : '';
    return `<li><span class="pl">${place}</span>${H.avatar(pid, 30)}<span>${esc(nm(pid, st))}${gain}</span><span class="pt">${g.scores[pid]}</span></li>`;
  }).join('');
  if (g.phase === 'over') {
    const w = (g.winners || []).map(p => esc(nm(p, st)));
    return `<div class="sp-act"><div class="sp-winner">🏆 ${w.join('、')} 獲勝！</div>
      <ul class="sp-sum">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
      <ol class="sp-board">${board}</ol>
      <div class="row">${H.isHost()
        ? '<button type="button" class="btn primary big" data-act="again">再玩一次</button><button type="button" class="btn" data-act="toRoomNow">回到房間</button>'
        : `<span class="muted">等待 ${esc(H.nameOf(st.hostPid))} 決定下一步。</span>`}</div></div>`;
  }
  const secs = Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000));
  return `<div class="sp-act"><h3>第 ${g.round} 局結束</h3>
    <ul class="sp-sum">${lines.map(l => `<li>${l}</li>`).join('')}</ul>
    <ol class="sp-board">${board}</ol>
    <p class="muted">下一局在 <span id="spNext">${secs}</span> 秒後開始。大家的符石已經翻開。</p></div>`;
}

function logLine(e, st) {
  const p = esc(nm(e.pid, st));
  switch (e.k) {
    case 'round': return `<b>第 ${e.n} 局開始</b>`;
    case 'cast': return `${p}施放了 ${SP[e.n].icon} ${SP[e.n].name}`;
    case 'miss': return `${p}猜 ${SP[e.n].icon} ${SP[e.n].name}，猜錯了，失去 1 生命`;
    case 'target': return `　→ 目標：${e.targets.map(x => esc(nm(x, st))).join('、')}`;
    case 'dice': return `　→ 🎲 擲出 ${e.roll}${e.roll === 1 ? '，自己失去 2 生命！' : '，其他人各失去 2 生命！'}`;
    case 'wheel': return `　→ 🎡 ${WHEEL_TEXT[e.w]}${e.w === 'left' ? `（${esc(nm(e.left, st))}）` : e.w === 'right' ? `（${esc(nm(e.right, st))}）` : ''}`;
    case 'phoenix': return `🔥 ${p}鳳凰重生，保住 1 生命！`;
    case 'dead': return `💀 ${p}倒下了${e.by ? `（${esc(nm(e.by, st))}）` : ''}`;
    case 'curse-tick': return `💀 ${p}受到詛咒，失去 1 生命`;
    case 'silenced': return `🤫 ${p}被沉默，跳過回合`;
    case 'end': return `${p}結束回合`;
    case 'away': return `${p}不在，回合跳過`;
    case 'over': return `<b>🏆 ${e.pids.map(x => esc(nm(x, st))).join('、')} 獲勝！</b>`;
  }
  return '';
}

/* ---------- announcements ---------- */
function banner(html, red) {
  L.queue.push({ html, red });
  if (!L.showing) showNext();
}
function showNext() {
  const b = L.queue.shift();
  if (!b) { L.showing = false; return; }
  L.showing = true;
  document.querySelectorAll('.sp-banner').forEach(e => e.remove());
  const el = document.createElement('div');
  el.className = 'sp-banner' + (b.red ? ' red' : '');
  el.setAttribute('lang', 'zh-Hant');
  el.innerHTML = b.html;
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, L.queue.length > 2 ? 800 : 1300);
}
function fx(e) {
  const st = H.st;
  if (!st) return;
  const p = esc(nm(e.pid, st));
  if (e.type === 'cast') banner(`${SP[e.n].icon} ${SP[e.n].name}！<small>${p}施放成功</small>`);
  else if (e.type === 'miss') banner(`猜錯了！<small>${p}沒有 ${SP[e.n].icon} ${SP[e.n].name}，失去 1 生命</small>`, true);
  else if (e.type === 'dice') banner(`🎲 擲出 ${e.roll}！<small>${e.roll === 1 ? `${p}自己失去 2 生命` : '其他人各失去 2 生命'}</small>`, e.roll === 1);
  else if (e.type === 'wheel') banner(`🎡 ${WHEEL_TEXT[e.w]}${e.w === 'laugh' ? ' 😂' : ''}`);
  else if (e.type === 'phoenix') banner(`🔥 鳳凰重生！<small>${p}保住 1 生命</small>`);
  else if (e.type === 'silenced') banner(`🤫 ${p}被沉默<small>跳過這個回合</small>`);
  else if (e.type === 'dead') banner(`💀 ${p}倒下了！${e.by ? `<small>${esc(nm(e.by, st))} 擊倒了 ${p}</small>` : '<small>自己倒下</small>'}`, true);
  else if (e.type === 'hurt') {
    setTimeout(() => {
      const el = document.querySelector(`.spseat[data-seat="${CSS.escape(e.pid)}"]`);
      if (el) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
    }, 60);
  }
}

Hub.registerGame('spell', {
  title: '咒語大亂鬥',
  settings,
  render,
  fx: e => fx(e),
  tick(st) {
    const g = st.game;
    if (g && g.phase === 'roundEnd') H.setText('spNext', String(Math.max(0, Math.ceil((g.nextRoundAt - H.now()) / 1000))));
  }
});
})();
