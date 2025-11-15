// server/src/pdf-overlay.js
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Verilen PDF (veya boş PDF) üzerine "neredeyse görünmez" metin katmanı ekler.
 * @param {Buffer|null|undefined} basePdfBuffer - Mevcut PDF; yoksa boş A4 oluşturulur.
 * @param {string} text - Eklenecek OCR metni
 * @returns {Promise<Buffer>} - Çıktı PDF (Buffer)
 */
export async function overlayInvisibleText(basePdfBuffer, text) {
  let pdfDoc;
  if (basePdfBuffer && basePdfBuffer.length) {
    pdfDoc = await PDFDocument.load(basePdfBuffer);
  } else {
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]); // A4
  }

  const page = pdfDoc.getPage(0);
  const { height } = page.getSize();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  page.drawText(text || "", {
    x: 40,
    y: height - 80,
    size: 12,
    font,
    color: rgb(0, 0, 0),
    opacity: 0.001,      // ekranda görünmez; seçilebilir/aranabilir
    lineHeight: 14
  });

  const bytes = await pdfDoc.save();
  return Buffer.from(bytes);
}
