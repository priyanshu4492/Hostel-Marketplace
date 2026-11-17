const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const ITEMS_FILE = path.join(DATA_DIR, 'items.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
[ITEMS_FILE, USERS_FILE].forEach(f => { if (!fs.existsSync(f)) fs.writeFileSync(f, '[]'); });

// ---------- helpers ----------
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return []; } };
const writeJSON = (f, d) => fs.writeFileSync(f, JSON.stringify(d, null, 2));
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const clean = (v, max) => String(v || '').trim().slice(0, max);

function removeFile(url) {
  if (url && url.startsWith('/uploads/')) {
    fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
  }
}

function publicUser(u) {
  const { id, name, email, phone, hostel, bio, avatar, joinedAt } = u;
  return { id, name, email, phone, hostel, bio, avatar, joinedAt };
}

// attach seller info; phone only for logged-in viewers
function decorate(items, viewer) {
  const users = readJSON(USERS_FILE);
  const byId = Object.fromEntries(users.map(u => [u.id, u]));
  const wish = viewer ? viewer.wishlist : [];
  return items.filter(i => byId[i.sellerId]).map(i => {
    const s = byId[i.sellerId];
    return {
      ...i,
      phone: viewer ? s.phone : undefined,
      seller: { id: s.id, name: s.name, hostel: s.hostel, avatar: s.avatar },
      wished: wish.includes(i.id)
    };
  });
}

// ---------- upload ----------
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF images allowed.'))
});

// ---------- auth middleware ----------
function getUser(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return null;
  return readJSON(USERS_FILE).find(u => u.sessions.includes(token)) || null;
}
function auth(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first.' });
  req.user = user;
  req.token = (req.headers.authorization || '').replace('Bearer ', '');
  next();
}
function optionalAuth(req, res, next) { req.user = getUser(req); next(); }

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- accounts ----------
app.post('/api/register', (req, res) => {
  const name = clean(req.body.name, 50);
  const email = clean(req.body.email, 100).toLowerCase();
  const phone = clean(req.body.phone, 20);
  const hostel = clean(req.body.hostel, 60);
  const password = String(req.body.password || '');

  if (!name || !email || !phone || !password) return res.status(400).json({ error: 'Please fill all required fields.' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const users = readJSON(USERS_FILE);
  if (users.some(u => u.email === email)) return res.status(409).json({ error: 'This email is already registered.' });

  const salt = crypto.randomBytes(16).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');
  const user = {
    id: newId(), name, email, phone, hostel, bio: '', avatar: '',
    salt, hash: hashPw(password, salt), sessions: [token], wishlist: [],
    joinedAt: new Date().toISOString()
  };
  users.push(user);
  writeJSON(USERS_FILE, users);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const email = clean(req.body.email, 100).toLowerCase();
  const password = String(req.body.password || '');
  const users = readJSON(USERS_FILE);
  const user = users.find(u => u.email === email);
  const bad = () => res.status(401).json({ error: 'Wrong email or password.' });
  if (!user) return bad();

  const a = Buffer.from(hashPw(password, user.salt), 'hex');
  const b = Buffer.from(user.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return bad();

  const token = crypto.randomBytes(32).toString('hex');
  user.sessions = [...user.sessions, token].slice(-5);
  writeJSON(USERS_FILE, users);
  res.json({ token, user: publicUser(user) });
});

app.post('/api/logout', auth, (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(x => x.id === req.user.id);
  u.sessions = u.sessions.filter(t => t !== req.token);
  writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));

app.put('/api/me', auth, upload.single('avatar'), (req, res) => {
  const users = readJSON(USERS_FILE);
  const u = users.find(x => x.id === req.user.id);
  const name = clean(req.body.name, 50);
  const phone = clean(req.body.phone, 20);
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required.' });

  u.name = name;
  u.phone = phone;
  u.hostel = clean(req.body.hostel, 60);
  u.bio = clean(req.body.bio, 200);
  if (req.file) { removeFile(u.avatar); u.avatar = '/uploads/' + req.file.filename; }
  writeJSON(USERS_FILE, users);
  res.json(publicUser(u));
});

app.post('/api/me/password', auth, (req, res) => {
  const { current, next } = req.body;
  if (!next || String(next).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const users = readJSON(USERS_FILE);
  const u = users.find(x => x.id === req.user.id);
  const a = Buffer.from(hashPw(String(current || ''), u.salt), 'hex');
  const b = Buffer.from(u.hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Current password is wrong.' });
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPw(String(next), u.salt);
  writeJSON(USERS_FILE, users);
  res.json({ success: true });
});

app.delete('/api/me', auth, (req, res) => {
  const items = readJSON(ITEMS_FILE);
  items.filter(i => i.sellerId === req.user.id).forEach(i => removeFile(i.image));
  writeJSON(ITEMS_FILE, items.filter(i => i.sellerId !== req.user.id));
  removeFile(req.user.avatar);
  writeJSON(USERS_FILE, readJSON(USERS_FILE).filter(u => u.id !== req.user.id));
  res.json({ success: true });
});

// ---------- items ----------
app.get('/api/stats', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  res.json({
    items: items.length,
    available: items.filter(i => !i.sold).length,
    sold: items.filter(i => i.sold).length,
    students: readJSON(USERS_FILE).length
  });
});

app.get('/api/items', optionalAuth, (req, res) => {
  res.json(decorate(readJSON(ITEMS_FILE).reverse(), req.user));
});

app.get('/api/items/mine', auth, (req, res) => {
  res.json(readJSON(ITEMS_FILE).filter(i => i.sellerId === req.user.id).reverse());
});

app.post('/api/items', auth, upload.single('image'), (req, res) => {
  const title = clean(req.body.title, 80);
  const price = Number(req.body.price);
  if (!title || !isFinite(price) || price < 0) return res.status(400).json({ error: 'Title and a valid price are required.' });

  const items = readJSON(ITEMS_FILE);
  items.push({
    id: newId(), sellerId: req.user.id, title, price,
    category: clean(req.body.category, 30) || 'Other',
    condition: clean(req.body.condition, 30) || 'Good',
    description: clean(req.body.description, 600),
    image: req.file ? '/uploads/' + req.file.filename : '',
    sold: false, views: 0, createdAt: new Date().toISOString()
  });
  writeJSON(ITEMS_FILE, items);
  res.json({ success: true });
});

function ownItem(req, res) {
  const items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === req.params.id);
  if (!item) { res.status(404).json({ error: 'Item not found.' }); return {}; }
  if (item.sellerId !== req.user.id) { res.status(403).json({ error: 'This is not your item.' }); return {}; }
  return { items, item };
}

app.put('/api/items/:id', auth, upload.single('image'), (req, res) => {
  const { items, item } = ownItem(req, res);
  if (!item) return;
  const title = clean(req.body.title, 80);
  const price = Number(req.body.price);
  if (!title || !isFinite(price) || price < 0) return res.status(400).json({ error: 'Title and a valid price are required.' });

  item.title = title;
  item.price = price;
  item.category = clean(req.body.category, 30) || 'Other';
  item.condition = clean(req.body.condition, 30) || 'Good';
  item.description = clean(req.body.description, 600);
  if (req.file) { removeFile(item.image); item.image = '/uploads/' + req.file.filename; }
  writeJSON(ITEMS_FILE, items);
  res.json({ success: true });
});

app.post('/api/items/:id/sold', auth, (req, res) => {
  const { items, item } = ownItem(req, res);
  if (!item) return;
  item.sold = !item.sold;
  writeJSON(ITEMS_FILE, items);
  res.json(item);
});

app.delete('/api/items/:id', auth, (req, res) => {
  const { items, item } = ownItem(req, res);
  if (!item) return;
  removeFile(item.image);
  writeJSON(ITEMS_FILE, items.filter(i => i.id !== item.id));
  res.json({ success: true });
});

app.post('/api/items/:id/view', (req, res) => {
  const items = readJSON(ITEMS_FILE);
  const item = items.find(i => i.id === req.params.id);
  if (item) { item.views = (item.views || 0) + 1; writeJSON(ITEMS_FILE, items); }
  res.json({ success: true });
});

// ---------- wishlist ----------
app.get('/api/wishlist', auth, (req, res) => {
  const items = readJSON(ITEMS_FILE).filter(i => req.user.wishlist.includes(i.id)).reverse();
  res.json(decorate(items, req.user));
});

app.post('/api/wishlist/:id', auth, (req, res) => {
  if (!readJSON(ITEMS_FILE).some(i => i.id === req.params.id)) return res.status(404).json({ error: 'Item not found.' });
  const users = readJSON(USERS_FILE);
  const u = users.find(x => x.id === req.user.id);
  const has = u.wishlist.includes(req.params.id);
  u.wishlist = has ? u.wishlist.filter(i => i !== req.params.id) : [...u.wishlist, req.params.id];
  writeJSON(USERS_FILE, users);
  res.json({ wished: !has });
});

// ---------- errors ----------
app.use((err, req, res, next) => {
  const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Image must be under 3 MB.' : err.message;
  res.status(400).json({ error: msg });
});

app.listen(PORT, () => console.log(`Hostel Market running at http://localhost:${PORT}`));