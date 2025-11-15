import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile as _execFile } from 'child_process';

const execFile = promisify(_execFile);

// Upload klasörünü bul
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'server', 'uploads');

export async function ocrSingleLine(imgPath, lang = 'tur+eng') {
  const ts = Date.now();
  const tmpTiff = path.join(UPLOAD_DIR, `tmp-line-${ts}.tif`);

  let img = sharp(imgPath)
    .rotate()
    .flatten({ background: '#fff' })
    .grayscale()
    .normalise()
    .sharpen(1);

  await img
    .tiff({ compression: 'lzw', xres: 600, yres: 600, resolutionUnit: 'inch' })
    .toFile(tmpTiff);

  const side = `${tmpTiff}.txt`;
  const out  = `${tmpTiff}.pdf`;
  const args = [
    '--language', lang,
    '--tesseract-psm', '7',
    '--force-ocr',
    '--output-type', 'pdf',
    '--sidecar', side,
    tmpTiff, out
  ];

  try {
    await execFile('ocrmypdf', args, { windowsHide: true });
  } catch {
    await execFile('py', ['-m', 'ocrmypdf', ...args], { windowsHide: true });
  }

  const text = fs.existsSync(side) ? await fs.promises.readFile(side, 'utf8') : '';

  for (const f of [tmpTiff, side, out]) {
    try { await fs.promises.unlink(f); } catch {}
  }

  return text.trim();
}
