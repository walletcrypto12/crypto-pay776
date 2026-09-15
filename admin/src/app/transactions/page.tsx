"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function TransactionsPage() {
  const router  = useRouter();
  const [txns,    setTxns]    = useState<any[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);
  const perPage = 25;

  useEffect(() => {
    if (!localStorage.getItem("admin_token")) { router.push("/"); return; }
    load(page);
  }, [page, router]);

  async function load(p: number) {
    setLoading(true);
    try {
      const data = await api.transactions(p);
      setTxns(data.transactions);
      setTotal(data.total);
    } finally { setLoading(false); }
  }

  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <div style={s.page}>
      <aside style={s.sidebar}>
        <div style={s.brand}>🔐 CryptoPay</div>
        <nav style={s.nav}>
          <a style={s.navItem} href="/dashboard">📊 Dashboard</a>
          <a style={s.navItem} href="/clients">👥 Clients</a>
          <a style={{...s.navItem,...s.navActive}} href="/transactions">💳 Transactions</a>
          <a style={s.navItem} href="/gas-drop">⛽ Gas Drop</a>
        </nav>
        <div style={s.sideBottom}>
          <button style={s.logoutBtn} onClick={() => { localStorage.clear(); router.push("/"); }}>Sign out</button>
        </div>
      </aside>

      <main style={s.main}>
        <div style={s.topBar}>
          <h1 style={s.heading}>Transactions</h1>
          <div style={s.totalBadge}>{total} total</div>
        </div>

        <div style={s.tableWrap}>
          <table style={s.table}>
            <thead><tr>
              {["Date","Client","User Wallet","Chain","Amount","Plan","Tx Hash","Status"].map(h => (
                <th key={h} style={s.th}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading
                ? <tr><td colSpan={8} style={s.loading}>Loading…</td></tr>
                : txns.map(t => (
                <tr key={t.id} style={s.tr}>
                  <td style={s.td}>{new Date(t.createdAt).toLocaleString()}</td>
                  <td style={s.td}>{t.client?.name ?? "—"}</td>
                  <td style={s.td}><code style={s.addr}>{shorten(t.userAddress)}</code></td>
                  <td style={s.td}><span style={s.chainBadge}>{t.chain}</span></td>
                  <td style={s.td}>${(t.amountUsd ?? 0).toFixed(2)}</td>
                  <td style={s.td}>{t.plan?.name ?? "—"}</td>
                  <td style={s.td}><code style={s.addr}>{shorten(t.txHash)}</code></td>
                  <td style={s.td}><span style={{ ...s.badge, ...statusColor(t.status) }}>{t.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={s.pagination}>
          <button style={s.pageBtn} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
          <span style={s.pageInfo}>Page {page} of {pages}</span>
          <button style={s.pageBtn} onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}>Next →</button>
        </div>
      </main>
    </div>
  );
}

function shorten(s: string | null) {
  if (!s) return "—";
  return s.length > 16 ? `${s.slice(0,8)}…${s.slice(-6)}` : s;
}

function statusColor(s: string): React.CSSProperties {
  if (s === "CONFIRMED") return { background:"#14532d", color:"#86efac" };
  if (s === "FAILED")    return { background:"#450a0a", color:"#fca5a5" };
  return { background:"#1e3a5f", color:"#93c5fd" };
}

const s: Record<string, React.CSSProperties> = {
  page:       { display:"flex", minHeight:"100vh" },
  sidebar:    { width:220, background:"#0f172a", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", padding:"24px 0", flexShrink:0 },
  brand:      { fontSize:16, fontWeight:700, color:"#f1f5f9", padding:"0 20px 24px" },
  nav:        { display:"flex", flexDirection:"column", gap:4, padding:"0 12px", flexGrow:1 },
  navItem:    { display:"block", padding:"10px 12px", borderRadius:8, color:"#64748b", textDecoration:"none", fontSize:14 },
  navActive:  { background:"#1e293b", color:"#f1f5f9" },
  sideBottom: { padding:"16px 20px", borderTop:"1px solid #1e293b" },
  logoutBtn:  { background:"transparent", border:"1px solid #334155", color:"#64748b", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, width:"100%" },
  main:       { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  topBar:     { display:"flex", alignItems:"center", gap:16, marginBottom:24 },
  heading:    { margin:0, fontSize:24, fontWeight:700 },
  totalBadge: { background:"#1e293b", borderRadius:999, padding:"4px 14px", fontSize:13, color:"#94a3b8" },
  tableWrap:  { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, overflowX:"auto" },
  table:      { width:"100%", borderCollapse:"collapse" },
  th:         { padding:"12px 16px", textAlign:"left", fontSize:12, color:"#64748b", fontWeight:600, textTransform:"uppercase", borderBottom:"1px solid #1e293b" },
  tr:         { borderBottom:"1px solid #1e293b" },
  td:         { padding:"11px 16px", fontSize:13 },
  loading:    { padding:"32px", textAlign:"center", color:"#64748b" },
  addr:       { fontFamily:"monospace", fontSize:11, color:"#94a3b8" },
  chainBadge: { display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:700, background:"#1e3a5f", color:"#93c5fd" },
  badge:      { display:"inline-block", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700 },
  pagination: { display:"flex", alignItems:"center", justifyContent:"center", gap:16, marginTop:20 },
  pageBtn:    { background:"#1e293b", border:"1px solid #334155", color:"#f1f5f9", borderRadius:6, padding:"8px 18px", cursor:"pointer", fontSize:13 },
  pageInfo:   { color:"#64748b", fontSize:13 },
};
