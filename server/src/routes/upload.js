const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../db');
const { ensureDir, sanitizeName } = require('../util.fs');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      let { documentId } = req.body;

      if (!documentId) {
        const { rows } = await pool.query(
          `INSERT INTO documents (title, status) VALUES ($1, $2) RETURNING id`,
          [req.body.title || null, 'NEW']
        );
        documentId = rows[0].id;
        req.newlyCreatedDocumentId = documentId;
      } else {
        const found = await pool.query(`SELECT 1 FROM documents WHERE id=$1`, [documentId]);
        if (!found.rowCount) throw new Error('Document not found for given documentId.');
      }

      req.documentId = documentId;

      const abs = path.join(process.cwd(), UPLOAD_DIR, documentId);
      ensureDir(abs);
      cb(null, abs);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safe = sanitizeName(file.originalname);
    cb(null, safe);
  }
});

const upload = multer({ storage });

router.post('/upload-images', upload.array('images', 50), async (req, res) => {
  try {
    const documentId = req.documentId || req.body.documentId;
    const files = req.files || [];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const f of files) {
        const relPath = path.join(UPLOAD_DIR, documentId, path.basename(f.path)).replace(/\\/g, '/');
        await client.query(
          `INSERT INTO images (document_id, filename, rel_path, size_bytes, mime)
           VALUES ($1, $2, $3, $4, $5)`,
          [documentId, f.originalname, relPath, f.size, f.mimetype]
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    res.json({ ok: true, documentId, createdNew: !!req.newlyCreatedDocumentId, uploadedCount: files.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/documents/:id/images', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT id, filename, rel_path, size_bytes, mime, created_at
     FROM images WHERE document_id=$1 ORDER BY id`, [id]
  );
  res.json({ ok: true, images: rows });
});

router.delete('/documents/:id/images/:imageId', async (req, res) => {
  const { id, imageId } = req.params;
  const { rows } = await pool.query(
    `DELETE FROM images WHERE id=$1 AND document_id=$2 RETURNING rel_path`,
    [imageId, id]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'Image not found' });

  const fileRel = rows[0].rel_path;
  const fileAbs = path.join(process.cwd(), fileRel);
  try { fs.unlinkSync(fileAbs); } catch (_) {}

  res.json({ ok: true });
});

module.exports = router;
