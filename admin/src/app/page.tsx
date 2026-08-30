"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function AdminLogin() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await api.login({ email, password });
      localStorage.setItem("admin_token", data.token);
      localStorage.setItem("admin_name",  data.name);
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally { setLoading(false); }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>🔐</div>
        <h1 style={s.title}>Admin Portal</h1>
        <p style={s.sub}>CryptoPay Platform Management</p>
        <form onSubmit={handleLogin} style={s.form}>
          <input style={s.input} type="email"    placeholder="Admin email"    value={email}    onChange={e => setEmail(e.target.value)}    required />
          <input style={s.input} type="password" placeholder="Password"       value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:  { display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" },
  card:  { background:"#0f172a", border:"1px solid #1e293b", borderRadius:16, padding:"40px 36px", width:"100%", maxWidth:380, textAlign:"center" },
  logo:  { fontSize:40, marginBottom:12 },
  title: { margin:"0 0 4px", fontSize:22, fontWeight:700 },
  sub:   { margin:"0 0 28px", color:"#64748b", fontSize:13 },
  form:  { display:"flex", flexDirection:"column", gap:12 },
  input: { background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"12px 14px", color:"#f1f5f9", fontSize:14, outline:"none" },
  error: { background:"#450a0a", border:"1px solid #991b1b", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13 },
  btn:   { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"13px", fontSize:15, fontWeight:700, cursor:"pointer" },
};
