// client/src/Uploader.jsx
import { useState } from "react";
import { useAuth } from "./auth.jsx";

export default function Uploader() {
  const { token } = useAuth();
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  async function handleUpload() {
    if (!files.length) {
      setMessage("Lütfen en az bir dosya seç.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      // 1) DOSYALARI YÜKLE
      const form = new FormData();
      files.forEach((f) => form.append("images", f));

      const r = await fetch("/api/upload", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || "Upload başarısız");
      }

      const uploaded = data.files || [];
      setMessage(`Yüklendi: ${uploaded.length} dosya. OCR başlatılıyor...`);

      // 2) HER DOSYA İÇİN OTOMATİK OCR ÇAĞIR
      for (const file of uploaded) {
        try {
          const r2 = await fetch("/api/ocr/auto", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              filename: file.filename, // backend'in beklediği alan
            }),
          });

          const d2 = await r2.json();
          if (!r2.ok || !d2.ok) {
            console.error("OCR hatası:", file.filename, d2);
          } else {
            console.log("OCR OK:", file.filename, d2);
          }
        } catch (err) {
          console.error("OCR çağrı hatası:", file.filename, err);
        }
      }

      setMessage("Yükleme + OCR işlemi bitti. Listeyi yenileyerek bakabilirsin.");
      setFiles([]);
    } catch (e) {
      console.error(e);
      setMessage("Hata: " + (e.message || e.toString()));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div style={{ marginBottom: 8 }}>
        <input
          type="file"
          multiple
          onChange={handleFileChange}
          disabled={busy}
        />
      </div>
      <button onClick={handleUpload} disabled={busy || !files.length}>
        {busy ? "Yükleniyor + OCR…" : "Yükle ve OCR yap"}
      </button>
      {message && (
        <div style={{ marginTop: 8 }}>
          <small>{message}</small>
        </div>
      )}
    </section>
  );
}
