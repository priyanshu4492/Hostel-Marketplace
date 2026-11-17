// ---------- tiny helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CATEGORIES = ['Electronics', 'Books', 'Furniture', 'Clothes', 'Stationery', 'Sports', 'Kitchen', 'Other'];
const CONDITIONS = ['Like new', 'Good', 'Fair', 'Worn'];
const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="100%" height="100%" fill="#dfe3ef"/><text x="50%" y="50%" font-size="60" text-anchor="middle" dominant-baseline="middle">📦</text></svg>'
);
let ME = null;

// theme (runs immediately)
document.documentElement.dataset.theme = localStorage.getItem('theme') || 'light';
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('theme', t);
  const b = $('#themeBtn'); if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}

// ---------- API ----------
async function api(url, { method = 'GET', json, form } = {}) {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = 'Bearer ' + token;
  let body;
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) localStorage.removeItem('token');
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

// ---------- toast & modal ----------
function toast(msg, type = 'ok') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + type; t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2800);
}
function openModal(html) {
  closeModal();
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box">${html}<button class="modal-x">✕</button></div>`;
  m.addEventListener('click', e => { if (e.target === m || e.target.classList.contains('modal-x')) closeModal(); });
  document.body.appendChild(m);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => m.classList.add('show'));
}
function closeModal() {
  const m = $('.modal');
  if (m) { m.remove(); document.body.style.overflow = ''; }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---------- formatting ----------
function timeAgo(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  return new Date(d).toLocaleDateString();
}
function avatarHTML(u, size = '') {
  if (u && u.avatar) return `<img class="avatar ${size}" src="${esc(u.avatar)}" alt="">`;
  const ch = (u && u.name ? u.name.trim()[0] : '?').toUpperCase();
  return `<div class="avatar ${size}">${esc(ch)}</div>`;
}
function countUp(el, n) {
  let i = 0; const step = Math.max(1, Math.ceil(n / 30));
  const t = setInterval(() => { i = Math.min(n, i + step); el.textContent = i; if (i >= n) clearInterval(t); }, 25);
}

// ---------- layout ----------
async function logout() {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  localStorage.removeItem('token');
  location.href = 'index.html';
}

function renderNav(active) {
  const dark = document.documentElement.dataset.theme === 'dark';
  const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}</a>`;
  $('#nav').innerHTML = `
  <nav class="nav"><div class="container nav-in">
    <a class="logo" href="index.html">🏠 Hostel<span>Market</span></a>
    <div class="links" id="links">
      ${link('index.html', 'Browse', 'home')}
      ${link('sell.html', '+ Sell', 'sell')}
      ${ME ? link('profile.html', 'My Profile', 'profile') + link('settings.html', 'Settings', 'settings') : ''}
    </div>
    <div class="nav-right">
      <button class="icon-btn" id="themeBtn" title="Toggle theme">${dark ? '☀️' : '🌙'}</button>
      ${ME
        ? `<a href="profile.html" title="${esc(ME.name)}">${avatarHTML(ME, 'md')}</a><button class="btn btn-ghost btn-sm" id="logoutBtn">Logout</button>`
        : `<a class="btn btn-primary btn-sm" href="login.html">Login</a>`}
      <button class="icon-btn burger" id="burger">☰</button>
    </div>
  </div></nav>`;
  $('#themeBtn').onclick = toggleTheme;
  $('#burger').onclick = () => $('#links').classList.toggle('open');
  if (ME) $('#logoutBtn').onclick = logout;
}

function renderFooter() {
  const f = document.createElement('footer');
  f.className = 'footer';
  f.innerHTML = 'Made for hostel students 💙 · Payments happen directly between buyer and seller';
  document.body.appendChild(f);
}

async function initPage({ active = '', requireLogin = false } = {}) {
  if (localStorage.getItem('token')) {
    try { ME = await api('/api/me'); } catch { ME = null; }
  }
  if (requireLogin && !ME) {
    location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    return false;
  }
  renderNav(active);
  renderFooter();
  return true;
}

// ---------- item cards ----------
function itemCard(it, i = 0, opts = {}) {
  const top = it.sold ? '<span class="badge sold">SOLD</span>' : `<span class="badge">${esc(it.category)}</span>`;
  const heart = opts.mine ? '' : `<button class="wish ${it.wished ? 'on' : ''}" data-wish="${it.id}" title="Save">♥</button>`;
  const bottom = opts.mine
    ? `<div class="card-actions">
         <a class="btn btn-ghost" href="sell.html?edit=${it.id}">✏️ Edit</a>
         <button class="btn btn-warn" data-act="sold" data-id="${it.id}">${it.sold ? '↩ Relist' : '✔ Sold'}</button>
         <button class="btn btn-danger" data-act="del" data-id="${it.id}">🗑</button>
       </div>`
    : `<div class="seller-line">${avatarHTML(it.seller)}<span><b>${esc(it.seller.name)}</b>${it.seller.hostel ? ' · ' + esc(it.seller.hostel) : ''}</span></div>`;
  return `
  <article class="card item ${it.sold ? 'is-sold' : ''}" style="--i:${Math.min(i, 12)}" data-id="${it.id}">
    <div class="thumb">
      <img loading="lazy" src="${esc(it.image || PLACEHOLDER)}" alt="${esc(it.title)}">
      ${top}${heart}
    </div>
    <div class="body">
      <div class="row"><h3>${esc(it.title)}</h3><span class="price">₹${it.price}</span></div>
      <p class="muted small clamp">${esc(it.description) || 'No description.'}</p>
      <div class="meta small muted"><span>${esc(it.condition)}${opts.mine ? ' · 👁 ' + (it.views || 0) : ''}</span><span>${timeAgo(it.createdAt)}</span></div>
      ${bottom}
    </div>
  </article>`;
}

async function toggleWish(id, btn) {
  if (!ME) {
    toast('Log in to save items', 'error');
    setTimeout(() => location.href = 'login.html', 900);
    return;
  }
  try {
    const r = await api('/api/wishlist/' + id, { method: 'POST' });
    btn.classList.toggle('on', r.wished);
    toast(r.wished ? 'Saved to wishlist ♥' : 'Removed from wishlist');
    return r.wished;
  } catch (e) { toast(e.message, 'error'); }
}

function showItem(it) {
  if (!it) return;
  api(`/api/items/${it.id}/view`, { method: 'POST' }).catch(() => {});
  let wa = (it.phone || '').replace(/\D/g, '');
  if (wa.length === 10) wa = '91' + wa; // India country code
  const text = encodeURIComponent(`Hi, I'm interested in your "${it.title}" (₹${it.price}) on Hostel Market.`);
  const contact = it.sold
    ? '<p class="muted"><b>This item has been sold.</b></p>'
    : it.phone
      ? `<div class="btn-row">
           <a class="btn btn-primary" href="tel:${esc(it.phone)}">📞 Call</a>
           <a class="btn btn-wa" target="_blank" rel="noopener" href="https://wa.me/${wa}?text=${text}">💬 WhatsApp</a>
         </div>`
      : `<a class="btn btn-primary" href="login.html">🔒 Log in to see contact details</a>`;

  openModal(`
    <div class="detail">
      <img class="big" src="${esc(it.image || PLACEHOLDER)}" alt="">
      <div class="detail-info">
        <div class="tags"><span class="tag">${esc(it.category)}</span><span class="tag">${esc(it.condition)}</span></div>
        <h2>${esc(it.title)}</h2>
        <div class="price" style="font-size:26px">₹${it.price}</div>
        <p class="muted" style="white-space:pre-wrap">${esc(it.description) || 'No description provided.'}</p>
        <div class="seller-line" style="border:none;margin-top:0;padding:0">
          ${avatarHTML(it.seller, 'md')}
          <div><b>${esc(it.seller.name)}</b><div class="small muted">${esc(it.seller.hostel || 'Hostel not set')} · listed ${timeAgo(it.createdAt)}</div></div>
        </div>
        ${contact}
        <div class="tip">💡 Meet in a public spot, check the item, and pay only after you receive it.</div>
      </div>
    </div>`);
}