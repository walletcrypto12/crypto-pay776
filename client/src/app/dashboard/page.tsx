"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

export default function Dashboard() {
  const router = useRouter();
  const [stats,   setStats]   = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    api.stats().then(setStats).catch(() => { localStorage.clear(); router.push("/"); }).finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div style={s.center}>Loading…</div>;

  const recent: any[] = stats?.recentTransactions ?? [];

  return (
    <div style={s.page}>
      <Sidebar />
      <main style={s.main}>
        <h1 style={s.heading}>Overview</h1>

        <div style={s.grid}>
          {[
            { label:"Active Subscribers",  value: stats?.activeSubscribers,                   icon:"🔔" },
            { label:"Total Transactions",  value: stats?.totalTransactions,                   icon:"💳" },
            { label:"Total Revenue",       value:`$${(stats?.totalRevenueUsd??0).toFixed(2)}`,icon:"💰" },
          ].map(c => (
            <div key={c.label} style={s.card}>
              <div style={s.cardIcon}>{c.icon}</div>
              <div style={s.cardVal}>{c.value ?? "—"}</div>
              <div style={s.cardLbl}>{c.label}</div>
            </div>
          ))}
        </div>

        <div style={s.section}>
          <h2 style={s.sectionTitle}>Recent Transactions</h2>
          {recent.length ? (
            <table style={s.table}>
              <thead><tr>
                {["Date","User","Chain","Amount","Status"].map(h => <th key={h} style={s.th}>{h}</th>)}
              </tr></thead>
              <tbody>
                {recent.map((t: any) => (
                  <tr key={t.id} style={s.tr}>
                    <td style={s.td}>{new Date(t.createdAt).toLocaleString()}</td>
                    <td style={s.td}><code style={s.addr}>{shorten(t.userAddress)}</code></td>
                    <td style={s.td}><span style={s.chainBadge}>{t.chain}</span></td>
                    <td style={s.td}>${(t.amountUsd ?? 0).toFixed(2)}</td>
                    <td style={s.td}><span style={{ ...s.badge, ...statusColor(t.status) }}>{t.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <div style={s.empty}>No transactions yet</div>}
        </div>
      </main>
    </div>
  );
}

function shorten(s: string) { return s?.length > 16 ? `${s.slice(0,8)}…${s.slice(-6)}` : s ?? "—"; }

function statusColor(s: string): React.CSSProperties {
  if (s === "CONFIRMED") return { background:"#14532d", color:"#86efac" };
  if (s === "FAILED")    return { background:"#450a0a", color:"#fca5a5" };
  return { background:"#1e3a5f", color:"#93c5fd" };
}

const s: Record<string, React.CSSProperties> = {
  center:      { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:        { display:"flex", minHeight:"100vh" },
  main:        { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:     { margin:"0 0 28px", fontSize:24, fontWeight:700 },
  grid:        { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:32 },
  card:        { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 18px" },
  cardIcon:    { fontSize:24, marginBottom:10 },
  cardVal:     { fontSize:26, fontWeight:700, marginBottom:4 },
  cardLbl:     { fontSize:12, color:"#64748b" },
  section:     { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px" },
  sectionTitle:{ margin:"0 0 16px", fontSize:16, fontWeight:700 },
  table:       { width:"100%", borderCollapse:"collapse" },
  th:          { padding:"10px 14px", textAlign:"left", fontSize:11, color:"#64748b", fontWeight:600, textTransform:"uppercase", borderBottom:"1px solid #1e293b" },
  tr:          { borderBottom:"1px solid #1e293b" },
  td:          { padding:"10px 14px", fontSize:13 },
  addr:        { fontFamily:"monospace", fontSize:11, color:"#94a3b8" },
  chainBadge:  { display:"inline-block", padding:"2px 8px", borderRadius:4, fontSize:11, fontWeight:700, background:"#1e3a5f", color:"#93c5fd" },
  badge:       { display:"inline-block", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700 },
  empty:       { color:"#64748b", fontSize:13, padding:"16px 0" },
};
