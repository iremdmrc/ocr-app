import fs from "fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export async function pdfFromOcrJSON(baseImagePath, ocrPayload) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();

  const { width: imgW, height: imgH } = ocrPayload.image_size;
  const imgBytes = fs.readFileSync(baseImagePath);
  const img = baseImagePath.toLowerCase().endsWith(".png")
    ? await pdfDoc.embedPng(imgBytes)
    : await pdfDoc.embedJpg(imgBytes);

  page.setSize(imgW, imgH);
  page.drawImage(img, { x: 0, y: 0, width: imgW, height: imgH });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const it of ocrPayload.items) {
    const [x, y, w, h] = it.bbox;
    const pdfY = imgH - (y + h);          // y ekseni dönüşümü
    const size = Math.max(8, Math.round(h * 0.70));

    page.drawText(it.text || "", {
      x, y: pdfY, size, font,
      color: rgb(0, 0, 0),
      opacity: 0.001,                     // görünmez
      maxWidth: w,
      lineHeight: Math.max(8, Math.round(h * 0.95)),
    });
  }

  return await pdfDoc.save();
}
