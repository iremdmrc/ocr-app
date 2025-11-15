// --- imports
import 'dotenv/config';               // .env'yi yükle
import express from 'express';
import sharp from 'sharp';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('pg');
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { ocrSingleLine } from './ocr/singleLine.js';
import mime from "mime-types";            // npm i mime-types
import { azureRead } from "./ocr-providers/azure.js";
import { googleVision } from "./ocr-providers/google.js";
import { paddleOcr } from "./ocr-providers/paddle.js";
import { PDFDocument } from "pdf-lib";    // basit görsel→PDF için
import { overlayInvisibleText } from './pdf-overlay.js';

// ✅ auth fonksiyonlarını tek kaynaktan kullanıyoruz
import { register, login, authRequired } from '../auth.js';

import cors from 'cors';

const execFile = promisify(_execFile);
const { Pool } = pkg;

// ESM'de __dirname tanımı
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// 🔧 SERVER KÖKÜ: src'nin bir üstü
const BASE_DIR = path.resolve(__dirname, '..');

// --- app
const app = express();
app.use(express.json()); // JSON body
app.use(cors());         // ✅ app oluşturulduktan sonra

// --- DB pool (env'den okur)
const pool = new Pool();

// --- Şema: tablo yoksa oluştur (lazy auto-migration)
async function ensureSchema() {
  await pool.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id          BIGSERIAL PRIMARY KEY,
      filename    TEXT NOT NULL,
      url         TEXT NOT NULL,
      size        BIGINT NOT NULL,
      mimetype    TEXT NOT NULL,
      uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

/* --------- KLASÖR ÇÖZÜMLEME --------- */
// env verildiyse: mutlaksa direkt, görece ise BASE_DIR (server kökü) göre çöz.
// env yoksa fallback'i BASE_DIR'e göre kullan.
function resolveDir(envVal, fallbackRelative) {
  if (envVal && envVal.trim()) {
    return path.isAbsolute(envVal)
      ? path.normalize(envVal)
      : path.resolve(BASE_DIR, envVal);
  }
  return path.resolve(BASE_DIR, fallbackRelative);
}

// .env içine SADECE şu şekilde yaz:  UPLOAD_DIR=uploads  OUTPUT_DIR=out
const UPLOAD_DIR = resolveDir(process.env.UPLOAD_DIR, 'uploads');
const OUT_DIR    = resolveDir(process.env.OUTPUT_DIR, 'out');

for (const dir of [UPLOAD_DIR, OUT_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// nereye baktığımızı göster
console.log('UPLOAD_DIR =', UPLOAD_DIR);
console.log('OUT_DIR    =', OUT_DIR);

// statikler
app.use('/static', express.static(UPLOAD_DIR)); // yüklenen dosyalar
app.use('/out', express.static(OUT_DIR));       // üretilen PDF'ler

// --- multer storage + fileFilter (görsel + PDF)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    const base = path.basename(file.originalname || 'file', ext).replace(/[^\w.-]+/g, '_');
    cb(null, `${Date.now()}-${base}${ext}`);
  },
});
const fileFilter = (req, file, cb) => {
  const ok = /^image\//.test(file.mimetype) || file.mimetype === 'application/pdf';
  if (!ok) return cb(new Error('Sadece görüntü veya PDF yüklenebilir'));
  cb(null, true);
};
const upload = multer({ storage, fileFilter });

// ----------------- AUTH -----------------
// ✅ Artık burada JWT_SECRET ve authRequired TANIMLAMIYORUZ.
// Hepsi ../auth.js içinde. Sadece route'ları bağlıyoruz:
app.post('/api/auth/register', register);
app.post('/api/auth/login', login);

// Deep OCR (Azure→Google→Paddle en iyi sonucu döndür)
app.post('/api/ocr/deeplearn', authRequired, async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename zorunlu' });
    const safe = path.basename(filename);
    const inAbs = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(inAbs)) return res.status(404).json({ error: 'dosya yok' });

    const buf = await fs.promises.readFile(inAbs);
    const mimeType = mime.lookup(inAbs) || 'application/octet-stream';
    const isPdf = /\.pdf$/i.test(inAbs) || mimeType === 'application/pdf';

    const tries = [];
    async function attempt(name, fn) {
      try {
        const r = await fn();
        const score = (r?.text||"").replace(/\s+/g,"").length;
        tries.push({ name, ok:true, score });
        return r;
      } catch (e) {
        tries.push({ name, ok:false, error:String(e?.message||e) });
        return null;
      }
    }

    let candidates = [];
    if (isPdf) {
      const a = await attempt("azure", () => azureRead(buf, "application/pdf")); if (a) candidates.push(a);
    } else {
      const a = await attempt("azure", () => azureRead(buf, mimeType)); if (a) candidates.push(a);
      const g = await attempt("google", () => googleVision(buf));       if (g) candidates.push(g);
      const p = await attempt("paddle", () => paddleOcr(inAbs));        if (p) candidates.push(p);
    }

    if (!candidates.length) return res.status(500).json({ ok:false, error:"no_provider_succeeded", tries });

    let best = candidates[0];
    for (const c of candidates) if ((c.text||"").length > (best.text||"").length) best = c;

    res.json({ ok:true, provider:best.provider, text:best.text, lines:best.lines||[], tries });
  } catch (e) {
    console.error('DEEPL-OCR ERROR:', e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});

// Yüklenen görüntüyü PDF'e yerleştir + görünmez metin ekle
app.post('/api/ocr/deeplearn-to-pdf', authRequired, async (req, res) => {
  try {
    const { filename } = req.body || {};
    if (!filename) return res.status(400).json({ error:'filename zorunlu' });

    const safe = path.basename(filename);
    const inAbs = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(inAbs)) return res.status(404).json({ error:'dosya yok' });

    const isPdf = /\.pdf$/i.test(inAbs);
    let basePdfBuffer;

    if (isPdf) {
      basePdfBuffer = await fs.promises.readFile(inAbs);
    } else {
      // basit: görseli A4'e yerleştir
      const imgBuf = await fs.promises.readFile(inAbs);
      const doc = await PDFDocument.create();
      const page = doc.addPage([595, 842]); // A4 pt
      const img = await doc.embedJpg(imgBuf).catch(async()=>await doc.embedPng(imgBuf));
      const { width, height } = img.scaleToFit(560, 800);
      page.drawImage(img, { x:(595-width)/2, y:(842-height)/2, width, height });
      basePdfBuffer = await doc.save();
    }

    // metni al
    const buffer = await fs.promises.readFile(inAbs);
    let deep = null;
    if (isPdf) { deep = await azureRead(buffer, "application/pdf"); }
    else {
      try { deep = await azureRead(buffer, mime.lookup(inAbs) || 'image/jpeg'); } catch {}
      if (!deep?.text) { try { deep = await googleVision(buffer); } catch {} }
      if (!deep?.text) { try { deep = await paddleOcr(inAbs); } catch {} }
    }
    const text = deep?.text || "";

    // görünmez katman ekle
    const finalPdf = await overlayInvisibleText(Buffer.from(basePdfBuffer), text);
    const outName = `${path.basename(filename, path.extname(filename))}-deep-${Date.now()}.pdf`;
    const outPath = path.join(OUT_DIR, outName);
    await fs.promises.writeFile(outPath, finalPdf);

    res.json({ ok:true, provider:deep?.provider||"unknown", url:`/out/${outName}` });
  } catch (e) {
    console.error('DEEPL-TO-PDF ERROR:', e);
    res.status(500).json({ ok:false, error:String(e) });
  }
});


// me
app.get('/api/me', authRequired, (req, res) => {
  res.json({ id: req.user.uid, email: req.user.email, display_name: req.user.name });
});

// Tek satırlık parçayı (kırpılmış görsel) Tesseract ile OCR’lar, düz metin döner
async function ocrSingleLineFromImagePath(imagePath, lang = 'tur+eng') {
  const tmpPng = path.join(UPLOAD_DIR, `tmp-line-${Date.now()}.png`);

  // hafif temizleme + gri
  let img = sharp(imagePath)
    .rotate()
    .flatten({ background: '#ffffff' })
    .grayscale()
    .normalize()
    .sharpen(1);

  await img.png().toFile(tmpPng);

  const args = [tmpPng, 'stdout', '-l', lang, '--psm', '7']; // psm 7 = tek satır
  try {
    const { stdout } = await execFile('tesseract', args, { windowsHide: true });
    return stdout.trim();
  } finally {
    try { await fs.promises.unlink(tmpPng); } catch {}
  }
}


// ================== DİNAMİK CROP + TEK SATIR OCR ==================
// body: { filename, box: { x, y, width, height }, lang? }
// x,y,width,height → ORİJİNAL GÖRSEL PİKSEL KOORDİNATLARI
app.post('/api/crop-ocr-line', authRequired, async (req, res) => {
  try {
    const { filename, box, lang = 'tur+eng' } = req.body || {};
    if (!filename || !box) {
      return res.status(400).json({ ok: false, error: 'filename ve box zorunlu' });
    }

    const safeName = path.basename(filename);
    const inputPath = path.join(UPLOAD_DIR, safeName);
    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ ok: false, error: 'Görsel bulunamadı' });
    }

    const { x, y, width, height } = box;
    if (
      width <= 0 || height <= 0 ||
      x < 0 || y < 0
    ) {
      return res.status(400).json({ ok: false, error: 'Geçersiz box değerleri' });
    }

    // 1) Crop için geçici dosya adı
    const croppedPath = path.join(
      UPLOAD_DIR,
      `crop-${Date.now()}-${safeName}`
    );

    // 2) sharp ile kes
    await sharp(inputPath)
      .extract({
        left: Math.round(x),
        top: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      })
      .toFile(croppedPath);

    // 3) Kesilmiş parça üzerinde tek satır OCR (psm 7)
    const text = await ocrSingleLineFromImagePath(croppedPath, lang);

    // 4) geçici dosyayı temizle
    try { await fs.promises.unlink(croppedPath); } catch {}

    return res.json({
      ok: true,
      text,
    });
  } catch (e) {
    console.error('CROP-OCR ERROR:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});



// -------------------- OCRmyPDF AUTODETECT + SAFE EXEC --------------------

let OCRMY_CMD = null; // ör: ['ocrmypdf'] veya ['py','-m','ocrmypdf']

async function detectOcrmypdf() {
  const candidates = [
    ['ocrmypdf', '--version'],
    ['py', '-m', 'ocrmypdf', '--version'],
    ['python', '-m', 'ocrmypdf', '--version'],
    ['python3', '-m', 'ocrmypdf', '--version'],
  ];
  for (const cand of candidates) {
    try {
      await execFile(cand[0], cand.slice(1), { windowsHide: true });
      OCRMY_CMD = cand.slice(0, cand[0] === 'ocrmypdf' ? 1 : 2); // komutun kendisi (arg'siz kök)
      console.log('OCRmyPDF command =', OCRMY_CMD.join(' '));
      return;
    } catch {}
  }
  console.warn('ocrmypdf bulunamadı; görseller için Tesseract fallback kullanılacak.');
  OCRMY_CMD = null;
}

async function safeExec(cmd, args, opts = {}) {
  try {
    const { stdout, stderr } = await execFile(cmd, args, { windowsHide: true, ...opts });
    return { ok: true, stdout, stderr };
  } catch (e) {
    return {
      ok: false,
      stdout: e?.stdout?.toString?.() || '',
      stderr: e?.stderr?.toString?.() || e?.message || String(e),
    };
  }
}

// -------------- GENEL ROUTE’LAR --------------

app.get('/test-singleline', async (req, res) => {
  const testImg = path.join(UPLOAD_DIR, 'sample-line.png');
  const text = await ocrSingleLineFromImagePath(testImg, 'tur+eng');
  res.json({ text });
});

// health
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// DB hızlı kontrol
app.get('/api/db-check', async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT current_database() db, now() ts, COUNT(*) c
      FROM uploads
    `);
    res.json(r.rows[0]);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ÇOKLU YÜKLEME + DB'ye INSERT (kim yükledi?)
app.post('/api/upload', authRequired, upload.array('images', 20), async (req, res) => {
  try {
    const files = (req.files || []).map(f => ({
      filename: path.basename(f.filename),
      url: `/static/${path.basename(f.filename)}`,
      size: f.size,
      mimetype: f.mimetype,
    }));

    const saved = [];
    for (const f of files) {
      const { rows } = await pool.query(
        `INSERT INTO uploads (filename, url, size, mimetype, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, created_at`,
        [f.filename, f.url, f.size, f.mimetype, req.user.uid]
      );
      const row = {
        id: rows[0].id,
        created_at: rows[0].created_at,
        ...f,
        uploaded_by: { id: req.user.uid, email: req.user.email, display_name: req.user.name }
      };
      console.log('INSERT OK →', row);
      saved.push(row);
    }

    return res.json({ count: saved.length, files: saved });
  } catch (e) {
    console.error('UPLOAD ERROR:', e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

// 🔹 OCR TEST ROUTE — hızlı doğrulama için
app.get('/api/ocr-test', (req, res) => res.json({ ok: true }));

// ===================== ESKİ PARAMETRELİ OCR (opsiyonel kalabilir) =====================
// İstersen UI'da kullanma. İstersen aşağıdaki endpoint'i /api/ocr/auto'ya yönlendirebilirsin.
app.post('/api/ocr', authRequired, async (req, res) => {
  console.log('OCR REQ BODY:', req.body);
  const tmpPaths = [];
  try {
    const {
      filename,
      lang = 'tur+eng',
      dpi = 600,
      psm = 6,
      quality = 'auto',
      clean = false
    } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename zorunlu' });

    const safeName = path.basename(filename);
    const inputPath = path.join(UPLOAD_DIR, safeName);
    if (!fs.existsSync(inputPath)) return res.status(404).json({ error: 'Dosya bulunamadı' });

    const base = path.basename(safeName, path.extname(safeName));
    const outBase = path.join(OUT_DIR, `${base}-${Date.now()}`);
    const outPdf  = `${outBase}.pdf`;

    // --- PREPROCESS: iki kalite profili (soft / hard)
    async function buildTiff(variant) {
      const tiffPath = path.join(UPLOAD_DIR, `tmp-ocr-${variant}-${Date.now()}.tif`);
      tmpPaths.push(tiffPath);

      let img = sharp(inputPath)
        .rotate()
        .flatten({ background: '#ffffff' })  // alfa → beyaz
        .trim()                               // kenar boşluklarını al
        .grayscale()
        .normalize()                          // kontrast/normalize
        .median(1)                            // hafif gürültü temizliği
        .sharpen(1);                          // hafif netleştirme

      // hedef genişlik: A4 @ 600dpi ≈ 4960px (300dpi için ≈ 2480px)
      const targetW = dpi >= 600 ? 4960 : 2480;
      const meta = await img.metadata();
      if ((meta?.width || 0) > targetW) img = img.resize({ width: targetW });

      // "hard" profil: ikileme (binarize) — el yazısında bazen daha iyi
      if (variant === 'hard') img = img.threshold(165); // 150–185 denenebilir

      await img.tiff({
        compression: 'lzw',
        xres: dpi, yres: dpi, resolutionUnit: 'inch'
      }).toFile(tiffPath);

      return tiffPath;
    }

    // inputTiff: preprocess edilmiş TIFF/PNG yolu
    // outPath  : üretilecek PDF yolun
    // sidecarPath (opsiyonel): düz metin yan dosyası
    async function runOcrmypdf(inputTiff, outPath, sidecarPath) {
      const args = [
        '--language', lang,
        '--rotate-pages',
        '--deskew',
        '--image-dpi', String(dpi),
        '--optimize', '0',
        // '--output-type', 'pdfa-2',
        '--force-ocr'
      ];
      if (clean) args.push('--clean', '--clean-final');
      if (sidecarPath) args.push('--sidecar', sidecarPath);
      args.push(inputTiff, outPath);

      try {
        await execFile('ocrmypdf', args, { windowsHide: true });
      } catch {
        await execFile('py', ['-m', 'ocrmypdf', ...args], { windowsHide: true });
      }
    }

    const variants = quality === 'auto' ? ['soft', 'hard'] : [quality];
    const results = [];

    for (const v of variants) {
      const tiff = await buildTiff(v);
      const pdf  = (v === variants[variants.length - 1]) ? outPdf : `${outBase}-${v}.pdf`;
      const side = `${pdf}.txt`;
      tmpPaths.push(side);

      await runOcrmypdf(tiff, pdf, side);

      // Çıkan metnin uzunluğu ≈ kalitenin kaba ölçüsü
      let score = 0;
      try {
        const txt = await fs.promises.readFile(side, 'utf8');
        score = (txt || '').replace(/\s+/g, '').length;
      } catch {}
      results.push({ variant: v, pdf, side, score });
    }

    // en iyi sonucu seç
    let best = results[0];
    for (const r of results) if (r.score > best.score) best = r;
    if (best.pdf !== outPdf) fs.copyFileSync(best.pdf, outPdf);

    if (!fs.existsSync(outPdf)) return res.status(500).json({ error: 'PDF oluşturulamadı' });

    // geçicileri temizle
    for (const p of tmpPaths) { try { await fs.promises.unlink(p); } catch {} }

    const pdfName = path.basename(outPdf);
    return res.json({
      ok: true,
      url: `/out/${pdfName}`,
      filename: pdfName,
      picked_variant: best.variant
    });

  } catch (e) {
    console.error('OCR ERROR:', e?.stderr || e);
    return res.status(500).json({ error: e?.stderr || e?.message || String(e) });
  }
});

// ===================== YENİ: TEK TUŞ OTOMATİK OCR =====================

// Görseli TIFF'e hazırla; PDF ise aynen kullan
async function prepareInputForOcr(sourcePath, dpi = 600) {
  const ext = path.extname(sourcePath).toLowerCase();
  const isPdf = ext === '.pdf';

  if (isPdf) return { kind: 'pdf', path: sourcePath };

  const tiffPath = path.join(UPLOAD_DIR, `tmp-ocr-src-${Date.now()}.tif`);
  let img = sharp(sourcePath)
    .rotate()
    .flatten({ background: '#ffffff' })
    .trim()
    .grayscale()
    .normalize()
    .median(1)
    .sharpen(1);

  const targetW = dpi >= 600 ? 4960 : 2480;
  const meta = await img.metadata();
  if ((meta?.width || 0) > targetW) img = img.resize({ width: targetW });

  await img.tiff({ compression: 'lzw', xres: dpi, yres: dpi, resolutionUnit: 'inch' })
          .toFile(tiffPath);

  return { kind: 'tiff', path: tiffPath };
}

// Tesseract fallback (görsel → PDF)
async function tesseractImageToPdf(imagePath, lang='tur+eng', psm=3) {
  const outPdf = path.join(OUT_DIR, `${path.parse(imagePath).name}-tess.pdf`);
  const args = [imagePath, outPdf.replace(/\.pdf$/,''), '-l', lang, '--psm', String(psm), 'pdf'];
  const r = await safeExec('tesseract', args);
  if (!r.ok) throw new Error('tesseract fallback error: ' + r.stderr);
  return outPdf;
}

async function ocrAutoPipeline(inputAbsPath, lang='tur+eng') {
  const prepared = await prepareInputForOcr(inputAbsPath, 600);
  const base = path.basename(inputAbsPath, path.extname(inputAbsPath));
  const outBase = path.join(OUT_DIR, `${base}-${Date.now()}`);
  const outFinal = `${outBase}.pdf`;

  // 1) OCRmyPDF mevcutsa iki profil dene (soft -> hard+clean)
  if (OCRMY_CMD) {
    const tries = [
      { name:'soft', clean:false },
      { name:'hard', clean:true },
    ];
    const results = [];

    for (const t of tries) {
      const pdf = `${outBase}-${t.name}.pdf`;
      const side = `${pdf}.txt`;

      const cmd = OCRMY_CMD[0];
      const ocrmArgs = [
        ...(OCRMY_CMD.length > 1 ? OCRMY_CMD.slice(1) : []), // 'py -m ocrmypdf' durumu
        '--language', lang,
        '--rotate-pages', '--deskew',
        '--image-dpi', '600',
        '--force-ocr',
        '--optimize', '0',
        ...(t.clean ? ['--clean','--clean-final'] : []),
        prepared.path, pdf
      ];

      const r = await safeExec(cmd, ocrmArgs);
      if (!r.ok) {
        results.push({ name: t.name, pdf: null, score: -1, error: r.stderr });
        continue;
      }

      // sidecar her sistemde oluşturulmayabilir; varsa skorla
      let score = 0;
      try {
        if (fs.existsSync(side)) {
          const txt = await fs.promises.readFile(side, 'utf8');
          score = (txt || '').replace(/\s+/g, '').length;
        }
      } catch {}
      results.push({ name: t.name, pdf, score, error: null });
    }

    const okOnes = results.filter(r => r.pdf);
    if (okOnes.length) {
      let best = okOnes[0];
      for (const r of okOnes) if (r.score > best.score) best = r;
      fs.copyFileSync(best.pdf, outFinal);
      try { if (prepared.kind === 'tiff') await fs.promises.unlink(prepared.path); } catch {}
      return { pdf: outFinal, variant: best.name };
    }

    // hepsi başarısızsa: hataları logla ve fallback'e geç
    const joined = results.map(r => r.error).filter(Boolean).join('\n---\n');
    console.warn('ocrmypdf başarısız, fallback tesseract. Details:\n', joined);
  }

  // 2) Fallback: Tesseract (sadece görsel inputlarda)
  if (prepared.kind === 'tiff') {
    const pdf = await tesseractImageToPdf(prepared.path, lang, 3);
    const final = `${outBase}-tess.pdf`;
    fs.copyFileSync(pdf, final);
    try { await fs.promises.unlink(prepared.path); } catch {}
    return { pdf: final, variant: 'tesseract' };
  }

  // PDF giriş + ocrmypdf yok
  throw new Error('ocrmypdf bulunamadı ve giriş PDF. Lütfen ocrmypdf (Ghostscript + qpdf ile) kurun.');
}

// Tek parametre: filename (UI sadece bunu yollar)
app.post('/api/ocr/auto', authRequired, async (req, res) => {
  try {
    const { filename, lang = 'tur+eng' } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename zorunlu' });

    const safe = path.basename(filename);
    const inputAbs = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(inputAbs)) return res.status(404).json({ error: 'dosya yok' });

    const { pdf, variant } = await ocrAutoPipeline(inputAbs, lang);
    res.json({ ok:true, url: `/out/${path.basename(pdf)}`, picked_variant: variant });
  } catch (e) {
    console.error('OCR/AUTO ERROR:', e);
    res.status(500).json({ ok:false, error: 'ocr_failed', error_detail: String(e?.message || e) });
  }
});

// helpers: OUT_DIR içindeki PDF'leri bul (toleranslı eşleştirme: base veya anahtar kelime)
function findOcrPdfsFor(filename) {
  try {
    const base = path.basename(filename, path.extname(filename));   // 1760...-thirdimg
    const keyword = (base.split('-').pop() || base).toLowerCase();  // thirdimg
    const baseLower = base.toLowerCase();

    if (!fs.existsSync(OUT_DIR)) return [];

    const entries = fs.readdirSync(OUT_DIR, { withFileTypes: true });
    const files = entries.filter(d => d.isFile()).map(d => d.name);

    const matched = files.filter((name) => {
      const lower = name.toLowerCase();
      if (!lower.endsWith('.pdf')) return false;

      // 1) tam base + '-' ile başlıyorsa
      if (lower.startsWith(baseLower + '-')) return true;

      // 2) anahtar kelime içeriyorsa
      if (
        lower.includes(`-${keyword}-`) ||
        lower.startsWith(`${keyword}-`) ||
        lower.endsWith(`-${keyword}.pdf`) ||
        lower.includes(keyword)
      ) return true;

      return false;
    });

    matched.sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // yeni → eski
    return matched.map(name => ({ name, href: `/out/${name}` }));
  } catch {
    return [];
  }
}

// --- Son 20 kaydı listele (yükleyen bilgisi + OCR linkleri + debug)
app.get('/api/uploads', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id,
              u.filename,
              u.url,
              u.size,
              u.mimetype,
              u.created_at,
              us.display_name,
              us.email
       FROM uploads u
       JOIN users us ON us.id = u.uploaded_by
       ORDER BY u.created_at DESC
       LIMIT 20`
    );

    const outExists = fs.existsSync(OUT_DIR);
    const outCount  = outExists ? fs.readdirSync(OUT_DIR).length : 0;

    const enriched = rows.map(r => {
      const ocrs = findOcrPdfsFor(r.filename); // [{name, href}, ...]
      const base = path.basename(r.filename, path.extname(r.filename));
      const keyword = (base.split('-').pop() || base);

      return {
        ...r,
        has_ocr: ocrs.length > 0,
        latest_ocr_url: ocrs[0]?.href || null,
        ocr_urls: ocrs.map(o => o.href),

        // --- debug alanları
        _debug_keyword: keyword,
        _debug_out_dir: OUT_DIR,
        _debug_out_exists: outExists,
        _debug_out_files_count: outCount,
        _debug_matched_names: ocrs.map(o => o.name),
      };
    });

    res.json(enriched);
  } catch (e) {
    console.error('UPLOADS LIST ERROR:', e);
    res.status(500).json({ error: String(e) });
  }
});

// ========== HELPER: Preprocess tek görüntü (soft/hard) ==========
async function preprocessImage(inputPath, variant = 'soft', dpi = 600) {
  const tmpOut = path.join(UPLOAD_DIR, `tmp-pre-${variant}-${Date.now()}.png`);
  let img = sharp(inputPath)
    .rotate()
    .flatten({ background: '#ffffff' })
    .trim()
    .grayscale()
    .normalize()
    .median(1)
    .sharpen(1);

  const targetW = dpi >= 600 ? 4960 : 2480; // A4 @600/300dpi
  const meta = await img.metadata();
  if ((meta?.width || 0) > targetW) img = img.resize({ width: targetW });

  if (variant === 'hard') img = img.threshold(165); // 150–185 deneyebilirsin

  await img.png().toFile(tmpOut);
  return tmpOut;
}

// ========== HELPER: Tesseract TSV al ==========
async function tesseractTsv(imagePath, lang = 'tur+eng', psm = 6) {
  // tesseract <img> stdout -l tur+eng --psm 6 tsv
  const args = [imagePath, 'stdout', '-l', lang, '--psm', String(psm), 'tsv'];
  const { stdout } = await execFile('tesseract', args, { windowsHide: true });
  return stdout;
}

// ========== HELPER: TSV parse ==========
function parseTsv(tsvText) {
  const lines = tsvText.split(/\r?\n/);
  const header = lines.shift()?.split('\t') || [];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const cols = line.split('\t');
    const text = cols[idx.text] || '';
    if (text === undefined) continue;
    out.push({
      level: Number(cols[idx.level] || 0),
      page_num: Number(cols[idx.page_num] || 0),
      block_num: Number(cols[idx.block_num] || 0),
      par_num: Number(cols[idx.par_num] || 0),
      line_num: Number(cols[idx.line_num] || 0),
      word_num: Number(cols[idx.word_num] || 0),
      left: Number(cols[idx.left] || 0),
      top: Number(cols[idx.top] || 0),
      width: Number(cols[idx.width] || 0),
      height: Number(cols[idx.height] || 0),
      conf: Number(cols[idx.conf] || -1),
      text,
    });
  }
  // sadece kelime satırları (level=5) işimize yarıyor
  return out.filter(w => w.level === 5 && (w.text || '').trim());
}

// ========== HELPER: Etiketin sağındaki değeri çıkar ==========
function extractRightValue(tsvWords, labelRegex) {
  // Aynı satır (line_num) üstünden çalışacağız
  // 1) label kelimesini bul
  const candidates = tsvWords
    .map((w, i) => ({ ...w, i }))
    .filter(w => labelRegex.test(w.text.normalize('NFKD')));

  if (candidates.length === 0) return '';

  // 2) en soldaki eşleşeni al (genellikle doğru etiket)
  candidates.sort((a, b) => a.left - b.left);
  const lab = candidates[0];

  // 3) aynı satırdaki, lab.right'tan sonra gelen kelimeleri birleştir
  const lineWords = tsvWords.filter(w => w.line_num === lab.line_num);
  const labRight = lab.left + lab.width;
  const rightWords = lineWords
    .filter(w => (w.left > labRight + 5))      // etiketin sağında
    .sort((a, b) => a.left - b.left);

  const value = rightWords.map(w => w.text).join(' ').trim();
  return value;
}

// ========== API: Otomatik alan tespiti (/api/ocr-auto-lines) ==========
app.post('/api/ocr-auto-lines', authRequired, async (req, res) => {
  try {
    const {
      filename,
      dpi = 600,
      lang = 'tur+eng',
      psm = 6,                 // satır yapısı için 6 iyi
      variant = 'soft',        // 'soft' | 'hard' – çok düşük kontrastta 'hard' deneyebilirsin
      // field label regex'leri override edilebilir:
      labels = {
        istem_tarihi: /(istem\s*tarihi|istem\s*tar)/i,
        saat: /\b(saat|sa:|saat[:.])\b/i,
        mahalle: /(mahalle|köy[üu])/i,
        // örnek: sıra_no: /(sıra|fis|fiş)\s*no/i
      }
    } = req.body || {};
    if (!filename) return res.status(400).json({ error: 'filename zorunlu' });

    const safe = path.basename(filename);
    const inPath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(inPath)) return res.status(404).json({ error: 'Dosya bulunamadı' });

    // 1) preprocess (soft/hard)
    const pre = await preprocessImage(inPath, variant, dpi);

    // 2) tesseract TSV
    const tsvText = await tesseractTsv(pre, lang, psm);
    const words = parseTsv(tsvText);

    // 3) etiketlerin sağındaki değerleri çıkar
    const result = {};
    for (const [key, rx] of Object.entries(labels)) {
      result[key] = extractRightValue(words, rx) || '';
    }

    // temizlik
    try { await fs.promises.unlink(pre); } catch {}

    return res.json({
      ok: true,
      fields: result,
      debug: {
        used_variant: variant,
        dpi,
        psm,
        words_count: words.length
      }
    });
  } catch (e) {
    console.error('OCR-AUTO-LINES ERROR:', e);
    return res.status(500).json({ error: e?.stderr || e?.message || String(e) });
  }
});



// ===================== DİNAMİK CROP + SATIR OCR =====================
// body: { filename, lang?, box: { x, y, w, h } }  hepsi 0–1 arası oran
// ===================== CROP + TEK SATIR OCR =====================
app.post("/api/ocr/crop-line", authRequired, async (req, res) => {
  try {
    const { filename, box, lang = "tur+eng" } = req.body || {};
    if (!filename || !box) {
      return res.status(400).json({ ok: false, error: "filename ve box zorunlu" });
    }

    const safe = path.basename(filename);
    const inPath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(inPath)) {
      return res.status(404).json({ ok: false, error: "dosya bulunamadı" });
    }

    // 1) Orijinal görsel boyutlarını al
    const img = sharp(inPath).rotate(); // EXIF rotate
    const meta = await img.metadata();
    const W = meta.width || 0;
    const H = meta.height || 0;
    if (!W || !H) {
      return res.status(500).json({ ok: false, error: "görsel boyutu okunamadı" });
    }

    // 2) Normalize (0–1) box'tan piksel koordinatları hesapla
    const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
    const nx = clamp01(box.x);
    const ny = clamp01(box.y);
    const nw = clamp01(box.w);
    const nh = clamp01(box.h);

    let left   = Math.round(W * nx);
    let top    = Math.round(H * ny);
    let width  = Math.round(W * nw);
    let height = Math.round(H * nh);

    // min boyut ve sınırları zorla
    const MIN = 20;
    width = Math.max(MIN, Math.min(width,  W - left));
    height = Math.max(MIN, Math.min(height, H - top));

    // 3) Seçili alanı crop + preprocess et
    const tmpCrop = path.join(UPLOAD_DIR, `tmp-crop-${Date.now()}.png`);
    await sharp(inPath)
      .rotate()
      .extract({ left, top, width, height })
      .flatten({ background: "#ffffff" })
      .grayscale()
      .normalize()
      .sharpen(1)
      .threshold(160)            // el yazısı için biraz ikileştirme
      .toFile(tmpCrop);

    // 4) Tesseract ile tek satır/az satır OCR (PSM 7)
    // tesseract tmp-crop.png stdout -l tur+eng --psm 7
    const args = [tmpCrop, "stdout", "-l", lang, "--psm", "7"];
    const { stdout } = await execFile("tesseract", args, { windowsHide: true });
    const text = (stdout || "").trim();

    // 5) temp dosyayı temizle
    try { await fs.promises.unlink(tmpCrop); } catch {}

    console.log("CROP-LINE OCR →", {
      filename: safe,
      box: { nx, ny, nw, nh },
      px: { left, top, width, height },
      sample: text.slice(0, 80),
    });

    return res.json({ ok: true, text });
  } catch (e) {
    console.error("CROP-LINE ERROR:", e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


app.post("/api/ocr/crop", authRequired, async (req, res) => {
  try {
    const { filename, x, y, w, h } = req.body;
    if (!filename) return res.status(400).json({ error: "filename gerekli" });

    const safe = path.basename(filename);
    const inputPath = path.join(UPLOAD_DIR, safe);

    const prepPath = await preprocessForCrop(inputPath);
    const meta = await sharp(prepPath).metadata();

    const cropX = Math.floor(x * meta.width);
    const cropY = Math.floor(y * meta.height);
    const cropW = Math.floor(w * meta.width);
    const cropH = Math.floor(h * meta.height);

    // DEBUG: değerleri logla
    console.log("CROP COORDS", { x, y, w, h, cropX, cropY, cropW, cropH });

    // 3) crop al – hem OCR için hem debug için kaydediyoruz
    const debugName = `crop-${Date.now()}.png`;
    const cropPath  = path.join(OUT_DIR, debugName);

    await sharp(prepPath)
      .extract({ left: cropX, top: cropY, width: cropW, height: cropH })
      .png()
      .toFile(cropPath);

    // 4) OCR
    const txt = await ocrSingleLineFromImagePath(cropPath, "tur+eng");

    return res.json({
      ok: true,
      text: txt,
      debug_url: `/out/${debugName}`  // tarayıcıdan bakabil
    });
  } catch (e) {
    console.error("CROP OCR ERROR:", e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});



// --- 404 (en sonda)
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// Global error handler (en sonda dursun)
app.use((err, req, res, next) => {
  try { console.error('UNCAUGHT ERROR:', err); } catch {}
  if (res.headersSent) return;
  res.status(500).json({ error: 'server', detail: String(err?.message || err) });
});

// --- graceful bootstrap & listen (en sonda)
(async () => {
  try {
    const r = await pool.query('select current_database() db');
    console.log('DB OK →', r.rows[0].db);

    await ensureSchema();
    await detectOcrmypdf(); // << önemli: ocrmypdf komutunu başta tespit et

    const PORT = Number(process.env.PORT || 5000);
    app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));
  } catch (e) {
    console.error('BOOT ERROR:', e);
    process.exit(1);
  }
})();

async function preprocessForCrop(srcPath) {
  const sharp = (await import('sharp')).default;
  const out = srcPath.replace(/(\.[^.]+)$/, "_prep.png");

  let img = sharp(srcPath)
    .rotate()
    .flatten({ background: "#ffffff" })
    .trim()
    .grayscale()
    .normalize()
    .median(1)
    .sharpen(1)
    .resize({ width: 2500 }); // OCR için 3-4x büyüt

  await img.png().toFile(out);
  return out;
}
