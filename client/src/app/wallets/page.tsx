"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

const CHAINS = ["ETH","BTC","SOL","XRP"];

export default function WalletsPage() {
  const router = useRouter();
  const [wallets, setWallets] = useState<any[]>([]);
  const [form,    setForm]    = useState({ chain:"ETH", address:"" });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    api.wallets().then(setWallets).finally(() => setLoading(false));
  }, [router]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      await api.upsertWallet(form);
      setWallets(prev => {
        const existing = prev.findIndex(w => w.chain === form.chain);
        if (existing >= 0) { const n = [...prev]; n[existing] = { ...n[existing], address: form.address }; return n; }
        return [...prev, form];
      });
      setForm(f => ({ ...f, address:"" }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally { setSaving(false); }
  }

  async function remove(chain: string) {
    if (!confirm(`Remove ${chain} wallet address?`)) return;
    await api.deleteWallet(chain);
    setWallets(prev => prev.filter(w => w.chain !== chain));
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <Sidebar />
      <main style={s.main}>
        <h1 style={s.heading}>Wallet Addresses</h1>
        <p style={s.sub}>Funds are sent directly to these treasury addresses. Keep them safe.</p>

        {/* Add / update wallet */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Add / Update Wallet</h2>
          <form onSubmit={save} style={s.form}>
            <div style={s.row}>
              <select style={s.select} value={form.chain} onChange={e => setForm(f => ({ ...f, chain: e.target.value }))}>
                {CHAINS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input style={s.input} placeholder="Wallet address" value={form.address}
                onChange={e => setForm(f => ({ ...f, address: e.target.value }))} required />
              <button style={s.btn} type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
            </div>
            {error && <div style={s.error}>{error}</div>}
          </form>
        </div>

        {/* Current wallets */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Current Treasury Addresses</h2>
          {wallets.length ? wallets.map(w => (
            <div key={w.chain} style={s.walletRow}>
              <span style={s.chainBadge}>{w.chain}</span>
              <code style={s.addr}>{w.address}</code>
              <div style={s.rowActions}>
                <button style={s.editBtn} onClick={() => setForm({ chain: w.chain, address: w.address })}>Edit</button>
                <button style={s.removeBtn} onClick={() => remove(w.chain)}>Remove</button>
              </div>
            </div>
          )) : <div style={s.empty}>No wallet addresses configured yet</div>}
        </div>

        <div style={s.info}>
          ℹ️ Your BTC, SOL, and XRP addresses receive native coins. Your ETH address receives ETH-based tokens (ETH, USDC, etc.).
          No conversion or bridge — funds land directly in your wallets.
        </div>
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  center:     { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:       { display:"flex", minHeight:"100vh" },
  main:       { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:    { margin:"0 0 6px", fontSize:24, fontWeight:700 },
  sub:        { margin:"0 0 24px", color:"#64748b", fontSize:13 },
  card:       { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px", marginBottom:16 },
  cardTitle:  { margin:"0 0 16px", fontSize:15, fontWeight:700 },
  form:       { display:"flex", flexDirection:"column", gap:10 },
  row:        { display:"flex", gap:10 },
  select:     { background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 12px", color:"#f1f5f9", fontSize:13, outline:"none", flexShrink:0 },
  input:      { flexGrow:1, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#f1f5f9", fontSize:13, outline:"none" },
  btn:        { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:13, fontWeight:700, flexShrink:0 },
  error:      { background:"#450a0a", border:"1px solid #991b1b", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13 },
  walletRow:  { display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid #1e293b" },
  chainBadge: { display:"inline-block", padding:"4px 10px", borderRadius:4, fontSize:12, fontWeight:700, background:"#1e3a5f", color:"#93c5fd", flexShrink:0 },
  addr:       { flexGrow:1, fontFamily:"monospace", fontSize:12, color:"#94a3b8", wordBreak:"break-all" },
  rowActions: { display:"flex", gap:6, flexShrink:0 },
  editBtn:    { background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:12 },
  removeBtn:  { background:"#450a0a", border:"none", color:"#fca5a5", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:12 },
  empty:      { color:"#64748b", fontSize:13, padding:"16px 0" },
  info:       { background:"#1e3a5f26", border:"1px solid #1e3a5f", borderRadius:8, padding:"14px 18px", color:"#93c5fd", fontSize:13, lineHeight:1.6 },
};
