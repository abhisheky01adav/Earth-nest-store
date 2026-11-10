// EarthNest Eco Store - zero-dependency Node.js server (needs Node 18+)
const https = require('https'), http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DATA_FILE || path.join(__dirname, 'db.json');
const PUB = path.join(__dirname, 'public');
const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
db.users ||= []; db.orders ||= [];
db.secret ||= crypto.randomBytes(32).toString('hex');
const save = () => { fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 2)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); };

// ---------- helpers ----------
const bad = (status, msg) => Object.assign(new Error(msg), { status });
const hash = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
const same = (pw, h) => { const a = Buffer.from(hash(pw, h.split(':')[0])), b = Buffer.from(h); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const hm = b => crypto.createHmac('sha256', db.secret).update(b).digest('base64url');
const sign = d => { const b = Buffer.from(JSON.stringify(d)).toString('base64url'); return b + '.' + hm(b); };
const verify = t => { try { const [b, s] = t.split('.'); if (hm(b) !== s) return null; const d = JSON.parse(Buffer.from(b, 'base64url')); return d.exp > Date.now() ? d : null; } catch { return null; } };
const auth = req => { const t = (req.headers.authorization || '').replace('Bearer ', ''); const d = t && verify(t); return d && db.users.find(u => u.id === d.id) || null; };
const safeUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const str = (v, n) => String(v ?? '').trim().slice(0, n);
const tries = {};
const limited = ip => { const now = Date.now(); tries[ip] = (tries[ip] || []).filter(t => now - t < 600000); return tries[ip].length >= 10 || (tries[ip].push(now), false); };

// ---------- SMS OTP (Fast2SMS) ----------
const cleanPhone = v => String(v ?? '').replace(/\D/g, '').slice(-10);
const findUser = b => b.phone ? db.users.find(u => u.phone && u.phone === cleanPhone(b.phone)) : db.users.find(u => u.email === str(b.email, 100).toLowerCase());
function sendSMS(phone, code) {
  return new Promise(done => {
    const key = process.env.FAST2SMS_API_KEY; if (!key) return done(false);
    const q = new URLSearchParams({ route: 'otp', variables_values: code, numbers: phone }).toString();
    const rq = https.request({ hostname: 'www.fast2sms.com', path: '/dev/bulkV2?' + q, method: 'GET', headers: { authorization: key } }, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { const j = JSON.parse(d); if (!j.return) console.error('SMS failed:', d); done(!!j.return); } catch { console.error('SMS bad reply:', d); done(false); } });
    });
    rq.on('error', e => { console.error('SMS error:', e.message); done(false); });
    rq.setTimeout(10000, () => rq.destroy()); rq.end();
  });
}

// ---------- admin account ----------
const AE = (process.env.ADMIN_EMAIL || 'admin@earthnest.local').toLowerCase();
let admin = db.users.find(u => u.role === 'admin');
if (!admin) { admin = { id: 1, name: 'Store Admin', email: AE, role: 'admin', pw: hash(process.env.ADMIN_PASSWORD || 'admin123'), defaultPw: !process.env.ADMIN_PASSWORD }; db.users.push(admin); }
else if (process.env.ADMIN_PASSWORD) { admin.pw = hash(process.env.ADMIN_PASSWORD); admin.defaultPw = false; admin.email = AE; }
if (process.env.ADMIN_PHONE) admin.phone = cleanPhone(process.env.ADMIN_PHONE);
save();

// ---------- validation ----------
function cleanProduct(b) {
  const p = { name: str(b.name, 120), category: str(b.category, 50), price: Math.round(+b.price), mrp: Math.round(+b.mrp || +b.price), stock: Math.floor(+b.stock), emoji: str(b.emoji, 8) || '🌿', material: str(b.material, 50), desc: str(b.desc, 500) };
  if (!p.name || !p.category || !(p.price > 0) || !(p.stock >= 0)) throw bad(400, 'Name, category, price and stock are required');
  if (p.mrp < p.price) p.mrp = p.price;
  return p;
}
const STATUS = ['placed', 'awaiting_verification', 'confirmed', 'shipped', 'delivered', 'cancelled'];

// ---------- API routes ----------
const routes = [];
const R = (m, p, role, fn) => routes.push({ m, role, fn, re: new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$') });

R('GET', '/api/products', null, () => db.products);
R('GET', '/api/settings', null, () => db.settings);
R('GET', '/api/me', 'user', ({ user }) => safeUser(user));

R('POST', '/api/register', null, ({ body, ip }) => {
  if (limited(ip)) throw bad(429, 'Too many attempts. Try again in a few minutes.');
  const email = str(body.email, 100).toLowerCase(), name = str(body.name, 60), pw = String(body.password || ''), phone = cleanPhone(body.phone);
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 6) throw bad(400, 'Enter your name, a valid email and a password of 6+ characters');
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad(400, 'Enter a valid 10-digit mobile number');
  if (db.users.some(u => u.email === email)) throw bad(409, 'An account with this email already exists');
  if (db.users.some(u => u.phone === phone)) throw bad(409, 'An account with this mobile number already exists');
  const u = { id: Date.now(), name, email, phone, role: 'customer', pw: hash(pw) };
  db.users.push(u); save();
  return { token: sign({ id: u.id, exp: Date.now() + 30 * 864e5 }), user: safeUser(u) };
});
R('POST', '/api/login', null, ({ body, ip }) => {
  if (limited(ip)) throw bad(429, 'Too many attempts. Try again in a few minutes.');
  const u = db.users.find(x => x.email === str(body.email, 100).toLowerCase());
  if (!u || !same(String(body.password || ''), u.pw)) throw bad(401, 'Wrong email or password');
  return { token: sign({ id: u.id, exp: Date.now() + 30 * 864e5 }), user: safeUser(u) };
});

R('POST', '/api/forgot', null, async ({ body, ip }) => {
  if (limited(ip)) throw bad(429, 'Too many attempts. Try again in a few minutes.');
  const u = findUser(body);
  const fresh = u && u.reset && u.reset.exp - Date.now() > 14 * 60000; // asked less than a minute ago
  if (u && !fresh) {
    u.reset = { code: String(crypto.randomInt(100000, 1000000)), exp: Date.now() + 15 * 60000, tries: 0, via: 'manual' };
    if (body.phone && u.phone && await sendSMS(u.phone, u.reset.code)) u.reset.via = 'sms';
    save();
    if (u.reset.via === 'manual' && u.role === 'admin') console.log(`\n🔑 Admin password reset code: ${u.reset.code}  (valid for 15 minutes)\n`);
    if (u.reset.via === 'manual' && !process.env.FAST2SMS_API_KEY && body.phone) console.log(`ℹ️  SMS is not set up (FAST2SMS_API_KEY missing). OTP for ${u.phone}: ${u.reset.code}`);
  }
  return { ok: true, sms: !!(body.phone && process.env.FAST2SMS_API_KEY) }; // same answer whether or not the account exists
});
R('POST', '/api/reset', null, ({ body, ip }) => {
  if (limited(ip)) throw bad(429, 'Too many attempts. Try again in a few minutes.');
  const u = findUser(body), r = u && u.reset, pw = String(body.password || '');
  if (!r || r.exp < Date.now() || r.tries >= 5) throw bad(400, 'Invalid or expired code. Please request a new one.');
  if (String(body.code || '').trim() !== r.code) { r.tries++; save(); throw bad(400, 'Invalid or expired code. Please request a new one.'); }
  if (pw.length < (u.role === 'admin' ? 8 : 6)) throw bad(400, `New password must be at least ${u.role === 'admin' ? 8 : 6} characters`);
  u.pw = hash(pw); u.defaultPw = false; delete u.reset; save(); return { ok: true };
});
R('POST', '/api/orders', 'optional', ({ body, user }) => {
  const a = body.address || {}, address = { name: str(a.name, 80), phone: str(a.phone, 10), address: str(a.address, 200), city: str(a.city, 60), pin: str(a.pin, 6) };
  if (!address.name || !address.address || !address.city) throw bad(400, 'Please fill in the full address');
  if (!/^[6-9]\d{9}$/.test(address.phone)) throw bad(400, 'Enter a valid 10-digit mobile number');
  if (!/^\d{6}$/.test(address.pin)) throw bad(400, 'Enter a valid 6-digit PIN code');
  const payment = body.payment === 'cod' ? 'cod' : 'upi', utr = str(body.utr, 12);
  if (payment === 'upi' && !/^\d{12}$/.test(utr)) throw bad(400, 'Enter the 12-digit UTR number from your UPI payment');
  if (!Array.isArray(body.items) || !body.items.length) throw bad(400, 'Your bag is empty');
  const items = body.items.map(i => {
    const p = db.products.find(x => x.id === +i.id), qty = Math.floor(+i.qty);
    if (!p || !(qty > 0)) throw bad(400, 'Invalid item in bag');
    if (p.stock < qty) throw bad(409, `Only ${p.stock} left of "${p.name}"`);
    return { id: p.id, name: p.name, emoji: p.emoji, price: p.price, qty };
  });
  items.forEach(i => { db.products.find(p => p.id === i.id).stock -= i.qty; });
  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0), shipping = subtotal >= db.settings.freeShippingAbove ? 0 : db.settings.shippingFee;
  const order = { id: 'EN-' + db.nextOrderNo++, date: new Date().toISOString(), userId: user?.id || null, items, subtotal, shipping, total: subtotal + shipping, payment, utr: payment === 'upi' ? utr : null, address, status: payment === 'upi' ? 'awaiting_verification' : 'placed' };
  db.orders.push(order); save();
  return order;
});
R('GET', '/api/my-orders', 'user', ({ user }) => db.orders.filter(o => o.userId === user.id).reverse());

// admin
R('GET', '/api/admin/resets', 'admin', () => db.users.filter(u => u.role !== 'admin' && u.reset && u.reset.via === 'manual' && u.reset.exp > Date.now()).map(u => ({ name: u.name, email: u.email, phone: u.phone || '', code: u.reset.code, exp: u.reset.exp })));
R('GET', '/api/admin/customers', 'admin', () => db.users.filter(u => u.role !== 'admin').map(u => {
  const os = db.orders.filter(o => o.userId === u.id && o.status !== 'cancelled');
  return { id: u.id, name: u.name, email: u.email, phone: u.phone || '', joined: new Date(u.id).toISOString(), orders: os.length, spent: os.reduce((s, o) => s + o.total, 0) };
}).reverse());
R('GET', '/api/admin/orders', 'admin', () => [...db.orders].reverse());
R('PATCH', '/api/admin/orders/:id', 'admin', ({ body, p }) => {
  const o = db.orders.find(x => x.id === p.id);
  if (!o) throw bad(404, 'Order not found');
  if (!STATUS.includes(body.status)) throw bad(400, 'Invalid status');
  const restock = n => o.items.forEach(i => { const pr = db.products.find(x => x.id === i.id); if (pr) pr.stock += n * i.qty; });
  if (body.status === 'cancelled' && o.status !== 'cancelled') restock(1);
  if (o.status === 'cancelled' && body.status !== 'cancelled') restock(-1);
  o.status = body.status; save(); return o;
});
R('POST', '/api/admin/products', 'admin', ({ body }) => { const p = { id: db.nextProductId++, ...cleanProduct(body) }; db.products.push(p); save(); return p; });
R('PUT', '/api/admin/products/:id', 'admin', ({ body, p }) => {
  const i = db.products.findIndex(x => x.id === +p.id);
  if (i < 0) throw bad(404, 'Product not found');
  db.products[i] = { id: +p.id, ...cleanProduct(body) }; save(); return db.products[i];
});
R('DELETE', '/api/admin/products/:id', 'admin', ({ p }) => { db.products = db.products.filter(x => x.id !== +p.id); save(); return { ok: true }; });
R('GET', '/api/admin/settings', 'admin', () => db.settings);
R('PUT', '/api/admin/settings', 'admin', ({ body }) => {
  const s = { upiId: str(body.upiId, 80), upiName: str(body.upiName, 80), bankName: str(body.bankName, 80), accountNo: str(body.accountNo, 30), ifscCode: str(body.ifscCode, 15), freeShippingAbove: Math.max(0, Math.round(+body.freeShippingAbove || 0)), shippingFee: Math.max(0, Math.round(+body.shippingFee || 0)) };
  if (!s.upiId || !s.upiName) throw bad(400, 'UPI ID and merchant name are required');
  db.settings = s; save(); return s;
});
R('POST', '/api/admin/password', 'admin', ({ body, user }) => {
  if (!same(String(body.current || ''), user.pw)) throw bad(400, 'Current password is wrong');
  if (String(body.next || '').length < 8) throw bad(400, 'New password must be at least 8 characters');
  user.pw = hash(body.next); user.defaultPw = false; save(); return { ok: true };
});

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
const readBody = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 1e6) { req.destroy(); no(bad(413, 'Too large')); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { no(bad(400, 'Bad JSON')); } }); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname.startsWith('/api/')) {
      const r = routes.find(r => r.m === req.method && r.re.test(u.pathname));
      if (!r) throw bad(404, 'Not found');
      const user = auth(req);
      if (r.role === 'user' && !user) throw bad(401, 'Please log in');
      if (r.role === 'admin' && (!user || user.role !== 'admin')) throw bad(user ? 403 : 401, 'Admin access only');
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      return send(res, 200, await r.fn({ body, user, ip, p: u.pathname.match(r.re).groups || {} }));
    }
    let p = { '/': '/index.html', '/login': '/login.html', '/admin': '/admin.html' }[u.pathname] || u.pathname;
    const f = path.join(PUB, path.normalize(p));
    if (!f.startsWith(PUB + path.sep)) throw bad(403, 'Forbidden');
    fs.readFile(f, (e, d) => {
      if (e) return send(res, 404, { error: 'Page not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' });
      res.end(d);
    });
  } catch (e) { if (!e.status) console.error(e); send(res, e.status || 500, { error: e.status ? e.message : 'Server error' }); }
}).listen(PORT, () => {
  console.log(`\n🌿 EarthNest is running!\n   Store : http://localhost:${PORT}\n   Admin : http://localhost:${PORT}/admin.html  (${admin.email})`);
  if (admin.defaultPw) console.log('\n⚠️  Admin is using the DEFAULT password "admin123". Change it in Admin > Settings (or set ADMIN_PASSWORD) before going live!\n');
});
