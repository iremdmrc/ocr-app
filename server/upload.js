// server/src/upload.js
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from './db.js';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'file', ext);
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});
export const upload = multer({ storage });

export async function handleMultiUpload(req, res) {
  const files = (req.files || []).map(f => ({
    filename: f.filename,
    url: `/static/${f.filename}`,
    size: f.size,
    mimetype: f.mimetype,
  }));

  try {
    const saved = [];
    for (const f of files) {
      const { rows } = await pool.query(
        `INSERT INTO uploads (filename, url, size, mimetype, uploaded_by)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, created_at`,
        [f.filename, f.url, f.size, f.mimetype, req.user.uid]
      );
      saved.push({
        id: rows[0].id,
        created_at: rows[0].created_at,
        ...f,
        uploaded_by: { id: req.user.uid, email: req.user.email, display_name: req.user.name }
      });
    }
    res.json({ count: saved.length, files: saved });
  } catch (e) {
    console.error('UPLOAD ERROR:', e);
    res.status(500).json({ error: 'db insert' });
  }
}
