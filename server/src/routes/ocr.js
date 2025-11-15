// server/src/routes/ocr.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const sharp = require('sharp'); // <-- YENİ
const { pool } = require('../db');
const { ensureDir } = require('../util.fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { imageSize } = require('image-size');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
const OUTPUT_DIR = process.env.OUTPUT_DIR || 'outputs';
const PYTHON = process.env.PYTHON_PATH || 'python'; // gerekirse .env ile özelleştir

/**
 * Tek görsel için Python OCR çalıştırır ve JSON payload döner.
 */
function runPythonOcr(absImagePath) {
  return new Promise((resolve, reject) => {
    const py = spawn(PYTHON, ['ocr/main.py', '--image', absImagePath], {
      cwd: process.cwd(),
    });

    let out = '';
    let err = '';

    py.stdout.on('data', (d) => (out += d.toString()));
    py.stderr.on('data', (d) => (err += d.toString()));

    py.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`OCR failed (code ${code}): ${err}`));
      }
      try {
        const payload = JSON.parse(out);
        return resolve(payload);
      } catch (e) {
        return reject(
          new Error(`Invalid OCR JSON: ${e.message}\nOUT:\n${out}\nERR:\n${err}`)
        );
      }
    });
  });
}

/**
 * OCR JSON (image_size + items[bbox,text]) verisini,
 * sayfaya yerleştirilmiş görselin koordinat sistemine çevirip görünmez metin olarak çizer.
 */
async function drawInvisibleTextFromPayload(page, font, payload, drawImageRect) {
  const { width: imgW, height: imgH } = payload.image_size; // OCR'nin bildirdiği görsel boyutu (px)
  const { x, y, w: drawnW, h: drawnH } = drawImageRect; // sayfadaki yerleşim (bizde 0,0,w,h olacak)

  const scaleX = drawnW / imgW;
  const scaleY = drawnH / imgH;

  for (const it of payload.items || []) {
    const [bx, by, bw, bh] = it.bbox; // OCR kutusu (sol-üst köşe bazlı)

    const px = x + bx * scaleX;

    // PDF Y ekseni alttan büyür, OCR üstten.
    const ph = bh * scaleY;
    const py = y + (drawnH - (by + bh) * scaleY);

    const size = Math.max(8, Math.round(ph * 0.7));
    page.drawText(it.text || '', {
      x: px,
      y: py,
      size,
      font,
      color: rgb(0, 0, 0),
      opacity: 0.001, // görünmez
      maxWidth: Math.max(8, bw * scaleX),
      lineHeight: Math.max(8, Math.round(ph * 0.95)),
    });
  }
}

/**
 * Belirli bir görsel için:
 * - EXIF'e göre auto-rotate uygular
 * - normalize edilmiş görseli geçici bir dosyaya yazar
 * - bu dosyayı hem PDF'e embed eder hem de OCR için kullanır
 */
async function prepareNormalizedImage(absPath) {
  const ext = path.extname(absPath) || '.jpg';
  const normPath = absPath.replace(ext, `__norm${ext}`);

  // Görseli döndür + olduğu gibi kaydet (kırpma yok)
  await sharp(absPath).rotate().toFile(normPath);

  const normBytes = fs.readFileSync(normPath);
  const dim = imageSize(normBytes);

  return { normPath, normBytes, dim };
}

router.post('/ocr/:documentId', async (req, res) => {
  try {
    const { documentId } = req.params;

    const { rows: images } = await pool.query(
      `SELECT filename, rel_path FROM images WHERE document_id=$1 ORDER BY id`,
      [documentId]
    );
    if (!images.length) {
      return res.status(400).json({ ok: false, error: 'No images to process.' });
    }

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

    for (const img of images) {
      const abs = path.join(process.cwd(), UPLOAD_DIR, img.filename);

      // --- 1) Görseli normalize et (auto-rotate) ve boyutlarını al ---
      const { normPath, normBytes, dim } = await prepareNormalizedImage(abs);

      // --- 2) Normalize edilmiş görseli PDF'e embed et ---
      const ext = path.extname(img.filename).toLowerCase();
      const embedded =
        ext === '.jpg' || ext === '.jpeg' || ext === '.jfif'
          ? await pdfDoc.embedJpg(normBytes)
          : await pdfDoc.embedPng(normBytes);

      // Sayfa boyutunu birebir görsel boyutuna eşitle
      const pageWidth = dim.width;
      const pageHeight = dim.height;
      const page = pdfDoc.addPage([pageWidth, pageHeight]);

      const x = 0;
      const y = 0;
      const w = pageWidth;
      const h = pageHeight;

      page.drawImage(embedded, { x, y, width: w, height: h });

      // --- 3) OCR'i normalize edilmiş görsel üzerinde çalıştır ---
      const payload = await runPythonOcr(normPath);

      // --- 4) OCR bounding box'larını görünmez metin olarak çiz ---
      await drawInvisibleTextFromPayload(page, font, payload, { x, y, w, h });

      // --- 5) Geçici normalize edilmiş görseli sil ---
      fs.unlink(normPath, () => {});
    }

    const pdfBytes = await pdfDoc.save();

    const outDir = path.join(process.cwd(), OUTPUT_DIR, documentId);
    ensureDir(outDir);
    const outPath = path.join(outDir, 'result-searchable.pdf');
    fs.writeFileSync(outPath, pdfBytes); // encoding vermiyoruz → binary

    const rel = path.relative(process.cwd(), outPath).replace(/\\/g, '/');

    await pool.query(
      `
      INSERT INTO ocr_results (document_id, pdf_rel_path, lang, pages)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (document_id) DO UPDATE SET
        pdf_rel_path=EXCLUDED.pdf_rel_path,
        lang=EXCLUDED.lang,
        pages=EXCLUDED.pages,
        created_at=NOW()
    `,
      [documentId, rel, req.body.lang || null, images.length]
    );

    res.json({ ok: true, pdf: rel });
  } catch (e) {
    console.error('OCR route error:', e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get('/pdf/:documentId', async (req, res) => {
  const { documentId } = req.params;
  const { rows } = await pool.query(
    `SELECT pdf_rel_path FROM ocr_results WHERE document_id=$1`,
    [documentId]
  );
  if (!rows.length) return res.status(404).json({ ok: false, error: 'PDF not found' });

  const fileAbs = path.join(process.cwd(), rows[0].pdf_rel_path);
  res.sendFile(fileAbs);
});

module.exports = router;
