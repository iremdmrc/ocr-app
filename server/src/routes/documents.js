const express = require('express');
const { pool } = require('../db');

const router = express.Router();

router.get('/documents', async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, title, status, created_at FROM documents ORDER BY created_at DESC`
  );
  res.json({ ok: true, documents: rows });
});

module.exports = router;
