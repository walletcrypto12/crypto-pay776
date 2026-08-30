"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

export default function SubscribersPage() {
  const router = useRouter();
  const [subs,    setSubs]    = useState<any[]>([]);
  const [total,   setTotal]   = useState(0);
  const [page,    setPage]    = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    load(page);
  }, [page, router]);

  async function load(p: number) {
    setLoading(true);
    try { const d = await api.subscribers(p); setSubs(d.subscribers); setTotal(d.total); }
    finally { setLoading(false); }
  }

  const pages = Math.max(1, Math.ceil(total / 25));

  function subStatus(sub: any) {
    if (!sub.active) return "INACTIVE";
    if (!sub.expiresAt) return "LIFETIME";
    return new Date(sub.expiresAt) > new Date() ? "ACTIVE" : "EXPIRED";
  }

  function statusColor(s: string): React.CSSProperties {
    if (s==="ACTIVE"||s==="LIFETIME") return { background:"#14532d", color:"#86efac" };
    if (s==="EXPIRED"||s==="INACTIVE") return { background:"#450a0a", color:"#fca5a5" };
    return { background:"#1e293b", color:"#94a3b8" };
  }

  return (
    <div style={st.page}>
      <Sidebar />
      <main style={st.main}>
        <div style={st.topBar}>
          <h1 style={st.heading}>Subscribers</h1>
          <span style={st.count}>{total} total</span>
        </div>
        <div style={st.tableWrap}>
          <table style={st.table}>
            <thead><tr>
              {["User Wallet","Plan","Status","Subscribed","Expires"].map(h => <th key={h} style={st.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {loading
                ? <tr><td colSpan={5} style={st.loading}>Loading…</td></tr>
                : subs.map(sub => {
                  const status = subStatus(sub);
                  return (
                    <tr key={sub.id} style={st.tr}>
                      <td style={st.td}><code style={st.addr}>{sub.userAddress}</code></td>
                      <td style={st.td}>{sub.plan?.name ?? "—"}</td>
                      <td style={st.td}><span style={{ ...st.badge, ...statusColor(status) }}>{status}</span></td>
                      <td style={st.td}>{new Date(sub.createdAt).toLocaleDateString()}</td>
                      <td style={st.td}>{sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString() : "Never"}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        <div style={st.pagination}>
          <button style={st.pageBtn} onClick={() => setPage(p => Math.max(1,p-1))} disabled={page===1}>← Prev</button>
          <span style={st.pageInfo}>Page {page} of {pages}</span>
          <button style={st.pageBtn} onClick={() => setPage(p => Math.min(pages,p+1))} disabled={page===pages}>Next →</button>
        </div>
      </main>
    </div>
  );
}

const st: Record<string, React.CSSProperties> = {
  page:       { display:"flex", minHeight:"100vh" },
  main:       { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  topBar:     { display:"flex", alignItems:"center", gap:16, marginBottom:24 },
  heading:    { margin:0, fontSize:24, fontWeight:700 },
  count:      { background:"#1e293b", borderRadius:999, padding:"4px 14px", fontSize:13, color:"#94a3b8" },
  tableWrap:  { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, overflowX:"auto" },
  table:      { width:"100%", borderCollapse:"collapse" },
  th:         { padding:"12px 16px", textAlign:"left", fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", borderBottom:"1px solid #1e293b" },
  tr:         { borderBottom:"1px solid #1e293b" },
  td:         { padding:"11px 16px", fontSize:13 },
  loading:    { padding:"32px", textAlign:"center", color:"#64748b" },
  addr:       { fontFamily:"monospace", fontSize:11, color:"#94a3b8" },
  badge:      { display:"inline-block", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700 },
  pagination: { display:"flex", alignItems:"center", justifyContent:"center", gap:16, marginTop:16 },
  pageBtn:    { background:"#1e293b", border:"1px solid #334155", color:"#f1f5f9", borderRadius:6, padding:"8px 18px", cursor:"pointer", fontSize:13 },
  pageInfo:   { color:"#64748b", fontSize:13 },
};
