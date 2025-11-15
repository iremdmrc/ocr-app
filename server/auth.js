// server/auth.js
import { pool } from './db.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Küçük yardımcı: güvenli JSON hata cevabı
function sendServerError(res, e) {
  console.error(e);
  return res.status(500).json({ error: 'server', detail: String(e?.message || e) });
}

export async function register(req, res) {
  try {
    const { email, password, display_name } = req.body || {};
    if (!email || !password || !display_name) {
      return res.status(400).json({ error: 'missing fields' });
    }

    const hash = await bcrypt.hash(password, 11);
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1,$2,$3)
       RETURNING id, email, display_name`,
      [email, hash, display_name]
    );

    // Kullanıcıyı kaydettikten sonra otomatik token oluştur
    const u = rows[0];
    const token = jwt.sign(
      { uid: u.id, email: u.email, name: u.display_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ token, user: u });
  } catch (e) {
    if (e?.code === '23505') {
      return res.status(409).json({ error: 'email exists' });
    }
    return sendServerError(res, e);
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'missing fields' });
    }

    const { rows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: 'invalid creds' });

    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid creds' });

    const token = jwt.sign(
      { uid: u.id, email: u.email, name: u.display_name },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      user: { id: u.id, email: u.email, display_name: u.display_name }
    });
  } catch (e) {
    return sendServerError(res, e);
  }
}

export function authRequired(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'no token' });

    req.user = jwt.verify(token, JWT_SECRET); // { uid, email, name }
    return next();
  } catch (e) {
    return res.status(401).json({ error: 'bad token' });
  }
}

// Global error handler (opsiyonel ama faydalı)
export function errorHandler(err, req, res, next) {
  try { console.error('UNCAUGHT ERROR:', err); } catch {}
  if (res.headersSent) return;
  res.status(500).json({ error: 'server', detail: String(err?.message || err) });
}
