// client/src/App.jsx
import { useEffect, useState } from "react";
import { useAuth } from "./auth.jsx";
import Login from "./Login.jsx";
import Uploader from "./Uploader.jsx";
import Cropper from "./Cropper.jsx";

function RecentList() {
  const { token } = useAuth();
  const [items, setItems] = useState([]);
  const [lineResult, setLineResult] = useState("");      // satır OCR sonucu
  const [selectedItem, setSelectedItem] = useState(null); // hangi kayıt üzerinde crop yapıyoruz

  // Son yüklemeleri al
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/uploads", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        setItems(d || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [token]);

  // Cropper'dan gelen normalize koordinatlarla backend'e istek at
  async function handleCropOcr(normBox) {
    if (!selectedItem) return;

    try {
      const body = {
        filename: selectedItem.filename,    // server'a sadece gerçek dosya adını yolluyoruz
        box: {
          x: normBox.x,
          y: normBox.y,
          w: normBox.w,
          h: normBox.h,
        },
        lang: "tur+eng",
      };

      const r = await fetch("/api/ocr/crop-line", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await r.json();
      if (!data.ok) {
        setLineResult(`HATA: ${data.error || "bilinmiyor"}`);
      } else {
        setLineResult(data.text || "(boş)");
      }
    } catch (e) {
      console.error(e);
      setLineResult(String(e));
    }
  }

  return (
    <>
      <ul style={{ marginTop: 8 }}>
        {items.map((it) => (
          <li key={it.id} style={{ marginBottom: 6 }}>
            <a href={it.url} target="_blank" rel="noreferrer">
              {it.filename}
            </a>
            {" — "}
            {it.latest_ocr_url ? (
              <a href={it.latest_ocr_url} target="_blank" rel="noreferrer">
                OCR PDF
              </a>
            ) : (
              <em>OCR yok</em>
            )}
            {" "}
            {/* Crop + OCR butonu */}
            <button onClick={() => setSelectedItem(it)}>
              Crop + OCR
            </button>
          </li>
        ))}
      </ul>

      {/* Seçili kayıt varsa görsel üzerinde crop paneli göster */}
      {selectedItem && (
        <div style={{ marginTop: 16, padding: 8, border: "1px solid #ccc" }}>
          <strong>Seçili görsel:</strong> {selectedItem.filename}
          <Cropper
            imageUrl={selectedItem.url}
            onCrop={handleCropOcr}
          />
        </div>
      )}

      {/* Son satır OCR sonucu */}
      <div style={{ marginTop: 16, padding: 8, border: "1px solid #ccc" }}>
        <strong>Son Satır OCR Sonucu:</strong>
        <pre style={{ whiteSpace: "pre-wrap" }}>{lineResult}</pre>
      </div>
    </>
  );
}

export default function App() {
  const { token, user, loading, logout } = useAuth();

  if (loading) return <div style={{ padding: 24 }}>Yükleniyor…</div>;
  if (!token) return <Login />;

  return (
    <div style={{ maxWidth: 900, margin: "24px auto", padding: "0 16px" }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2>Searchable PDF OCR</h2>
        <div>
          <span style={{ marginRight: 12 }}>{user?.email}</span>
          <button onClick={logout}>Çıkış</button>
        </div>
      </header>

      <Uploader />

      <section style={{ marginTop: 24 }}>
        <h3>Son Yüklemeler</h3>
        <RecentList />
      </section>
    </div>
  );
}
