import axios from "axios";
const ENDPOINT = process.env.AZURE_VISION_ENDPOINT?.replace(/\/$/,'');
const KEY = process.env.AZURE_VISION_KEY;

export async function azureRead(buffer, mime="application/octet-stream") {
  if (!ENDPOINT || !KEY) throw new Error("Azure Vision config yok");
  const url = `${ENDPOINT}/vision/v3.2/read/analyze`;
  const headers = { "Ocp-Apim-Subscription-Key": KEY, "Content-Type": mime };
  const post = await axios.post(url, buffer, { headers, validateStatus: s => s===202 });
  const op = post.headers["operation-location"];
  if (!op) throw new Error("Azure Read operation-location yok");

  for (let i=0;i<30;i++) {
    await new Promise(r=>setTimeout(r, 1000));
    const r = await axios.get(op, { headers: { "Ocp-Apim-Subscription-Key": KEY } });
    if (r.data?.status === "succeeded") {
      const pages = r.data?.analyzeResult?.readResults || r.data?.analyzeResult?.pages || [];
      const lines = [];
      for (const pg of pages) for (const ln of (pg.lines||[]))
        lines.push({ text: ln.text, bbox: ln.boundingBox||[], page: pg.page||1 });
      return { provider:"azure", text: lines.map(l=>l.text).join("\n"), lines };
    }
    if (r.data?.status === "failed") throw new Error("Azure Read failed");
  }
  throw new Error("Azure Read timeout");
}
