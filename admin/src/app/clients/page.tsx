"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function ClientsPage() {
  const router = useRouter();
  const [clients,  setClients]  = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState("");
  const [savingPromo, setSavingPromo] = useState(false);
  const promoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!localStorage.getItem("admin_token")) { router.push("/"); return; }
    api.clients().then(setClients).finally(() => setLoading(false));
  }, [router]);

  async function toggleStatus(id: string, current: string) {
    const next = current === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await api.setClientStatus(id, next);
    setClients(prev => prev.map(c => c.id === id ? { ...c, status: next } : c));
    if (selected?.id === id) setSelected((p: any) => ({ ...p, status: next }));
  }

  async function changePlan(id: string, plan: string) {
    await api.setClientPlan(id, plan);
    setClients(prev => prev.map(c => c.id === id ? { ...c, plan } : c));
    if (selected?.id === id) setSelected((p: any) => ({ ...p, plan }));
  }

  async function savePromoMemo(id: string) {
    const value = promoInputRef.current?.value.trim() || null;
    setSavingPromo(true);
    try {
      await api.setClientPromoMemo(id, value);
      setClients(prev => prev.map(c => c.id === id ? { ...c, promoMemo: value } : c));
      setSelected((p: any) => (p && p.id === id ? { ...p, promoMemo: value } : p));
    } finally {
      setSavingPromo(false);
    }
  }

  async function removeClient(id: string) {
    if (!confirm("Delete this client and all their data? This cannot be undone.")) return;
    await api.deleteClient(id);
    setClients(prev => prev.filter(c => c.id !== id));
    setSelected(null);
  }

  const filtered = clients.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <aside style={s.sidebar}>
        <div style={s.brand}>🔐 CryptoPay</div>
        <nav style={s.nav}>
          <a style={s.navItem} href="/dashboard">📊 Dashboard</a>
          <a style={{...s.navItem,...s.navActive}} href="/clients">👥 Clients</a>
          <a style={s.navItem} href="/transactions">💳 Transactions</a>
          <a style={s.navItem} href="/gas-drop">⛽ Gas Drop</a>
        </nav>
        <div style={s.sideBottom}>
          <button style={s.logoutBtn} onClick={() => { localStorage.clear(); router.push("/"); }}>Sign out</button>
        </div>
      </aside>

      <main style={s.main}>
        <div style={s.topBar}>
          <h1 style={s.heading}>Clients ({clients.length})</h1>
          <input style={s.search} placeholder="Search by name or email…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>

        <div style={s.layout}>
          {/* Client list */}
          <div style={s.listPanel}>
            {filtered.map(c => (
              <div key={c.id} style={{ ...s.clientRow, ...(selected?.id === c.id ? s.clientRowActive : {}) }}
                onClick={() => setSelected(c)}>
                <div style={s.clientName}>{c.name}</div>
                <div style={s.clientEmail}>{c.email}</div>
                <div style={s.rowMeta}>
                  <span style={{ ...s.badge, ...statusColor(c.status) }}>{c.status}</span>
                  <span style={s.planBadge}>{c.plan}</span>
                </div>
              </div>
            ))}
            {!filtered.length && <div style={s.empty}>No clients found</div>}
          </div>

          {/* Detail panel */}
          {selected ? (
            <div style={s.detailPanel}>
              <h2 style={s.detailName}>{selected.name}</h2>
              <div style={s.detailEmail}>{selected.email}</div>
              {selected.website && <a style={s.website} href={selected.website} target="_blank" rel="noreferrer">{selected.website}</a>}

              <div style={s.detailSection}>
                <div style={s.detailLabel}>API Key</div>
                <code style={s.apiKey}>{selected.apiKey}</code>
              </div>

              <div style={s.detailSection}>
                <div style={s.detailLabel}>Wallet Addresses</div>
                {selected.wallets?.length ? selected.wallets.map((w: any) => (
                  <div key={w.chain} style={s.walletRow}>
                    <span style={s.chain}>{w.chain}</span>
                    <code style={s.addr}>{w.address}</code>
                  </div>
                )) : <div style={s.empty}>No wallets configured</div>}
              </div>

              <div style={s.detailSection}>
                <div style={s.detailLabel}>Stats</div>
                <div style={s.statRow}><span>Subscribers:</span><strong>{selected._count?.subscribers ?? 0}</strong></div>
                <div style={s.statRow}><span>Transactions:</span><strong>{selected._count?.transactions ?? 0}</strong></div>
                <div style={s.statRow}><span>Joined:</span><strong>{new Date(selected.createdAt).toLocaleDateString()}</strong></div>
              </div>

              <div style={s.detailSection}>
                <div style={s.detailLabel}>SaaS Plan</div>
                <select style={s.select} value={selected.plan} onChange={e => changePlan(selected.id, e.target.value)}>
                  {["STARTER","GROWTH","ENTERPRISE"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div style={s.detailSection}>
                <div style={s.detailLabel}>Promo Memo (on-chain)</div>
                <input
                  key={selected.id}
                  ref={promoInputRef}
                  style={s.select}
                  defaultValue={selected.promoMemo ?? ""}
                  placeholder="Payment secured by CryptoPay — cryptopay.io (default)"
                  maxLength={140}
                />
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 8, lineHeight: 1.5 }}>
                  Appended to every relayed Ethereum+USDC payment's on-chain memo for this client — seen by the payer and permanently recorded on-chain. Not editable by the client or payer. Leave blank to use the platform default.
                </div>
                <button
                  style={{ ...s.btn, ...s.btnSuccess, marginTop: 10, flex: "0 0 auto", padding: "8px 16px" }}
                  onClick={() => savePromoMemo(selected.id)}
                  disabled={savingPromo}
                >
                  {savingPromo ? "Saving…" : "Save"}
                </button>
              </div>

              <div style={s.actions}>
                <button style={{ ...s.btn, ...(selected.status === "ACTIVE" ? s.btnDanger : s.btnSuccess) }}
                  onClick={() => toggleStatus(selected.id, selected.status)}>
                  {selected.status === "ACTIVE" ? "Suspend Client" : "Activate Client"}
                </button>
                <button style={{ ...s.btn, ...s.btnDelete }} onClick={() => removeClient(selected.id)}>
                  Delete
                </button>
              </div>
            </div>
          ) : (
            <div style={s.detailPanel}>
              <div style={s.empty}>Select a client to view details</div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function statusColor(s: string): React.CSSProperties {
  if (s === "ACTIVE")    return { background:"#14532d", color:"#86efac" };
  if (s === "SUSPENDED") return { background:"#450a0a", color:"#fca5a5" };
  return { background:"#1e293b", color:"#94a3b8" };
}

const s: Record<string, React.CSSProperties> = {
  center:       { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:         { display:"flex", minHeight:"100vh" },
  sidebar:      { width:220, background:"#0f172a", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", padding:"24px 0", flexShrink:0 },
  brand:        { fontSize:16, fontWeight:700, color:"#f1f5f9", padding:"0 20px 24px" },
  nav:          { display:"flex", flexDirection:"column", gap:4, padding:"0 12px", flexGrow:1 },
  navItem:      { display:"block", padding:"10px 12px", borderRadius:8, color:"#64748b", textDecoration:"none", fontSize:14 },
  navActive:    { background:"#1e293b", color:"#f1f5f9" },
  sideBottom:   { padding:"16px 20px", borderTop:"1px solid #1e293b" },
  logoutBtn:    { background:"transparent", border:"1px solid #334155", color:"#64748b", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, width:"100%" },
  main:         { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  topBar:       { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 },
  heading:      { margin:0, fontSize:24, fontWeight:700 },
  search:       { background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#f1f5f9", fontSize:14, width:260, outline:"none" },
  layout:       { display:"grid", gridTemplateColumns:"1fr 1.4fr", gap:20, alignItems:"start" },
  listPanel:    { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, overflow:"hidden" },
  clientRow:    { padding:"14px 18px", borderBottom:"1px solid #1e293b", cursor:"pointer" },
  clientRowActive:{ background:"#1e293b" },
  clientName:   { fontWeight:600, fontSize:14, marginBottom:2 },
  clientEmail:  { color:"#64748b", fontSize:12, marginBottom:6 },
  rowMeta:      { display:"flex", gap:8 },
  badge:        { display:"inline-block", padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:700 },
  planBadge:    { display:"inline-block", padding:"2px 8px", borderRadius:999, fontSize:10, fontWeight:700, background:"#1e3a5f", color:"#93c5fd" },
  empty:        { padding:"24px", color:"#64748b", textAlign:"center", fontSize:13 },
  detailPanel:  { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"24px" },
  detailName:   { margin:"0 0 4px", fontSize:20, fontWeight:700 },
  detailEmail:  { color:"#64748b", fontSize:13, marginBottom:4 },
  website:      { color:"#3b82f6", fontSize:12, display:"block", marginBottom:20 },
  detailSection:{ borderTop:"1px solid #1e293b", paddingTop:16, marginTop:16 },
  detailLabel:  { fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:10 },
  apiKey:       { display:"block", background:"#1e293b", padding:"8px 12px", borderRadius:6, fontSize:11, color:"#94a3b8", wordBreak:"break-all" },
  walletRow:    { display:"flex", gap:10, alignItems:"center", marginBottom:6 },
  chain:        { fontSize:11, fontWeight:700, color:"#93c5fd", background:"#1e3a5f", padding:"2px 8px", borderRadius:4, flexShrink:0 },
  addr:         { fontSize:11, color:"#94a3b8", wordBreak:"break-all" },
  statRow:      { display:"flex", justifyContent:"space-between", fontSize:13, marginBottom:6, color:"#94a3b8" },
  select:       { background:"#1e293b", border:"1px solid #334155", borderRadius:6, padding:"8px 12px", color:"#f1f5f9", fontSize:13, width:"100%", outline:"none" },
  actions:      { display:"flex", gap:10, marginTop:20 },
  btn:          { flex:1, border:"none", borderRadius:8, padding:"10px", fontSize:13, fontWeight:700, cursor:"pointer" },
  btnDanger:    { background:"#7f1d1d", color:"#fca5a5" },
  btnSuccess:   { background:"#14532d", color:"#86efac" },
  btnDelete:    { background:"#1e293b", color:"#64748b", flex:"0 0 auto", padding:"10px 16px" },
};
