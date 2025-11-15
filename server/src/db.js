// server/src/db.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool(); // .env'den okur

export async function ensureSchema() {
  // UUID için
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

  // users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // uploads: KİM yükledi?
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id BIGSERIAL PRIMARY KEY,
      filename  TEXT NOT NULL,
      url       TEXT NOT NULL,
      size      BIGINT NOT NULL,
      mimetype  TEXT NOT NULL,
      uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
