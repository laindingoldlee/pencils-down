/*
 * Signal Salvage: what each player sees and clicks.
 * Rules live on the server (games/signal-salvage.js). Everything on the table is public
 * except the order of the scanning deck and a Predictor's secret look at its top card.
 *
 * Art: any file in public/games/ss/art/ named after an emblem (shield.svg), the card back
 * (back.png), the table (background.jpg), the logo (logo.svg), the Starting Crew card (crew.png),
 * a Specialist (void-angler.png) or a Mission Protocol (signal-thieves.png) replaces its placeholder.
 */
(() => {
'use strict';
const H = Hub.api;
const esc = H.esc;

/* The ten emblems: placeholder icon, color and what the ability does. */
const EM = {
  shield: { name: 'Shield', color: '#4FA3FF', short: 'Protects earlier cards',
    text: 'Protects every card added to the scan zone before it. If the run collapses later, those cards are banked anyway.',
    icon: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>' },
  grapple: { name: 'Grapple', color: '#F2994A', short: 'Pull from your vault',
    text: 'Move the top card of one of your own vault stacks into the scan zone. You must, if you have any.',
    icon: '<path d="M12 2v11"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M5 11l-2.5-2.5M19 11l2.5-2.5"/><path d="M9 4h6"/>' },
  pulse: { name: 'Pulse', color: '#EB5757', short: 'Blast a rival stack',
    text: 'Send the top card of a stack in another player’s vault to the signal archive.',
    icon: '<circle cx="12" cy="12" r="2.2"/><path d="M8 8a5.6 5.6 0 0 0 0 8M16 8a5.6 5.6 0 0 1 0 8M5 5a9.8 9.8 0 0 0 0 14M19 5a9.8 9.8 0 0 1 0 14"/>' },
  key: { name: 'Access Key', color: '#F2C94C', short: 'Opens the Vault',
    text: 'No effect by itself. Collect with an Access Key and a Vault in the scan zone to get the Vault bonus.',
    icon: '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3.5M21 12v2.5"/>' },
  vault: { name: 'Vault', color: '#B7C3D4', short: 'Bonus with a Key',
    text: 'No effect by itself. Collect with a Vault and an Access Key in the scan zone: take as many bonus cards from the archive as you banked.',
    icon: '<rect x="3" y="4" width="18" height="15" rx="2"/><circle cx="12" cy="11.5" r="3.6"/><path d="M12 7.9v1.2M12 13.9v1.2M8.4 11.5h1.2M14.4 11.5h1.2M6 19v2M18 19v2"/>' },
  map: { name: 'Survey Map', color: '#6FCF97', short: 'Pick from the archive',
    text: 'Reveal up to three cards from the signal archive and add one of them to the scan zone. You must pick one.',
    icon: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>' },
  predictor: { name: 'Predictor', color: '#BB6BD9', short: 'Peek at the next card',
    text: 'Secretly look at the top card of the scanning deck. Add it to the scan zone, or put it back and collect.',
    icon: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  breach: { name: 'Breach', color: '#FF7AB6', short: 'Steal from a rival',
    text: 'Take the top card of a stack in another player’s vault and add it to your scan zone. It must be an emblem you don’t have in your vault.',
    icon: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
  leviathan: { name: 'Leviathan', color: '#2EC4B6', short: 'Two more before you collect',
    text: 'You must add at least two more cards to the scan zone before you can collect.',
    icon: '<path d="M6 21c-2.5-6 0-12.5 6-15.2 3-1.3 6.2.2 6.2 3.2s-3 4.2-5 3.2-1.4-3 .3-2.8"/><circle cx="8.6" cy="15" r=".9"/><circle cx="10.4" cy="11" r=".9"/><circle cx="13.2" cy="8.2" r=".9"/>' },
  aurora: { name: 'Aurora', color: '#C9F8FF', short: 'Worth 4 to 9',
    text: 'No ability in the standard game. Aurora cards are worth 4 to 9 instead of 2 to 7.',
    textVariant: 'Aurora Protocol: choose a card already in the scan zone, move it beside the Aurora and use its ability again.',
    icon: '<path d="M12 2l2.2 6.8L21 11l-6.8 2.2L12 20l-2.2-6.8L3 11l6.8-2.2z"/><path d="M19 3l.8 2.2L22 6l-2.2.8L19 9l-.8-2.2L16 6l2.2-.8z"/>' }
};
const ORDER = ['shield', 'grapple', 'pulse', 'key', 'vault', 'map', 'predictor', 'breach', 'leviathan', 'aurora'];
const L = { lastHTML: '', newAt: {}, zoneKey: '', flashSeq: 0, flashAt: 0, flashIds: [], queue: [], showing: false, specPick: null };

const cat = () => H.catalog.ss || { specialists: [], protocols: [], art: {} };
const art = k => (cat().art || {})[k] || '';
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const specOf = id => cat().specialists.find(s => s.id === id);
const protoOf = id => cat().protocols.find(p => p.id === id);
const specArt = s => s ? art(slug(s.name)) || art(s.id) : '';
const nm = pid => (pid === H.st.you ? 'You' : H.nameOf(pid));
const poss = pid => (pid === H.st.you ? 'your' : esc(H.nameOf(pid)) + '’s');
const emText = (e, g) => (e === 'aurora' && g && g.settings.aurora ? EM.aurora.textVariant : EM[e].text);

/* ---------- drawing ---------- */
function icon(e) {
  const src = art(e);
  if (src) return `<img class="ssi" src="${esc(src)}" alt="" draggable="false">`;
  return `<svg class="ssi" viewBox="0 0 24 24" aria-hidden="true">${EM[e].icon}</svg>`;
}
function cardHTML(c, o) {
  o = o || {};
  const e = EM[c.e];
  if (!e) return backHTML(o);
  const cls = ['ssc', 'e-' + c.e];
  for (const k of ['size', 'state']) if (o[k]) cls.push(o[k]);
  if (o.prot) cls.push('prot');
  if (o.pick) cls.push('pick');
  if (o.isNew) cls.push('new');
  if (o.flash) cls.push('flash');
  const tag = o.act ? 'button' : 'span';
  const attrs = o.act ? ` type="button" data-act="${o.act}" data-k="${esc(o.k)}"` : '';
  const g = H.st && H.st.game;
  // Big cards show the full illustration; small ones (vault stacks) just the emblem.
  const face = o.size !== 'sm' && art('face-' + c.e);
  if (face) cls.push('art');
  return `<${tag} class="${cls.join(' ')}" style="--c:${e.color}${face ? `;--face:url('${esc(face)}')` : ''}"${attrs} title="${esc(e.name)} ${c.v}: ${esc(emText(c.e, g))}" aria-label="${esc(e.name)} ${c.v}${o.prot ? ', protected' : ''}">
    <span class="v">${c.v}</span>${face ? '<span></span>' : icon(c.e)}<span class="n">${esc(e.name)}</span>${o.prot ? '<span class="shieldtag" aria-hidden="true">🛡</span>' : ''}</${tag}>`;
}
function backHTML(o) {
  o = o || {};
  const src = art('back');
  return `<span class="ssc back${o.size ? ' ' + o.size : ''}" aria-label="Face-down card">${src ? `<img src="${esc(src)}" alt="">` : '<span class="sig" aria-hidden="true"><i></i><i></i><i></i></span>'}</span>`;
}
const mini = c => `<span class="ssmini" style="--c:${EM[c.e].color}" title="${esc(EM[c.e].name)} ${c.v}">${icon(c.e)}<b>${c.v}</b></span>`;

/* ---------- host settings (in the room) ---------- */
function settings(st) {
  const host = H.isHost();
  const s = st.settings.ss;
  const seg = (k, v, on, label, title) => `<button type="button" data-act="ss-set" data-k="${k}|${v}" aria-pressed="${on}" ${host ? '' : 'disabled'}${title ? ` title="${esc(title)}"` : ''}>${label}</button>`;
  const protos = cat().protocols;
  const pr = protoOf(s.protocol);
  const online = st.players.filter(p => p.connected).length;
  return `
  <div class="setting"><span class="label">Specialists<br><small class="muted" style="font-weight:400">Everyone is dealt two and keeps one, a lasting power. Leave off for a first game.</small></span>
    <div class="t7set">${seg('specialists', 0, !s.specialists, 'Off')}${seg('specialists', 1, s.specialists, 'On')}</div></div>
  <div class="setting stack"><span class="label">Mission Protocol <small class="muted" style="font-weight:400">changes the scoring or how you win. Pick one or none.</small></span>
    <div class="t7set">${seg('protocol', 'none', s.protocol === 'none', 'None')}${protos.map(p => seg('protocol', p.id, s.protocol === p.id, esc(p.name), p.text)).join('')}</div>
    ${pr ? `<p class="muted ss-prdesc" style="margin:0">${art(slug(pr.name)) ? `<img src="${esc(art(slug(pr.name)))}" alt="">` : ''}<span><b>${esc(pr.name)}:</b> ${esc(pr.text)}</span></p>` : ''}</div>
  <div class="setting"><span class="label">Aurora Protocol variant<br><small class="muted" style="font-weight:400">An Aurora picks a card already in the scan zone and uses its ability again.</small></span>
    <div class="t7set">${seg('aurora', 0, !s.aurora, 'Off')}${seg('aurora', 1, s.aurora, 'On')}</div></div>
  ${online > 4 ? `<div class="setting"><span class="label">Large crew</span><span class="muted">${online} players: two decks are shuffled together (100 to scan, 20 in the archive).</span></div>` : ''}
  <div class="setting stack"><span class="label">How to play</span>${rulesList(s)}</div>`;
}
function rulesList(s) {
  return `<ul class="rules">
    <li>On your turn, scan the top card of the deck into the scan zone. A new emblem’s ability happens right away.</li>
    <li>Keep scanning, or <b>collect</b>: everything in the scan zone goes into your vault, stacked by emblem.</li>
    <li>Scan an emblem that’s already in the scan zone${s && s.protocol === 'pattern' ? ' (or a number that’s already there)' : ''} and the run <b>collapses</b>: those cards go to the signal archive, except any a Shield protected.</li>
    <li>Collect with an Access Key and a Vault in the scan zone to take as many bonus cards from the archive as you banked.</li>
    <li>When the last card is scanned, that turn finishes and the game ends. Only the top (highest) card of each vault stack scores${s && s.protocol === 'total' ? ' (Total Recovery: every card scores)' : ''}. A tie goes to whoever has more cards.</li>
  </ul>`;
}
function setSS(patch) {
  Object.assign(H.st.settings.ss, patch);
  H.render();
  H.emit('settings', { game: 'ss', patch });
}
H.on('ss-set', (b, k) => {
  const [key, v] = k.split('|');
  setSS({ [key]: key === 'protocol' ? v : v === '1' });
});

/* ---------- moves ---------- */
async function move(p) {
  const r = await H.emit('pick', p);
  if (!r.ok && r.error) H.toast(r.error);
  return r;
}
H.on('ss-scan', b => { b.disabled = true; move({ a: 'scan' }); });
H.on('ss-collect', b => { b.disabled = true; move({ a: 'collect' }); });
H.on('ss-choose', (b, k) => { b.disabled = true; move({ a: 'choose', k }); });
H.on('ss-spec', (b, k) => {
  if (k === 'custodian') { L.specPick = k; return H.render(); }
  b.disabled = true; move({ a: 'spec', id: k });
});
H.on('ss-target', (b, k) => { b.disabled = true; move({ a: 'spec', id: 'custodian', target: k }); L.specPick = null; });
H.on('ss-spec-back', () => { L.specPick = null; H.render(); });
document.addEventListener('keydown', e => {
  const g = H.st && H.st.game;
  if (!g || g.id !== 'ss' || e.target !== document.body || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = g.turn;
  if (!t || t.pid !== H.st.you) return;
  if ((e.key === ' ' || e.key === 's') && t.canScan) { e.preventDefault(); move({ a: 'scan' }); }
  if ((e.key === 'c' || e.key === 'Enter') && t.canCollect) { e.preventDefault(); move({ a: 'collect' }); }
});

/* ---------- rendering ---------- */
function render(main, st) {
  const g = st.game;
  H.S.built = 'ss:' + st.code;
  if (g.touched && g.touched.seq !== L.flashSeq) { L.flashSeq = g.touched.seq; L.flashAt = Date.now(); L.flashIds = g.touched.ids; }
  const bg = art('background');
  const logo = art('logo');
  const html = `<section class="ss" aria-label="Signal Salvage"${bg ? ` style="--bgimg:url('${esc(bg)}')"` : ''}>
      <div class="ss-top">
        <div class="ss-title">${logo ? `<img src="${esc(logo)}" alt="Signal Salvage: The Last Signal">` : 'Signal Salvage<small>The Last Signal</small>'}</div>
        ${g.settings.protocol !== 'none' && protoOf(g.settings.protocol) ? `<span class="ss-chip" title="${esc(protoOf(g.settings.protocol).text)}">${art(slug(protoOf(g.settings.protocol).name)) ? `<img src="${esc(art(slug(protoOf(g.settings.protocol).name)))}" alt="">` : '📡'} ${esc(protoOf(g.settings.protocol).name)}</span>` : ''}
        ${g.settings.aurora ? '<span class="ss-chip" title="An Aurora picks a card in the scan zone and uses its ability again.">✦ Aurora Protocol</span>' : ''}
        ${H.dd('ss-log', 'What happened', `<ol>${g.log.slice().reverse().map(e => logLine(e, st)).filter(Boolean).map(x => `<li>${x}</li>`).join('')}</ol>`, 'ss-log')}
        ${H.dd('ss-rules', 'How to play', rulesList(g.settings) + `<ul class="ss-emlist">${ORDER.map(e => `<li>${mini({ e, v: '' })}<span><b>${esc(EM[e].name)}</b>: ${esc(emText(e, g))}</span></li>`).join('')}</ul>`, 'ss-rules')}
        ${H.isHost() && g.phase !== 'over' ? `<button type="button" class="linkbtn${H.armed('toRoom') ? ' armed' : ''}" data-act="toRoom">${H.armed('toRoom') ? 'Tap again to end' : 'End game'}</button>` : ''}
      </div>
      ${g.phase === 'draft' ? draftHTML(g, st) : `${stationHTML(g, st)}${actHTML(g, st)}${vaultsHTML(g, st)}`}
      ${g.order.includes(st.you) ? '' : '<p class="muted" style="margin:0">You joined after this game started, so you’re watching this one.</p>'}
    </section>`;
  if (html === L.lastHTML && main.querySelector('.ss')) return;
  L.lastHTML = html;
  H.keepFocus(main, () => { main.innerHTML = html; });
}

/* Specialist choice at the start. */
function specCard(s, o) {
  o = o || {};
  const src = specArt(s);
  const tag = o.act ? 'button' : 'div';
  return `<${tag} class="ss-spec${o.small ? ' small' : ''}"${o.act ? ` type="button" data-act="${o.act}" data-k="${esc(s.id)}"` : ''}>
    ${src ? `<img src="${esc(src)}" alt="">` : `<span class="ph" aria-hidden="true">${esc(s.name.split(' ').map(w => w[0]).join(''))}</span>`}
    <b>${esc(s.name)}</b><span>${esc(s.text)}</span></${tag}>`;
}
function draftHTML(g, st) {
  const me = st.you;
  const left = Math.max(0, Math.ceil((g.draftEnds - H.now()) / 1000));
  const done = g.order.filter(p => g.spec[p]).length;
  const progress = `<p class="muted">${done} of ${g.order.length} chosen · <span id="ssLeft">${left}s</span> left, then one is picked at random.</p>
    <div class="ss-who">${g.order.map(p => `<span class="${g.spec[p] ? 'ok' : ''}">${H.avatar(p, 26)}${esc(nm(p))}${g.spec[p] ? ' ✓' : '…'}</span>`).join('')}</div>`;
  if (!g.order.includes(me)) return `<div class="ss-act"><h3>The crew is choosing Specialists…</h3>${progress}</div>`;
  if (g.spec[me]) {
    const s = specOf(g.spec[me]);
    return `<div class="ss-act"><h3>Your Specialist</h3><div class="ss-specs">${s ? specCard(s) : ''}</div>
      ${g.custodianOf[me] ? `<p>You’re watching <b>${esc(H.nameOf(g.custodianOf[me]))}</b>’s runs.</p>` : ''}<h3>Waiting for the rest of the crew…</h3>${progress}</div>`;
  }
  if (L.specPick === 'custodian') {
    return `<div class="ss-act"><h3>Black-Box Custodian: whose collapses do you want?</h3>
      <p class="muted">When that player’s run collapses, you bank their unprotected cards.</p>
      <div class="ss-players">${g.order.filter(p => p !== me).map(p => `<button type="button" data-act="ss-target" data-k="${esc(p)}">${H.avatar(p, 28)}${esc(H.nameOf(p))}</button>`).join('')}</div>
      <div><button type="button" class="linkbtn" data-act="ss-spec-back">Choose the other Specialist instead</button></div>${progress}</div>`;
  }
  return `<div class="ss-act"><h3>Choose your Specialist</h3><p class="muted">Keep one, the other goes back in the box. Its power lasts the whole game and must be used whenever it applies.</p>
    <div class="ss-specs">${(g.offers || []).map(id => specOf(id)).filter(Boolean).map(s => specCard(s, { act: 'ss-spec' })).join('')}</div>${progress}</div>`;
}

/* Deck, scan zone and archive. */
function stationHTML(g, st) {
  const t = g.turn;
  const me = st.you;
  const zoneIds = g.zone.map(z => z.id).join(',');
  const now = Date.now();
  for (const z of g.zone) if (!L.newAt[z.id] && L.zoneKey !== '') L.newAt[z.id] = now;
  if (!g.zone.length) L.newAt = {};
  L.zoneKey = zoneIds || '-';
  const flashing = now - L.flashAt < 1200 ? L.flashIds : [];
  const pickZone = t && t.pid === me && t.pending && t.pending.k === 'aurora' ? t.pending.opts : [];
  let zone;
  if (t && t.ended && t.result) {
    const r = t.result;
    if (r.kind === 'collapse') {
      zone = [...r.kept.map(c => cardHTML(c, { state: 'kept', prot: true })), ...r.lost.map(c => cardHTML(c, { state: c.id === r.dup.id ? 'lost dup' : 'lost' }))].join('');
    } else zone = [...r.cards, ...r.bonus].map(c => cardHTML(c, { state: 'banked' })).join('');
  } else if (g.zone.length) {
    zone = g.zone.map(c => cardHTML(c, {
      prot: c.prot, isNew: now - (L.newAt[c.id] || 0) < 700, flash: flashing.includes(c.id),
      pick: pickZone.includes(String(c.id)), act: pickZone.includes(String(c.id)) ? 'ss-choose' : '', k: c.id
    })).join('');
  } else zone = `<div class="ss-empty">${t && !t.ended ? `${t.pid === me ? 'Scan' : esc(H.nameOf(t.pid)) + ' scans'} to begin the run` : ''}</div>`;
  const flags = [];
  if (t && !t.ended) {
    if (t.need > 0) flags.push(`<span class="flag lev">${icon('leviathan')} Leviathan: ${t.need} more card${t.need > 1 ? 's' : ''} before collecting</span>`);
    if (t.bonusReady) flags.push(`<span class="flag bonus">${icon('key')}${icon('vault')} Vault bonus ready: +${g.zone.length * (g.spec[t.pid] === 'multiplier' ? 2 : 1)} if you collect now</span>`);
    if (t.protN > 0) flags.push(`<span class="flag prot">🛡 Next ${t.protN} card${t.protN > 1 ? 's' : ''} protected</span>`);
  }
  // The archive is face up: group it by emblem so it's easy to read.
  const byE = ORDER.map(e => [e, g.archive.filter(c => c.e === e).sort((a, b) => a.v - b.v)]).filter(([, cs]) => cs.length);
  return `<div class="ss-station">
    <div class="ss-pile"><div class="ss-deck">${g.deckLeft ? backHTML() + (g.deckLeft > 1 ? '<span class="under"></span>' : '') : '<span class="ssc ghost"></span>'}</div>
      <div class="ss-count"><b>${g.deckLeft}</b><small>left in the<br>scanning deck</small></div></div>
    <div class="ss-zone${t && t.ended === 'collapse' ? ' collapsed' : ''}${t && t.ended === 'collect' ? ' collected' : ''}">
      <div class="ss-zlabel">Scan zone${t && !t.ended && g.zone.length ? ` · ${g.zone.length} card${g.zone.length > 1 ? 's' : ''}` : ''}</div>
      <div class="ss-zcards">${zone}</div>
      ${flags.length ? `<div class="ss-flags">${flags.join('')}</div>` : ''}
    </div>
    <div class="ss-archive"><div class="ss-zlabel">Signal archive · ${g.archive.length}</div>
      <div class="ss-arch">${byE.length ? byE.map(([e, cs]) => `<span class="grp" style="--c:${EM[e].color}" title="${esc(EM[e].name)}: ${cs.map(c => c.v).join(', ')}">${icon(e)}${cs.map(c => `<b>${c.v}</b>`).join('')}</span>`).join('') : '<span class="muted">Empty</span>'}</div></div>
  </div>`;
}

const PROMPT = {
  grapple: ['Grapple', 'Tap one of your vault stacks. Its top card moves into the scan zone.'],
  backfire: ['Backfire', 'An opponent’s Backfire Specialist hit back: tap one of your vault stacks to discard its top card.'],
  pulse: ['Pulse', 'Tap a stack in another player’s vault to blast its top card into the archive.'],
  breach: ['Breach', 'Tap a stack in another player’s vault to take its top card into your scan zone.'],
  map: ['Survey Map', 'Pick one of these archive cards to add to the scan zone.'],
  predict: ['Predictor', 'Only you can see this card.'],
  aurora: ['Aurora Protocol', 'Tap a card in the scan zone. It moves beside the Aurora and its ability happens again.'],
  raider: ['Data Raider', 'Pick whose vault your bonus cards come from.']
};
function actHTML(g, st) {
  const me = st.you, t = g.turn;
  if (g.phase === 'over') return finalHTML(g, st);
  if (!t) return '';
  const who = esc(nm(t.pid));
  const spec = g.spec[t.pid] && specOf(g.spec[t.pid]);
  if (t.ended) {
    const r = t.result || {};
    const secs = Math.max(0, Math.ceil((g.nextAt - H.now()) / 1000));
    let h;
    if (r.kind === 'collapse') {
      const to = r.to ? `to ${esc(nm(r.to))}` : 'to the archive';
      h = `<h3 class="bad">💥 Run collapsed: a second ${esc(EM[r.dup.e].name)}</h3><p>${r.lost.length} card${r.lost.length === 1 ? '' : 's'} lost ${to}${r.kept.length ? `, ${r.kept.length} protected and banked by ${who}` : ''}.</p>`;
    } else {
      h = `<h3 class="good">📦 ${who} collected ${r.n} card${r.n === 1 ? '' : 's'}${r.bonus && r.bonus.length ? ` + ${r.bonus.length} bonus` : ''}</h3>`;
    }
    return `<div class="ss-act">${h}<p class="muted">${g.deckLeft ? `Next turn in <span id="ssNext">${secs}</span>s.` : 'That was the last card.'}</p></div>`;
  }
  const recent = g.log.slice(-3).reverse().map(e => logLine(e, st)).filter(Boolean);
  const recentHTML = recent.length ? `<div class="ss-recent">${recent.map(x => `<div>${x}</div>`).join('')}</div>` : '';
  if (t.pid !== me) {
    let what = t.drawn ? 'is deciding: scan again or collect?' : 'is about to scan.';
    if (t.pending) what = `is using <b>${esc(PROMPT[t.pending.k][0])}</b>…`;
    return `<div class="ss-act"><h3>${H.avatar(t.pid, 26)} ${who} ${what}</h3>
      ${t.pending && t.pending.k === 'predict' ? `<p class="muted">They’re secretly looking at the top ${t.peek > 1 ? t.peek + ' cards' : 'card'} of the deck.</p>` : ''}
      ${t.pending && t.pending.k === 'map' && t.reveal ? `<div class="ss-choices">${t.reveal.map(c => cardHTML(c, { size: 'sm' })).join('')}</div>` : ''}
      ${recentHTML}</div>`;
  }
  if (t.pending) {
    const [title, help] = PROMPT[t.pending.k];
    let body = '';
    if (t.pending.k === 'map') {
      body = `<div class="ss-choices">${(t.reveal || []).filter(c => t.pending.opts.includes(String(c.id))).map(c => cardHTML(c, { pick: true, act: 'ss-choose', k: c.id, size: 'sm' })).join('')}</div>`;
    } else if (t.pending.k === 'predict') {
      const cs = Array.isArray(t.peek) ? t.peek : [];
      const dup = cs[0] && (g.zone.some(z => z.e === cs[0].e) || (g.settings.protocol === 'pattern' && g.zone.some(z => z.v === cs[0].v)));
      body = `<div class="ss-choices">${cs.map((c, i) => `<span class="pk">${cardHTML(c, { size: 'sm' })}<small>${i ? `then #${i + 1}` : 'top card'}</small></span>`).join('')}</div>
        ${dup ? `<p class="bad">⚠ That’s a repeat. Adding it collapses your run.</p>` : ''}
        <div class="row"><button type="button" class="btn${dup ? '' : ' primary'}" data-act="ss-choose" data-k="add">Add it to the scan zone</button>
        ${t.pending.opts.includes('return') ? `<button type="button" class="btn${dup ? ' primary' : ''}" data-act="ss-choose" data-k="return">Put it back and collect</button>` : '<span class="muted">The Leviathan won’t let you collect yet.</span>'}</div>`;
    } else if (t.pending.k === 'raider') {
      body = `<div class="ss-players">${t.pending.opts.map(p => `<button type="button" data-act="ss-choose" data-k="${esc(p)}">${H.avatar(p, 28)}${esc(nm(p))}</button>`).join('')}</div>`;
    }
    return `<div class="ss-act mine"><h3>${esc(title)}</h3><p>${esc(help)}${t.pending.k === 'pulse' || t.pending.k === 'breach' ? (g.settings.protocol === 'bottom' ? ' Bottom Shelf: it takes the bottom card instead.' : '') : ''}</p>${body}</div>`;
  }
  const scanBtn = `<button type="button" class="btn primary big" data-act="ss-scan" ${t.canScan ? '' : 'disabled'}>${t.drawn ? 'Scan again' : 'Scan'}</button>`;
  const collectBtn = t.drawn ? `<button type="button" class="btn big" data-act="ss-collect" ${t.canCollect ? '' : 'disabled'}>Collect ${g.zone.length ? g.zone.length + ' card' + (g.zone.length > 1 ? 's' : '') : '(end turn)'}</button>` : '';
  const risk = g.zone.length ? `<p class="muted">In the scan zone: ${g.zone.map(z => esc(EM[z.e].name)).join(', ')}. Scan one of those again and the run collapses${g.zone.some(z => z.prot) ? ' (protected cards are safe)' : ''}.</p>` : '';
  return `<div class="ss-act mine"><h3>Your turn${spec ? ` <small class="muted">· ${esc(spec.name)}</small>` : ''}</h3>${risk}
    <div class="row">${scanBtn}${collectBtn}${!g.deckLeft ? '<span class="muted">The deck is empty: collect to end the game.</span>' : ''}</div>${recentHTML}</div>`;
}

/* Everyone's vault, you first. Stacks are tappable when an ability asks for one. */
function vaultsHTML(g, st) {
  const me = st.you, t = g.turn;
  const playing = g.order.includes(me);
  const seats = playing ? [me, ...g.order.slice(g.order.indexOf(me) + 1), ...g.order.slice(0, g.order.indexOf(me))] : g.order;
  const opts = t && t.pid === me && t.pending ? t.pending : null;
  const flashing = Date.now() - L.flashAt < 1200 ? L.flashIds : [];
  const panels = seats.map(pid => {
    const v = g.vaults[pid] || {};
    const sc = g.scores[pid];
    const spec = g.spec[pid] && specOf(g.spec[pid]);
    const stacks = ORDER.filter(e => v[e]).map(e => {
      const cs = v[e];
      let k = '';
      if (opts && (opts.k === 'grapple' || opts.k === 'backfire') && pid === me && opts.opts.includes(e)) k = e;
      if (opts && (opts.k === 'pulse' || opts.k === 'breach') && opts.opts.includes(`${pid}:${e}`)) k = `${pid}:${e}`;
      const top = cardHTML(cs[0], { size: 'sm', pick: !!k, act: k ? 'ss-choose' : '', k, flash: cs.some(c => flashing.includes(c.id)) });
      return `<span class="stack" title="${esc(EM[e].name)}: ${cs.map(c => c.v).join(', ')}">${cs.length > 1 ? '<span class="under"></span>' : ''}${top}${cs.length > 1 ? `<span class="cnt">×${cs.length}</span>` : ''}</span>`;
    }).join('');
    const watch = g.custodianOf[pid] ? ` (watching ${esc(nm(g.custodianOf[pid]))})` : '';
    return `<div class="ss-vault${t && t.pid === pid && !t.ended ? ' turn' : ''}${pid === me ? ' me' : ''}">
      <div class="vh">${H.avatar(pid, pid === me ? 32 : 28)}<span class="nm">${esc(nm(pid))}${g.first === pid ? ' <span title="Starting Crew card">⭐</span>' : ''}
        <small>${spec ? `<span class="spec" title="${esc(spec.text)}${esc(watch)}">${esc(spec.name)}</span>` : ''}${sc.cards} card${sc.cards === 1 ? '' : 's'}${g.settings.protocol === 'spectrum' ? ` · ${sc.missing} missing` : ''}</small></span>
        <span class="pts${sc.over ? ' over' : ''}" title="Score so far">${sc.pts}</span></div>
      <div class="stacks">${stacks || '<span class="muted">Empty vault</span>'}</div></div>`;
  }).join('');
  return `<div class="ss-vaults n${Math.min(seats.length, 8)}">${panels}</div>`;
}

function finalHTML(g, st) {
  const f = g.final || {};
  const ranked = g.order.slice().sort((a, b) => (f[a].over - f[b].over) || (f[b].pts - f[a].pts) || (f[b].cards - f[a].cards));
  const rows = ranked.map((pid, i) => `<li class="${(g.winners || []).includes(pid) ? 'win' : ''}"><span class="pl">${i + 1}</span>${H.avatar(pid, 30)}
    <span>${esc(nm(pid))}<br><small class="muted">${f[pid].cards} cards${g.settings.protocol === 'spectrum' ? ` · −${5 * f[pid].missing} for ${f[pid].missing} missing` : ''}${f[pid].over ? ' · <b class="bad">60 or more: out</b>' : ''}</small></span>
    <span class="pt">${f[pid].pts}</span></li>`).join('');
  const w = (g.winners || []).map(p => esc(nm(p)));
  const head = !w.length ? 'Nobody stayed under 60!' : w.length > 1 ? `${w.join(' & ')} share the win!` : `${w[0] === 'You' ? 'You win' : w[0] + ' wins'}!`;
  const why = g.endWhy === 'fifty' ? 'First to fifty!' : 'The scanning deck is empty.';
  return `<div class="ss-act"><div class="ss-winner">${head}</div><p class="muted">${why} Only the top card of each stack scores${g.settings.protocol === 'total' ? ' (Total Recovery: every card counted)' : ''}. A tie goes to more cards.</p>
    <ol class="ss-sum">${rows}</ol>
    <div class="row">${H.isHost()
      ? '<button type="button" class="btn primary big" data-act="again">Play again</button><button type="button" class="btn" data-act="toRoomNow">Back to the room</button>'
      : `<span class="muted">Waiting for ${esc(H.nameOf(st.hostPid))} to pick what’s next.</span>`}</div></div>`;
}

function logLine(e, st) {
  const p = esc(nm(e.pid));
  const cd = c => `<b style="color:${EM[c.e] ? EM[c.e].color : 'inherit'}">${esc(EM[c.e] ? EM[c.e].name : '?')} ${c.v}</b>`;
  switch (e.k) {
    case 'crew': return `⭐ ${p} ${e.pid === st.you ? 'have' : 'has'} the Starting Crew card${e.copies > 1 ? ' (two decks for a large crew)' : ''}`;
    case 'spec': { const s = specOf(e.spec); return s ? `${p} chose <b>${esc(s.name)}</b>${e.target ? ` (watching ${esc(nm(e.target))})` : ''}` : ''; }
    case 'turn': return `<span class="lt">— ${p}${e.pid === st.you ? 'r' : '’s'} turn —</span>`;
    case 'scan': return `${p} scanned ${cd(e.card)}`;
    case 'predicted': return `${p} added the Predictor’s card: ${cd(e.card)}`;
    case 'predictBack': return `${p} put the Predictor’s card back`;
    case 'quickbank': return `${p} banked ${cd(e.card)} straight away (${esc((specOf(e.spec) || {}).name || '')})`;
    case 'shield': return `🛡 ${p}${e.pid === st.you ? 'r' : '’s'} Shield protects ${e.n} card${e.n === 1 ? '' : 's'}`;
    case 'grapple': return `${p} grappled ${cd(e.card)} out of ${e.pid === st.you ? 'your' : 'their'} vault`;
    case 'backfire': return `🔥 Backfire: ${p} discarded ${cd(e.card)}`;
    case 'pulse': return `💥 ${p} pulsed ${e.cards.map(cd).join(', ')} from ${poss(e.target)} vault${e.scrap ? ' into their own' : ''}`;
    case 'breach': return `⚡ ${p} breached ${poss(e.target)} vault and took ${cd(e.card)}`;
    case 'map': return `🗺 ${p} pulled ${cd(e.card)} from the archive`;
    case 'leviathan': return `🦑 Leviathan! ${p} must add ${e.n} more cards`;
    case 'aurora': return `✦ Aurora re-activates ${cd(e.card)}`;
    case 'auroraBank': return `✦ ${p} banked ${cd(e.card)} with the Aurora`;
    case 'fizzle': return `${esc(EM[e.e] ? EM[e.e].name : '')}${e.why === 'backfire' ? ' backfire' : ''} had nothing to do`;
    case 'collapse': return `💥 <b>Collapse!</b> ${p} lost ${e.lost} card${e.lost === 1 ? '' : 's'}${e.to ? ` to ${esc(nm(e.to))}` : ''}${e.kept ? `, kept ${e.kept}` : ''}`;
    case 'collect': return `📦 ${p} collected ${e.n} card${e.n === 1 ? '' : 's'}`;
    case 'bonus': return `🔑 Vault bonus: ${p} took ${e.n} card${e.n === 1 ? '' : 's'} from ${e.from ? poss(e.from) + ' vault' : 'the archive'}`;
    case 'over': return '<b>Game over</b>';
  }
  return '';
}

/* ---------- announcements ---------- */
function banner(html, cls) {
  L.queue.push([html, cls]);
  if (!L.showing) showNext();
}
function showNext() {
  const h = L.queue.shift();
  if (!h) { L.showing = false; return; }
  L.showing = true;
  const el = document.createElement('div');
  el.className = 'ss-banner ' + (h[1] || '');
  el.innerHTML = h[0];
  document.body.appendChild(el);
  setTimeout(() => { el.remove(); showNext(); }, 1500);
}
function fx(e) {
  const st = H.st;
  if (!st) return;
  if (e.type === 'crew') {
    const c = art('crew');
    banner(`${c ? `<img src="${esc(c)}" alt="">` : '⭐'} STARTING CREW<small>${esc(nm(e.pid))} ${e.pid === st.you ? 'go' : 'goes'} first</small>`);
  } else if (e.type === 'collapse') {
    banner(`SIGNAL COLLAPSE<small>A second ${esc(EM[e.dup.e].name)}: ${e.lost} lost${e.kept ? `, ${e.kept} protected` : ''}</small>`, 'bad');
    const z = document.querySelector('.ss-zone');
    if (z) { z.classList.remove('shake'); void z.offsetWidth; z.classList.add('shake'); }
  } else if (e.type === 'collect') banner(`SALVAGE SECURED<small>${esc(nm(e.pid))}: ${e.n} card${e.n === 1 ? '' : 's'}${e.bonus ? ` + ${e.bonus} bonus` : ''}</small>`, 'good');
  else if (e.type === 'pulse' && e.target === st.you) banner(`💥 PULSE HIT<small>${esc(H.nameOf(e.pid))} blasted your vault</small>`, 'bad');
}

Hub.registerGame('ss', {
  title: 'Signal Salvage',
  settings,
  render,
  fx: e => fx(e),
  tick(st) {
    const g = st.game;
    if (!g) return;
    if (g.phase === 'draft') H.setText('ssLeft', Math.max(0, Math.ceil((g.draftEnds - H.now()) / 1000)) + 's');
    if (g.turn && g.turn.ended) H.setText('ssNext', String(Math.max(0, Math.ceil((g.nextAt - H.now()) / 1000))));
    if (L.flashAt && Date.now() - L.flashAt > 1300) { L.flashAt = 0; document.querySelectorAll('.ss .flash').forEach(el => el.classList.remove('flash')); }
  }
});
})();
