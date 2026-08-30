"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function AuthPage() {
  const router   = useRouter();
  const [tab,    setTab]    = useState<"login"|"register">("login");
  const [form,   setForm]   = useState({ name:"", email:"", password:"", website:"" });
  const [error,  setError]  = useState("");
  const [loading,setLoading]= useState(false);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (tab === "login") {
        const data = await api.login({ email: form.email, password: form.password });
        localStorage.setItem("client_token", data.token);
        localStorage.setItem("client_name",  data.name);
        router.push("/dashboard");
      } else {
        const data = await api.register(form);
        localStorage.setItem("client_token", data.token);
        localStorage.setItem("client_name",  data.name);
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setLoading(false); }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>💳</div>
        <h1 style={s.title}>CryptoPay</h1>
        <p style={s.sub}>Accept crypto payments on your platform</p>

        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(tab==="login"?s.tabActive:{}) }} onClick={() => setTab("login")}>Sign In</button>
          <button style={{ ...s.tab, ...(tab==="register"?s.tabActive:{}) }} onClick={() => setTab("register")}>Register</button>
        </div>

        <form onSubmit={submit} style={s.form}>
          {tab === "register" && <>
            <input style={s.input} placeholder="Company name" value={form.name}    onChange={e=>set("name",e.target.value)}    required />
            <input style={s.input} placeholder="Website (optional)" value={form.website} onChange={e=>set("website",e.target.value)} />
          </>}
          <input style={s.input} type="email"    placeholder="Email"    value={form.email}    onChange={e=>set("email",e.target.value)}    required />
          <input style={s.input} type="password" placeholder="Password" value={form.password} onChange={e=>set("password",e.target.value)} required />
          {error && <div style={s.error}>{error}</div>}
          <button style={s.btn} type="submit" disabled={loading}>
            {loading ? "Please wait…" : tab === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page:    { display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh" },
  card:    { background:"#0f172a", border:"1px solid #1e293b", borderRadius:16, padding:"40px 36px", width:"100%", maxWidth:400, textAlign:"center" },
  logo:    { fontSize:40, marginBottom:12 },
  title:   { margin:"0 0 4px", fontSize:22, fontWeight:700 },
  sub:     { margin:"0 0 24px", color:"#64748b", fontSize:13 },
  tabs:    { display:"flex", background:"#1e293b", borderRadius:8, padding:3, marginBottom:20, gap:3 },
  tab:     { flex:1, background:"transparent", border:"none", color:"#64748b", padding:"9px", borderRadius:6, cursor:"pointer", fontSize:13, fontWeight:600 },
  tabActive:{ background:"#0f172a", color:"#f1f5f9" },
  form:    { display:"flex", flexDirection:"column", gap:12 },
  input:   { background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"12px 14px", color:"#f1f5f9", fontSize:14, outline:"none" },
  error:   { background:"#450a0a", border:"1px solid #991b1b", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13 },
  btn:     { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"13px", fontSize:15, fontWeight:700, cursor:"pointer" },
};
