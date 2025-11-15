import { useRef, useState } from "react";

export default function Cropper({ imageUrl, onCrop }) {
  const imgRef = useRef(null);
  const [crop, setCrop] = useState(null);
  const [start, setStart] = useState(null);

  function handleMouseDown(e) {
    const rect = e.target.getBoundingClientRect();
    setStart({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleMouseMove(e) {
    if (!start) return;
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setCrop({
      x1: Math.min(start.x, x),
      y1: Math.min(start.y, y),
      x2: Math.max(start.x, x),
      y2: Math.max(start.y, y),
    });
  }

  function handleMouseUp() {
    setStart(null);
  }

  function sendCrop() {
    if (!crop || !imgRef.current) return;

    const img = imgRef.current;
    const w = img.width;
    const h = img.height;

    // normalize 0–1
    const norm = {
      x: crop.x1 / w,
      y: crop.y1 / h,
      w: (crop.x2 - crop.x1) / w,
      h: (crop.y2 - crop.y1) / h,
    };

    onCrop(norm);
  }

  return (
    <div style={{ marginTop: 20 }}>
      <div
        style={{ position: "relative", display: "inline-block" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img
          ref={imgRef}
          src={imageUrl}
          style={{ maxWidth: 500, border: "1px solid #ccc" }}
        />

        {crop && (
          <div
            style={{
              position: "absolute",
              left: crop.x1,
              top: crop.y1,
              width: crop.x2 - crop.x1,
              height: crop.y2 - crop.y1,
              border: "2px solid red",
              background: "rgba(255,0,0,0.2)",
            }}
          ></div>
        )}
      </div>

      <button onClick={sendCrop} style={{ marginTop: 10 }}>
        Seçili Alanı OCR Yap
      </button>
    </div>
  );
}
