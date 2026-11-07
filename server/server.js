'use strict';
/* Blood Booking backend: Express + JSON file storage (no native modules, so it installs anywhere).
   Serves the frontend from /public and the API under /api. */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- reference data (must match the frontend map grid) ---------- */
const GX = [100, 260, 420, 580, 740, 900], GY = [90, 210, 330, 450, 570], KM = 0.004;
const HOSP = [
  { id: 'h1', c: 1, r: 1 }, { id: 'h2', c: 4, r: 0 }, { id: 'h3', c: 3, r: 3 },
  { id: 'h4', c: 0, r: 3 }, { id: 'h5', c: 5, r: 2 }, { id: 'h6', c: 2, r: 4 }
];
const BANKS = [
  { id: 'b1', c: 2, r: 1 }, { id: 'b2', c: 4, r: 2 }, { id: 'b3', c: 1, r: 3 },
  { id: 'b4', c: 3, r: 0 }, { id: 'b5', c: 5, r: 4 }
];
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
const COMPS = [
  { id: 'wb', fee: 1450, shelf: 35 }, { id: 'prbc', fee: 1550, shelf: 42 },
  { id: 'plt', fee: 400, shelf: 5 }, { id: 'ffp', fee: 400, shelf: 90 }
];
const bankOf = id => BANKS.find(b => b.id === id);
const hospOf = id => HOSP.find(h => h.id === id);
const compOf = id => COMPS.find(c => c.id === id);

function distanceKm(b, h) {
  return (Math.abs(GX[b.c] - GX[h.c]) + Math.abs(GY[b.r] - GY[h.r])) * KM;
}
function pricing(comp, units, km, urgent) {
  const items = comp.fee * units, delivery = Math.round(40 + km * 14), priority = urgent ? 60 : 0, platform = 25;
  const gst = Math.round((delivery + priority + platform) * 0.18);
  const total = items + delivery + priority + platform + gst;
  const toPartner = Math.round((delivery + priority) * 0.8);
  return { items, delivery, priority, platform, gst, total, toBank: items, toPartner, toPlatform: delivery + priority + platform - toPartner };
}

/* ---------- tiny JSON database ---------- */
function rng(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function seedStock() {
  const rare = { 'A+': 1, 'A-': .35, 'B+': 1, 'B-': .3, 'O+': 1.1, 'O-': .4, 'AB+': .5, 'AB-': .2 };
  const stock = {};
  BANKS.forEach((b, bi) => {
    const r = rng(97 + bi * 31); stock[b.id] = {};
    GROUPS.forEach(g => {
      stock[b.id][g] = {};
      COMPS.forEach(c => {
        let u = Math.floor(r() * 14 * rare[g]); if (r() < .12) u = 0;
        stock[b.id][g][c.id] = { units: u, exp: 1 + Math.floor(r() * Math.max(2, c.shelf - 1)) };
      });
    });
  });
  [8, 12, 0, 6, 9].forEach((u, i) => { stock[BANKS[i].id]['B+'].prbc.units = u; });
  return stock;
}
function seedOrder(id, bankId, hospId, group, comp, units, urgent, patient, txn) {
  const km = distanceKm(bankOf(bankId), hospOf(hospId));
  return {
    id, userId: 'seed', bankId, hospId, group, comp, units, urgent, patient, phone: '9000000000',
    status: 6, txn, km, p: pricing(compOf(comp), units, km, urgent), rxFile: null, createdAt: new Date().toISOString()
  };
}
function seedDb() {
  return {
    users: [{
      id: 'admin', name: 'Coordinator', phone: '9999999999', role: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10)
    }],
    stock: seedStock(),
    nextOrder: 10239,
    orders: [
      seedOrder('RS-10238', 'b2', 'h5', 'O+', 'wb', 2, false, 'Anita Rao', 'PREV48213390'),
      seedOrder('RS-10237', 'b1', 'h3', 'A+', 'plt', 4, true, 'Mohan Das', 'PREV77120458'),
      seedOrder('RS-10236', 'b3', 'h4', 'B-', 'prbc', 1, false, 'Fatima Khan', 'PREV20938811'),
      seedOrder('RS-10235', 'b5', 'h2', 'AB+', 'ffp', 2, false, 'Kiran Patel', 'PREV66401927')
    ].reverse()
  };
}
let db;
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
else { db = seedDb(); save(); }

/* ---------- helpers ---------- */
const publicOrder = o => ({
  id: o.id, bankId: o.bankId, hospId: o.hospId, group: o.group, comp: o.comp, units: o.units, urgent: o.urgent,
  patient: o.patient, phone: o.phone, status: o.status, txn: o.txn, km: o.km, p: o.p,
  time: new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  hasPrescription: !!o.rxFile
});
const sign = u => jwt.sign({ sub: u.id }, JWT_SECRET, { expiresIn: '7d' });
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  try {
    const { sub } = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === sub);
    if (!user) throw new Error('no user');
    req.user = user; next();
  } catch (e) { res.status(401).json({ error: 'Please sign in again.' }); }
}
const wrap = fn => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };

/* very small in-memory login throttle: 10 tries / 15 min per ip+phone */
const attempts = new Map();
function throttled(key) {
  const now = Date.now(), list = (attempts.get(key) || []).filter(t => now - t < 15 * 60 * 1000);
  attempts.set(key, list);
  return list.length >= 10;
}
const noteAttempt = key => { attempts.get(key).push(Date.now()); };

/* ---------- uploads ---------- */
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase().slice(0, 6))
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Prescription must be an image or PDF.'));
  }
});

/* ---------- app ---------- */
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/auth/signup', wrap((req, res) => {
  const { name = '', phone = '', password = '' } = req.body || {};
  if (name.trim().length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^\d{10}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  if (db.users.some(u => u.phone === phone)) return res.status(409).json({ error: 'This number already has an account. Sign in instead.' });
  const user = { id: crypto.randomUUID(), name: name.trim(), phone, role: 'patient', passwordHash: bcrypt.hashSync(password, 10) };
  db.users.push(user); save();
  res.status(201).json({ token: sign(user) });
}));

app.post('/api/auth/login', wrap((req, res) => {
  const { phone = '', password = '' } = req.body || {};
  const key = req.ip + ':' + phone;
  if (throttled(key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  const user = db.users.find(u => u.phone === phone);
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    noteAttempt(key);
    return res.status(401).json({ error: 'Mobile number or password is incorrect.' });
  }
  res.json({ token: sign(user) });
}));

app.get('/api/me', auth, (req, res) => {
  const { id, name, phone, role } = req.user;
  res.json({ id, name, phone, role });
});

app.get('/api/stock', auth, (req, res) => res.json(db.stock));

app.get('/api/orders', auth, (req, res) => {
  const list = req.user.role === 'admin' ? db.orders : db.orders.filter(o => o.userId === req.user.id);
  res.json(list.map(publicOrder));
});

app.post('/api/orders', auth, upload.single('prescription'), wrap((req, res) => {
  const b = req.body || {};
  const fail = (code, msg) => {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(code).json({ error: msg });
  };
  const bank = bankOf(b.bankId), hosp = hospOf(b.hospId), comp = compOf(b.comp);
  if (!bank || !hosp || !comp || !GROUPS.includes(b.group)) return fail(400, 'Invalid blood bank, hospital, group or component.');
  const units = Number(b.units);
  if (!Number.isInteger(units) || units < 1 || units > 4) return fail(400, 'Units must be between 1 and 4.');
  const patient = String(b.patient || '').trim();
  if (patient.length < 2) return fail(400, 'Enter the patient name.');
  if (!/^\d{10}$/.test(String(b.phone || ''))) return fail(400, 'Enter a 10-digit attendant phone number.');
  if (!req.file) return fail(400, 'A prescription file is required.');
  const slot = db.stock[bank.id][b.group][comp.id];
  if (slot.units < units) return fail(409, 'Not enough units available at this blood bank any more. Please choose another.');

  const urgent = b.urgent === 'true' || b.urgent === '1';
  const km = distanceKm(bank, hosp);
  const order = {
    id: 'RS-' + db.nextOrder++, userId: req.user.id, bankId: bank.id, hospId: hosp.id, group: b.group, comp: comp.id,
    units, urgent, patient, phone: b.phone, status: 0, txn: String(b.txn || '').slice(0, 24) || 'PREVIEW',
    km, p: pricing(comp, units, km, urgent), rxFile: req.file.filename, createdAt: new Date().toISOString()
  };
  slot.units -= units;
  db.orders.unshift(order); save();
  res.status(201).json(publicOrder(order));
}));

app.patch('/api/orders/:id/status', auth, wrap((req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o || (req.user.role !== 'admin' && o.userId !== req.user.id)) return res.status(404).json({ error: 'Order not found.' });
  const s = Number(req.body && req.body.status);
  if (!Number.isInteger(s) || s < 0 || s > 6) return res.status(400).json({ error: 'Invalid status.' });
  if (s > o.status) { o.status = s; save(); }
  res.json(publicOrder(o));
}));

app.get('/api/orders/:id/prescription', auth, wrap((req, res) => {
  const o = db.orders.find(x => x.id === req.params.id);
  if (!o || !o.rxFile || (req.user.role !== 'admin' && o.userId !== req.user.id)) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(UPLOAD_DIR, path.basename(o.rxFile)));
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || /Prescription must/.test(err.message || '')) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 5 MB.' : err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

app.listen(PORT, () => console.log('Blood Booking running at http://localhost:' + PORT));
