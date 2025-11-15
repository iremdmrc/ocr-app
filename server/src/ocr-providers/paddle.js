import { promisify } from "util";
import { execFile as _execFile } from "child_process";
import fs from "fs";
import path from "path";
const execFile = promisify(_execFile);

const PY = process.env.PYTHON_EXE || "python3";
const PADDLE_LANG = process.env.PADDLE_LANG || "latin";

/** imagePath ver; çıktı text döner (satır listesi basit). */
export async function paddleOcr(imagePath) {
  const outDir = path.join(path.dirname(imagePath), `paddle_out_${Date.now()}`);
  const args = ["-m","paddleocr","-i",imagePath,"-l",PADDLE_LANG,"--use_angle_cls","true","--output",outDir];
  try { await execFile(PY, args, { windowsHide:true }); }
  catch (e) { throw new Error("PaddleOCR çalışmadı: " + (e?.stderr || e?.message)); }
  const txt = path.join(outDir, path.basename(imagePath) + ".txt");
  let text = ""; if (fs.existsSync(txt)) text = await fs.promises.readFile(txt, "utf8");
  return { provider:"paddle", text, lines: [] };
}
