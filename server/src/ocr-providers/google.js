// server/src/ocr-providers/google.js
import vision from "@google-cloud/vision";

// GOOGLE_APPLICATION_CREDENTIALS (.env) mutlak yol olmalı.
// Ör: GOOGLE_APPLICATION_CREDENTIALS=C:\...\server\keys\google-sa.json
const client = new vision.ImageAnnotatorClient();

/**
 * Google Vision ile el yazısı + belge OCR.
 * Buffer (önerilen) veya dosya yolu (string) alır.
 * @param {Buffer|string} input
 * @returns {{provider:string, text:string, lines:string[]}}
 */
export async function googleVision(input) {
  // Buffer veya filename olarak request hazırla
  const request = Buffer.isBuffer(input)
    ? { image: { content: input } }
    : (typeof input === "string"
        ? { image: { source: { filename: input } } }
        : (() => { throw new Error("googleVision: input must be Buffer or filename string"); })()
      );

  // El yazısında çoğu durumda documentTextDetection daha iyi
  const [result] = await client.documentTextDetection(request);
  const text = result.fullTextAnnotation?.text || "";

  // Opsiyonel: satır benzeri parçaları çıkarmak (basitleştirilmiş)
  const lines = [];
  const pages = result.fullTextAnnotation?.pages || [];
  for (const p of pages) {
    for (const block of p.blocks || []) {
      for (const para of block.paragraphs || []) {
        const words = (para.words || []).map(w => (w.symbols || []).map(s => s.text).join(""));
        if (words.length) lines.push(words.join(" "));
      }
    }
  }

  return { provider: "google", text, lines };
}
