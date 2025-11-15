import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool(); // .env’den PG bağlantısı

export async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS images (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename   TEXT NOT NULL,
      url        TEXT NOT NULL,
      size_bytes BIGINT NOT NULL,
      mimetype   TEXT NOT NULL,
      uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
