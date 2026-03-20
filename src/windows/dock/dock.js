'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Dock Float Window
   Receives full raw event objects via dock:event IPC.
   Renders identically to the embedded dock in chat.js.
   ═══════════════════════════════════════════════════════════════════════════ */

window.onerror = (msg, _url, line) => console.error('[Dock]', msg, 'line', line);

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const dockEventsEl  = $('#dock-events');
const btnFilter     = $('#btn-dock-filter');
const filterDrop    = $('#dock-filter-dropdown');

// ── Theme ────────────────────────────────────────────────────────────────────
const ALL_THEMES = ['theme-dark','theme-light','theme-gray','theme-lightgray','theme-sakura','theme-midnight'];
function applyTheme(t) {
  document.body.classList.remove(...ALL_THEMES);
  if (t && t !== 'dark') document.body.classList.add('theme-' + t);
}
window.chattering?.settings?.get?.(['theme']).then(s => { if (s?.theme) applyTheme(s.theme); }).catch(()=>{});
window.chattering?._onSettingsUpdated?.((s) => { if (s?.theme) applyTheme(s.theme); });

// ── Controls ─────────────────────────────────────────────────────────────────
$('#btn-dock-top')?.addEventListener('click',    () => window.chattering?.dock?.setPosition('top'));
$('#btn-dock-left')?.addEventListener('click',   () => window.chattering?.dock?.setPosition('left'));
$('#btn-dock-right')?.addEventListener('click',  () => window.chattering?.dock?.setPosition('right'));
$('#btn-dock-bottom')?.addEventListener('click', () => window.chattering?.dock?.setPosition('bottom'));
$('#btn-minimize')?.  addEventListener('click', () => {
  window.chattering?.settings?.get(['dockPosition'])
    .then(s => window.chattering?.dock?.setPosition(s?.dockPosition || 'top'))
    .catch(()  => window.chattering?.dock?.setPosition('top'));
});
$('#btn-clear-events')?.addEventListener('click', () => {
  if (dockEventsEl) dockEventsEl.innerHTML = '';
  Object.keys(likeCountMap).forEach(k => delete likeCountMap[k]);
  window.chattering?.dock?.clearEvents();
});

// ── Render helpers (same as chat.js) ─────────────────────────────────────────
const ICONS = {
  follow:'💙', sub:'⭐', resub:'⭐', gift:'🎁', bits:'💎',
  like:'❤️',  raid:'🚀', share:'🔁', superchat:'💛', member:'💙',
  redeem:'✨', streamEnd:'📴'
};
const PLAT = { twitch:'TW', tiktok:'TT', youtube:'YT' };
const likeCountMap = {};
let dockFilters = [];

function buildDesc(type, amount, months, message, giftName, platform) {
  switch (type) {
    case 'follow':    return 'siguió al canal';
    case 'sub':       return 'se suscribió';
    case 'resub':     return 'resub ×' + (months||1);
    case 'bits':      return 'donó ' + (amount||0) + ' bits';
    case 'like':      return 'dio ' + (amount||1) + ' like(s)';
    case 'share':     return 'ha compartido el live';
    case 'raid':      return 'hizo raid con ' + (amount||0) + ' viewers';
    case 'superchat': return 'Super Chat $' + (amount||0) + (message ? ': ' + message : '');
    case 'redeem':    return 'canjeó "' + (giftName||message||'recompensa') + '"';
    case 'gift':
      if (platform === 'tiktok') return 'donó ' + (giftName||message||'regalo') + (amount&&amount>1?' ×'+amount:'');
      return 'regaló ' + (amount||1) + ' sub(s)';
    default: return type;
  }
}

function buildItem(type, who, desc, platform, extraData) {
  const item = document.createElement('div');
  item.className = 'event-item ' + type;
  const iconEl = document.createElement('span'); iconEl.className = 'event-icon';
  if (type === 'gift' && platform === 'tiktok' && extraData && extraData.giftImg) {
    const gImg = document.createElement('img');
    gImg.src = extraData.giftImg;
    gImg.style.cssText = 'width:22px;height:22px;object-fit:contain;border-radius:3px;vertical-align:middle;';
    gImg.onerror = function() { gImg.replaceWith(document.createTextNode('🎁')); };
    iconEl.appendChild(gImg);
  } else { iconEl.textContent = ICONS[type] || '📣'; }
  const body   = document.createElement('div');  body.className = 'event-body';
  const userEl = document.createElement('div');  userEl.className = 'event-user'; userEl.textContent = who;
  const descEl = document.createElement('div');  descEl.className = 'event-desc'; descEl.textContent = desc;
  const platEl = document.createElement('span'); platEl.className = 'event-platform';
  platEl.textContent = PLAT[platform] || (platform||'').toUpperCase().slice(0,2);
  body.appendChild(userEl); body.appendChild(descEl);
  item.appendChild(iconEl); item.appendChild(body); item.appendChild(platEl);
  return item;
}

function addEvent(evt) {
  if (!dockEventsEl || !evt) return;
  const { type, username, displayName, amount, months, message, giftName, platform } = evt;
  const who = displayName || username || 'Anónimo';

  if (type === 'like') {
    const key = `${platform}:${username}`;
    if (likeCountMap[key]) {
      likeCountMap[key].count = amount || likeCountMap[key].count;
      likeCountMap[key].el.querySelector('.event-desc').textContent = likeCountMap[key].count + ' like(s)';
      dockEventsEl.prepend(likeCountMap[key].el);
    } else {
      const item = buildItem(type, who, (amount||1) + ' like(s)', platform, evt);
      likeCountMap[key] = { el: item, count: amount||1 };
      dockEventsEl.prepend(item);
    }
    return;
  }

  const item = buildItem(type, who, buildDesc(type, amount, months, message, giftName, platform), platform, evt);
  dockEventsEl.appendChild(item); // column-reverse = visual top

  if (dockFilters.length > 0 && !dockFilters.includes(type)) item.style.display = 'none';

  const nonLike = [...dockEventsEl.children].filter(el => !el.classList.contains('like'));
  while (nonLike.length > 100) nonLike.pop().remove();
}

// ── Filter UI ─────────────────────────────────────────────────────────────────
btnFilter?.addEventListener('click', (e) => { e.stopPropagation(); filterDrop?.classList.toggle('hidden'); });
document.addEventListener('click', (e) => {
  if (!filterDrop?.contains(e.target) && e.target !== btnFilter) filterDrop?.classList.add('hidden');
});
filterDrop?.querySelectorAll('[data-filter-event]').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.filterEvent;
    const idx = dockFilters.indexOf(t);
    if (idx === -1) dockFilters.push(t); else dockFilters.splice(idx, 1);
    btn.classList.toggle('active', dockFilters.includes(t));
    btnFilter?.classList.toggle('has-active-filter', dockFilters.length > 0);
    dockEventsEl?.querySelectorAll('.event-item').forEach(el => {
      const evType = [...el.classList].find(c => c !== 'event-item');
      el.style.display = (dockFilters.length === 0 || dockFilters.includes(evType)) ? '' : 'none';
    });
  });
});
$('#btn-clear-dock-filters')?.addEventListener('click', () => {
  dockFilters = [];
  filterDrop?.querySelectorAll('[data-filter-event]').forEach(b => b.classList.remove('active'));
  btnFilter?.classList.remove('has-active-filter');
  dockEventsEl?.querySelectorAll('.event-item').forEach(el => { el.style.display = ''; });
});

// ── IPC ───────────────────────────────────────────────────────────────────────
window.chattering?.dock?._onDockEvent((evt) => addEvent(evt));
window.chattering?.dock?._onDockClear?.(() => {
  if (dockEventsEl) dockEventsEl.innerHTML = '';
  Object.keys(likeCountMap).forEach(k => delete likeCountMap[k]);
});

console.log('[Dock] Float window ready');