import os, json, argparse, sys, tempfile
from PIL import Image
from processing import (
    deskew, enhance, segment_table_boxes, segment_line_boxes,
    crop_with_box, upsample, looks_handwritten
)
from trocr_infer import run_trocr

FIELD_MAP = {
    0: "İstem Tarihi", 1: "Saat/Dakika", 2: "İstem Konusu", 3: "Mahalle/Köy",
    4: "Ada/Parsel/Tarih No", 5: "Gün Verilmişse (Tarih/Saat/Neden)",
    6: "Dönüş Tarihi/Saati", 7: "İstemde Bulunan",
    8: "Tamamlandığı Tarih", 9: "Müdür İmza"
}

def atomic_write_json(path: str, payload: dict) -> None:
    """
    JSON'u güvenli (atomik) şekilde yazar:
    - Aynı klasörde geçici dosyaya yazar
    - flush + fsync
    - os.replace ile tek hamlede hedefe taşır
    """
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)

    data = json.dumps(payload, ensure_ascii=False, indent=2)
    fd, tmp_path = tempfile.mkstemp(dir=directory, prefix=".tmp_", suffix=".json")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        # tmp dosyası kalmasın
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        finally:
            raise

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--outdir", default="out")
    args = ap.parse_args()

    try:
        os.makedirs(args.outdir, exist_ok=True)

        # 1) Görseli hazırla
        img = Image.open(args.image).convert("RGB")
        W, H = img.size
        img, _ = deskew(img)
        img = enhance(img)
        img.save(os.path.join(args.outdir, "01_enhanced.jpg"))

        # 2) Kutu/satır tespiti
        boxes = segment_table_boxes(img)
        if not boxes:
            boxes = segment_line_boxes(img)

        # 3) OCR
        results = []
        for i, box in enumerate(boxes):
            roi = crop_with_box(img, box)
            roi = upsample(roi, 2)
            roi = upsample(roi, 3)   # 2 yerine 3
            hw  = False              # geçici: hep basılı model
            txt = run_trocr(roi, handwritten=hw, max_len=128, beams=5)

            
            # JSON uyumlu hale getir
        results.append({
    "idx": int(i),
    "bbox": [int(x) for x in box],   # her değer int olsun
    "handwritten": bool(hw),         # NumPy bool -> normal bool
    "text": str(txt)                 # text her zaman string olsun
     })


        # 4) Alan eşleme (tablo benzeri sayıda kutu varsa)
        fields = (
            {FIELD_MAP.get(r["idx"], f"cell_{r['idx']}"): r["text"] for r in results}
            if len(boxes) >= 8 else {}
        )

        payload = {
            "image_size": {"width": W, "height": H},
            "items": results,
            "fields": fields
        }

        # 5) JSON'u atomik yaz + stdout'a bas
        out_json = os.path.join(args.outdir, "results_boxes.json")
        atomic_write_json(out_json, payload)
        # stdout (Node bunu okuyacak)
        print(json.dumps(payload, ensure_ascii=False))
        return 0

    except Exception as e:
        # Hata durumunda stderr'e yaz ve non-zero exit
        print(f"[ERROR] {type(e).__name__}: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    sys.exit(main())
