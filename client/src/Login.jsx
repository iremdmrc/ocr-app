import { useState } from "react";
import { useAuth } from "./auth.jsx";

export default function Login() {
  const { login, register } = useAuth();
  const [tab, setTab] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    try {
      if (tab === "login") await login(email, password);
      else await register(email, password, name);
    } catch (e) {
      setErr(e.message || "Hata");
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, border: "1px solid #ddd", borderRadius: 16 }}>
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <button onClick={() => setTab("login")} style={{ fontWeight: tab === "login" ? "700" : "400" }}>Giriş</button>
        <button onClick={() => setTab("register")} style={{ fontWeight: tab === "register" ? "700" : "400" }}>Üye Ol</button>
      </div>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        {tab === "register" && (
          <input placeholder="Ad Soyad" value={name} onChange={e => setName(e.target.value)} required />
        )}
        <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <input type="password" placeholder="Şifre" value={password} onChange={e => setPassword(e.target.value)} required />
        <button type="submit">{tab === "login" ? "Giriş Yap" : "Kayıt Ol"}</button>
        {err && <div style={{ color: "crimson" }}>{err}</div>}
      </form>
    </div>
  );
}
