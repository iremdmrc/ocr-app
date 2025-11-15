// client/src/api.js
const API_BASE = 'http://localhost:5000';

export async function listUploads(token) {
  const res = await fetch(`${API_BASE}/api/uploads`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) throw new Error('uploads yüklenemedi');
  return res.json();            // array
}

export async function autoOcr(filename, token) {
  const res = await fetch(`${API_BASE}/api/ocr/auto`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ filename }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error_detail || data.error || 'OCR failed');
  }
  return data;  // { ok:true, url:'/out/...pdf', picked_variant: '...' }
}
