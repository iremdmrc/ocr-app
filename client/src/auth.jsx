import { createContext, useContext, useEffect, useState } from "react";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!token);

  useEffect(() => {
    if (!token) { setUser(null); setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch("/api/me", { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) throw new Error();
        const d = await r.json();
        setUser(d);
      } catch {
        localStorage.removeItem("token");
        setToken(null); setUser(null);
      } finally { setLoading(false); }
    })();
  }, [token]);

  async function login(email, password) {
    const r = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "login_failed");
    localStorage.setItem("token", d.token);
    setToken(d.token);
    setUser(d.user);
  }

  async function register(email, password, display_name) {
    const r = await fetch("/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, display_name })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "register_failed");
    localStorage.setItem("token", d.token);
    setToken(d.token);
    setUser(d.user);
  }

  function logout() {
    localStorage.removeItem("token");
    setToken(null); setUser(null);
  }

  return (
    <AuthCtx.Provider value={{ token, user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
