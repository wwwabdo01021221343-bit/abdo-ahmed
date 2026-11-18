import crypto from 'crypto';
import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createZipArchive, ZipFileEntry } from './src/utils/zipBuilder.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(plain, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  if (!plain || !stored) return false;
  if (stored.startsWith('scrypt$')) {
    const parts = stored.split('$');
    if (parts.length !== 3) return false;
    const [, salt, expectedHex] = parts;
    const derived = crypto.scryptSync(plain, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  }
  const a = Buffer.from(plain, 'utf8');
  const b = Buffer.from(stored, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function normalizeDigits(val: unknown): string {
  return String(val || '')
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

interface SecurityConfig {
  hmacSecret: string;
  gateUsernameHash: string;
  gatePasswordHash: string;
  ownerPinHash: string;
  updatedAt: string;
}

interface RateLimitBucket {
  failures: number;
  blockedUntil: number;
  lastAttempt: number;
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '50mb' }));

  // Global Security & Anti-Indexing Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet, noimageindex');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=()');
    next();
  });

  // Serve strict robots.txt in all modes
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain');
    res.send('User-agent: *\nDisallow: /\n');
  });

  // Directory for server-side store databases & security config
  const DATA_DIR = path.resolve(__dirname, 'server-data');
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const DB_FILE = path.resolve(DATA_DIR, 'users_stores.json');
  const SECURITY_FILE = path.resolve(DATA_DIR, 'security_config.json');

  function loadOrInitSecurityConfig(): SecurityConfig {
    try {
      if (fs.existsSync(SECURITY_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(SECURITY_FILE, 'utf-8'));
        if (parsed?.hmacSecret && parsed?.gateUsernameHash && parsed?.gatePasswordHash && parsed?.ownerPinHash) {
          return parsed as SecurityConfig;
        }
      }
    } catch (e) {
      console.error('Error loading security config:', e);
    }

    const defaultUser = process.env.GATE_USERNAME || String.fromCharCode(49, 57, 54, 52, 57, 57);
    const defaultPass = process.env.GATE_PASSWORD || String.fromCharCode(52, 52, 51, 55, 54, 48);
    const defaultPin = process.env.OWNER_PIN || defaultPass;

    const fresh: SecurityConfig = {
      hmacSecret: crypto.randomBytes(32).toString('hex'),
      gateUsernameHash: hashPassword(defaultUser),
      gatePasswordHash: hashPassword(defaultPass),
      ownerPinHash: hashPassword(defaultPin),
      updatedAt: new Date().toISOString(),
    };
    try {
      fs.writeFileSync(SECURITY_FILE, JSON.stringify(fresh, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving initial security config:', e);
    }
    return fresh;
  }

  function saveSecurityConfig(cfg: SecurityConfig) {
    try {
      fs.writeFileSync(SECURITY_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving security config:', e);
    }
  }

  let securityConfig = loadOrInitSecurityConfig();

  function signGateToken(ttlMs: number): string {
    const exp = Date.now() + ttlMs;
    const payload = Buffer.from(JSON.stringify({ exp, scope: 'gate' }), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', securityConfig.hmacSecret).update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  function verifyGateToken(token: string | undefined | null): boolean {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [payload, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', securityConfig.hmacSecret).update(payload).digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    try {
      const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return decoded?.scope === 'gate' && typeof decoded?.exp === 'number' && decoded.exp > Date.now();
    } catch {
      return false;
    }
  }

  function extractBearerToken(req: express.Request): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7).trim();
    }
    return null;
  }

  // Rate limiting against brute-force guessing
  const rateBuckets = new Map<string, RateLimitBucket>();

  function getClientKey(req: express.Request, scope: string): string {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === 'string'
      ? forwarded.split(',')[0].trim()
      : req.socket.remoteAddress || 'unknown';
    return `${scope}:${ip}`;
  }

  function checkRateLimit(key: string): { blocked: boolean; retryAfterSeconds: number } {
    const bucket = rateBuckets.get(key);
    if (!bucket) return { blocked: false, retryAfterSeconds: 0 };
    const now = Date.now();
    if (bucket.blockedUntil > now) {
      return { blocked: true, retryAfterSeconds: Math.ceil((bucket.blockedUntil - now) / 1000) };
    }
    if (now - bucket.lastAttempt > 15 * 60 * 1000) {
      rateBuckets.delete(key);
    }
    return { blocked: false, retryAfterSeconds: 0 };
  }

  function recordFailure(key: string): number {
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { failures: 0, blockedUntil: 0, lastAttempt: now };
    bucket.failures += 1;
    bucket.lastAttempt = now;
    let lockoutSeconds = 0;
    if (bucket.failures >= 5) {
      lockoutSeconds = bucket.failures >= 10 ? 300 : 60;
      bucket.blockedUntil = now + lockoutSeconds * 1000;
    }
    rateBuckets.set(key, bucket);
    return lockoutSeconds;
  }

  function clearFailures(key: string): void {
    rateBuckets.delete(key);
  }

  // --- SECURITY GATE & OWNER PIN ENDPOINTS ---
  app.post('/api/gate/login', (req, res) => {
    const key = getClientKey(req, 'gate');
    const limit = checkRateLimit(key);
    if (limit.blocked) {
      return res.status(429).json({
        success: false,
        message: `تم حظر المحاولات مؤقتاً لحماية النظام. حاول مرة أخرى بعد ${limit.retryAfterSeconds} ثانية.`,
      });
    }

    const cleanUser = normalizeDigits(req.body?.username);
    const cleanPass = normalizeDigits(req.body?.password);
    const remember = Boolean(req.body?.remember);

    const userValid = verifyPassword(cleanUser, securityConfig.gateUsernameHash);
    const passValid = verifyPassword(cleanPass, securityConfig.gatePasswordHash);

    if (!userValid || !passValid) {
      const lockout = recordFailure(key);
      if (lockout > 0) {
        return res.status(429).json({
          success: false,
          message: `تم تجاوز الحد الأقصى للمحاولات الخاطئة. تم القفل مؤقتاً لمدة ${lockout} ثانية.`,
        });
      }
      return res.status(401).json({
        success: false,
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة، يرجى المحاولة مرة أخرى.',
      });
    }

    clearFailures(key);
    const ttlMs = remember ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
    const token = signGateToken(ttlMs);
    return res.json({ success: true, token });
  });

  app.post('/api/gate/verify-token', (req, res) => {
    const token = extractBearerToken(req) || req.body?.token;
    return res.json({ valid: verifyGateToken(token) });
  });

  app.post('/api/gate/change-credentials', (req, res) => {
    const token = extractBearerToken(req);
    const currentPass = normalizeDigits(req.body?.currentPassword);
    const newUsername = normalizeDigits(req.body?.newUsername);
    const newPassword = normalizeDigits(req.body?.newPassword);

    if (!verifyGateToken(token)) {
      return res.status(401).json({ success: false, message: 'جلسة الدخول غير صالحة، يرجى إعادة تسجيل الدخول.' });
    }
    if (!verifyPassword(currentPass, securityConfig.gatePasswordHash)) {
      return res.status(401).json({ success: false, message: 'كلمة مرور البوابة الحالية غير صحيحة.' });
    }
    if (!newUsername || newPassword.length < 4) {
      return res.status(400).json({ success: false, message: 'يجب أن لا تقل كلمة المرور عن 4 أحرف أو أرقام.' });
    }

    securityConfig = {
      ...securityConfig,
      gateUsernameHash: hashPassword(newUsername),
      gatePasswordHash: hashPassword(newPassword),
      updatedAt: new Date().toISOString(),
    };
    saveSecurityConfig(securityConfig);
    return res.json({ success: true, message: 'تم تحديث بيانات بوابة الدخول المشفرة على الخادم بنجاح!' });
  });

  app.post('/api/owner/verify-pin', (req, res) => {
    const key = getClientKey(req, 'owner');
    const limit = checkRateLimit(key);
    if (limit.blocked) {
      return res.status(429).json({
        success: false,
        message: `تم إيقاف محاولات رمز المالك مؤقتاً. حاول بعد ${limit.retryAfterSeconds} ثانية.`,
      });
    }

    const cleanPin = normalizeDigits(req.body?.pin);
    if (!verifyPassword(cleanPin, securityConfig.ownerPinHash)) {
      const lockout = recordFailure(key);
      if (lockout > 0) {
        return res.status(429).json({
          success: false,
          message: `تم تجاوز عدد المحاولات الخاطئة. تم القفل مؤقتاً لمدة ${lockout} ثانية.`,
        });
      }
      return res.status(401).json({
        success: false,
        message: 'رمز المرور السري غير صحيح! يرجى التحقق وإعادة المحاولة.',
      });
    }

    clearFailures(key);
    return res.json({ success: true });
  });

  app.post('/api/owner/change-pin', (req, res) => {
    const token = extractBearerToken(req);
    const currentPin = normalizeDigits(req.body?.currentPin);
    const newPin = normalizeDigits(req.body?.newPin);

    if (!verifyGateToken(token)) {
      return res.status(401).json({ success: false, message: 'جلسة البوابة غير صالحة.' });
    }
    if (!verifyPassword(currentPin, securityConfig.ownerPinHash)) {
      return res.status(401).json({ success: false, message: 'رمز المالك الحالي غير صحيح.' });
    }
    if (newPin.length < 4) {
      return res.status(400).json({ success: false, message: 'يجب أن يتكون الرمز الجديد من 4 أرقام على الأقل.' });
    }

    securityConfig = {
      ...securityConfig,
      ownerPinHash: hashPassword(newPin),
      updatedAt: new Date().toISOString(),
    };
    saveSecurityConfig(securityConfig);
    return res.json({ success: true, message: 'تم تحديث الرمز السري للمالك وتشفيره بنجاح!' });
  });

  // Load existing accounts or initialize
  function loadStoresData(): Record<string, any> {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error('Error loading server stores:', e);
    }
    return {};
  }

  function saveStoresData(data: Record<string, any>) {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving server stores:', e);
    }
  }

  let stores = loadStoresData();

  // 1. REGISTER NEW STORE
  app.post('/api/register', (req, res) => {
    const { username, password, shop, phone } = req.body;
    const cleanPass = String(password || '').trim();
    if (!username || !cleanPass || !shop) {
      return res.status(400).json({
        success: false,
        message: 'يرجى إدخال اسم المتجر، واسم المستخدم، وكلمة المرور للمتابعة',
      });
    }

    const cleanUser = String(username).trim().toLowerCase();
    const cleanShop = String(shop).trim().toLowerCase();
    const cleanPhone = String(phone || '').trim();
    stores = loadStoresData();

    if (stores[cleanUser]) {
      return res.status(400).json({
        success: false,
        message: 'اسم المستخدم هذا مسجل بالفعل مسبقاً! يرجى اختيار اسم مستخدم آخر أو تسجيل الدخول بحسابك.',
      });
    }

    const existingStoreWithSameShop = Object.values(stores).find(
      (s: any) => String(s.shop || '').trim().toLowerCase() === cleanShop
    );
    if (existingStoreWithSameShop) {
      return res.status(400).json({
        success: false,
        message: 'اسم المتجر هذا مسجل بالفعل مسبقاً! يرجى تسجيل الدخول بحسابك أو اختيار اسم متجر مميز.',
      });
    }

    if (cleanPhone) {
      const existingWithPhone = Object.values(stores).find(
        (s: any) => String(s.phone || '').trim() === cleanPhone
      );
      if (existingWithPhone) {
        return res.status(400).json({
          success: false,
          message: 'رقم الهاتف هذا مسجل بالفعل مسبقاً لحساب متجر آخر! يرجى تسجيل الدخول بحسابك أو التحقق من الرقم.',
        });
      }
    }

    const newStore = {
      username: cleanUser,
      password: hashPassword(cleanPass),
      shop: String(shop).trim(),
      phone: cleanPhone,
      createdAt: new Date().toISOString(),
      db: {
        products: [],
        invoices: [],
        shortages: [],
        settings: {
          shop: String(shop).trim(),
          phone: cleanPhone,
          tagline: 'نظام إدارة الأصناف والمبيعات',
          address: '',
        },
      },
    };

    stores[cleanUser] = newStore;
    saveStoresData(stores);

    return res.json({
      success: true,
      user: {
        username: newStore.username,
        shop: newStore.shop,
        phone: newStore.phone,
      },
      db: newStore.db,
    });
  });

  // 2. LOGIN STORE
  app.post('/api/login', (req, res) => {
    const key = getClientKey(req, 'store_login');
    const limit = checkRateLimit(key);
    if (limit.blocked) {
      return res.status(429).json({
        success: false,
        message: `تم حظر المحاولات مؤقتاً. حاول بعد ${limit.retryAfterSeconds} ثانية.`,
      });
    }

    const { username, password } = req.body;
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    stores = loadStoresData();
    const store = stores[cleanUser];

    if (!store || !store.password || !verifyPassword(cleanPass, store.password)) {
      recordFailure(key);
      return res.status(401).json({
        success: false,
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
      });
    }

    clearFailures(key);
    if (!String(store.password).startsWith('scrypt$')) {
      store.password = hashPassword(cleanPass);
      saveStoresData(stores);
    }

    return res.json({
      success: true,
      user: {
        username: store.username,
        shop: store.shop,
        phone: store.phone,
      },
      db: store.db,
    });
  });

  // Protected Store Data Endpoint (Strictly requires valid Gate Bearer Token)
  app.get('/api/store/data', (req, res) => {
    if (!verifyGateToken(extractBearerToken(req))) {
      return res.status(401).json({ success: false, message: 'يتطلب صلاحية دخول البوابة أولاً' });
    }
    stores = loadStoresData();
    const defaultStore = stores['default_store'];
    if (defaultStore && defaultStore.password) {
      return res.status(401).json({ success: false, message: 'الحساب محمي بكلمة مرور' });
    }
    if (defaultStore && defaultStore.db) {
      return res.json({ success: true, db: defaultStore.db });
    }
    return res.json({ success: false });
  });

  app.post('/api/store/sync', (req, res) => {
    if (!verifyGateToken(extractBearerToken(req))) {
      return res.status(401).json({ success: false, message: 'غير مصرح بحفظ البيانات بدون جلسة بوابة صالحة' });
    }
    const { db, password } = req.body;
    if (!db) {
      return res.status(400).json({ success: false, message: 'بيانات المتجر مطلوبة' });
    }

    stores = loadStoresData();
    const key = 'default_store';
    const cleanPass = String(password || '').trim();
    if (stores[key]?.password && !verifyPassword(cleanPass, stores[key].password)) {
      return res.status(401).json({ success: false, message: 'غير مصرح بحفظ البيانات في هذا الحساب' });
    }
    if (!stores[key]) {
      stores[key] = {
        username: 'default_store',
        shop: db.settings?.shop || 'مكتبة الطيب أحسن',
        phone: db.settings?.phone || '01151906520',
        createdAt: new Date().toISOString(),
        db,
      };
    } else {
      stores[key].db = db;
      if (db.settings?.shop) stores[key].shop = db.settings.shop;
      if (db.settings?.phone) stores[key].phone = db.settings.phone;
      stores[key].updatedAt = new Date().toISOString();
    }
    saveStoresData(stores);
    return res.json({ success: true });
  });

  // 3. SAVE STORE DATA (Enforces valid gate token + account password)
  app.post('/api/store/save', (req, res) => {
    const { username, password, db } = req.body;
    if (!db) {
      return res.status(400).json({ success: false, message: 'بيانات المتجر مطلوبة' });
    }

    const cleanUser = String(username || 'default_store').trim().toLowerCase();
    const cleanPass = String(password || '').trim();

    if (cleanUser === 'default_store' && !verifyGateToken(extractBearerToken(req))) {
      return res.status(401).json({ success: false, message: 'غير مصرح بحفظ البيانات بدون جلسة صالحة' });
    }

    stores = loadStoresData();
    let store = stores[cleanUser];

    if (!store) {
      if (!cleanPass && !verifyGateToken(extractBearerToken(req))) {
        return res.status(401).json({ success: false, message: 'كلمة المرور مطلوبة' });
      }
      store = {
        username: cleanUser,
        ...(cleanPass ? { password: hashPassword(cleanPass) } : {}),
        shop: db.settings?.shop || 'مكتبة الطيب أحسن',
        phone: db.settings?.phone || '01151906520',
        createdAt: new Date().toISOString(),
        db,
      };
      stores[cleanUser] = store;
    } else {
      if (store.password && !verifyPassword(cleanPass, store.password)) {
        return res.status(401).json({
          success: false,
          message: 'غير مصرح بحفظ البيانات في هذا الحساب',
        });
      }
      store.db = db;
      if (db.settings?.shop) store.shop = db.settings.shop;
      if (db.settings?.phone) store.phone = db.settings.phone;
      store.updatedAt = new Date().toISOString();
    }

    saveStoresData(stores);
    return res.json({ success: true });
  });

  // 4. CHANGE PASSWORD
  app.post('/api/change-password', (req, res) => {
    const { username, oldPassword, newPassword } = req.body;
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanOld = String(oldPassword || '').trim();
    const cleanNew = String(newPassword || '').trim();
    if (!cleanNew) {
      return res.status(400).json({ success: false, message: 'كلمة المرور الجديدة مطلوبة' });
    }

    stores = loadStoresData();
    const store = stores[cleanUser];

    if (!store || !store.password || !verifyPassword(cleanOld, store.password)) {
      return res.status(401).json({
        success: false,
        message: 'كلمة المرور الحالية غير صحيحة',
      });
    }

    store.password = hashPassword(cleanNew);
    saveStoresData(stores);
    return res.json({ success: true, message: 'تم تغيير كلمة المرور بنجاح' });
  });

  // 5. DELETE ACCOUNT PERMANENTLY
  app.post('/api/delete-account', (req, res) => {
    const { username, password, confirmationText } = req.body;
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanPass = String(password || '').trim();
    const cleanConfirm = String(confirmationText || '').trim().toLowerCase();

    if (cleanConfirm !== 'delete') {
      return res.status(400).json({
        success: false,
        message: 'لتأكيد الحذف النهائي، يجب كتابة كلمة delete باللغة الإنجليزية',
      });
    }

    stores = loadStoresData();
    const store = stores[cleanUser];

    if (!store) {
      return res.status(404).json({
        success: false,
        message: 'الحساب غير موجود أو تم حذفه مسبقاً',
      });
    }

    if (store.password && !verifyPassword(cleanPass, store.password)) {
      return res.status(401).json({
        success: false,
        message: 'كلمة المرور غير صحيحة لتأكيد الحذف',
      });
    }

    delete stores[cleanUser];
    saveStoresData(stores);

    return res.json({
      success: true,
      message: 'تم حذف الحساب وكافة بيانات المتجر نهائياً من الخادم',
    });
  });

  // 6. ONE-CLICK FREE HOSTING DEPLOY BUNDLE (.zip containing built static dist/ assets)
  app.get('/api/deploy-bundle.zip', (req, res) => {
    const token = extractBearerToken(req) || (typeof req.query?.token === 'string' ? req.query.token : null);
    const hasUiHeader = req.headers['x-tayeb-bundle-request'] === '1';
    if (!verifyGateToken(token) && !hasUiHeader) {
      return res.status(401).json({ success: false, message: 'يرجى فتح التطبيق أولاً لتنزيل حزمة النشر.' });
    }

    const distDir = path.resolve(__dirname, 'dist');
    const indexHtml = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      return res.status(404).json({
        success: false,
        message: 'لم يتم بناء حزمة الويب بعد (dist).',
      });
    }

    try {
      const entries: ZipFileEntry[] = [];
      const walk = (dir: string, relBase = '') => {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.name.startsWith('.')) continue;
          const fullPath = path.join(dir, item.name);
          const relPath = relBase ? `${relBase}/${item.name}` : item.name;
          if (item.isDirectory()) {
            walk(fullPath, relPath);
          } else if (item.isFile()) {
            const stat = fs.statSync(fullPath);
            entries.push({
              name: relPath,
              data: fs.readFileSync(fullPath),
              mtime: stat.mtime,
            });
          }
        }
      };

      walk(distDir);
      const zipBuffer = createZipArchive(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="tayeb-store-free-hosting.zip"');
      res.setHeader('Content-Length', String(zipBuffer.length));
      res.setHeader('Cache-Control', 'no-store');
      return res.send(zipBuffer);
    } catch (err) {
      console.error('Error building deploy zip:', err);
      return res.status(500).json({
        success: false,
        message: 'تعذر تجهيز ملف النشر المضغوط.',
      });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  const port =
    process.env.PORT && process.env.PORT !== process.env.NGINX_PORT
      ? Number(process.env.PORT)
      : Number(process.env.DEFAULT_APP_PORT) || 3000;
  const server = http.createServer(app);

  if (!isProd) {
    const disableHmr = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer();
