"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Stats = { totalClients:number; activeClients:number; totalTransactions:number; totalSubscribers:number; totalRevenueUsd:number };

export default function AdminDashboard() {
  const router = useRouter();
  const [stats,   setStats]   = useState<Stats | null>(null);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const adminName = typeof window !== "undefined" ? localStorage.getItem("admin_name") : "Admin";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) { router.push("/"); return; }
    Promise.all([api.stats(), api.clients()])
      .then(([s, c]) => { setStats(s); setClients(c); })
      .catch(() => { localStorage.removeItem("admin_token"); router.push("/"); })
      .finally(() => setLoading(false));
  }, [router]);

  async function toggleStatus(id: string, current: string) {
    const next = current === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    await api.setClientStatus(id, next);
    setClients(prev => prev.map(c => c.id === id ? { ...c, status: next } : c));
  }

  function logout() { localStorage.clear(); router.push("/"); }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      {/* Sidebar */}
      <aside style={s.sidebar}>
        <div style={s.brand}>🔐 CryptoPay</div>
        <nav style={s.nav}>
          <a style={{...s.navItem, ...s.navActive}} href="/dashboard">📊 Dashboard</a>
          <a style={s.navItem} href="/clients">👥 Clients</a>
          <a style={s.navItem} href="/transactions">💳 Transactions</a>
          <a style={s.navItem} href="/gas-drop">⛽ Gas Drop</a>
        </nav>
        <div style={s.sideBottom}>
          <div style={s.adminName}>{adminName}</div>
          <button style={s.logoutBtn} onClick={logout}>Sign out</button>
        </div>
      </aside>

      {/* Main */}
      <main style={s.main}>
        <h1 style={s.heading}>Platform Overview</h1>

        {/* Stat cards */}
        <div style={s.statsGrid}>
          {[
            { label:"Total Clients",      value: stats?.totalClients,      icon:"👥" },
            { label:"Active Clients",     value: stats?.activeClients,     icon:"✅" },
            { label:"Total Transactions", value: stats?.totalTransactions, icon:"💳" },
            { label:"Active Subscribers", value: stats?.totalSubscribers,  icon:"🔔" },
            { label:"Total Revenue",      value: `$${(stats?.totalRevenueUsd ?? 0).toFixed(2)}`, icon:"💰" },
          ].map(c => (
            <div key={c.label} style={s.statCard}>
              <div style={s.statIcon}>{c.icon}</div>
              <div style={s.statValue}>{c.value ?? "—"}</div>
              <div style={s.statLabel}>{c.label}</div>
            </div>
          ))}
        </div>

        {/* Recent clients table */}
        <div style={s.section}>
          <div style={s.sectionHeader}>
            <h2 style={s.sectionTitle}>Recent Clients</h2>
            <a style={s.viewAll} href="/clients">View all →</a>
          </div>
          <div style={s.tableWrap}>
            <table style={s.table}>
              <thead><tr>
                {["Name","Email","Status","Plan","Subscribers","Joined","Actions"].map(h => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {clients.slice(0,10).map(c => (
                  <tr key={c.id} style={s.tr}>
                    <td style={s.td}>{c.name}</td>
                    <td style={s.td}>{c.email}</td>
                    <td style={s.td}>
                      <span style={{ ...s.badge, ...statusColor(c.status) }}>{c.status}</span>
                    </td>
                    <td style={s.td}>{c.plan}</td>
                    <td style={s.td}>{c._count?.subscribers ?? 0}</td>
                    <td style={s.td}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td style={s.td}>
                      <button style={s.actionBtn} onClick={() => toggleStatus(c.id, c.status)}>
                        {c.status === "ACTIVE" ? "Suspend" : "Activate"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

function statusColor(status: string): React.CSSProperties {
  if (status === "ACTIVE")    return { background:"#14532d", color:"#86efac" };
  if (status === "SUSPENDED") return { background:"#450a0a", color:"#fca5a5" };
  return { background:"#1e293b", color:"#94a3b8" };
}

const s: Record<string, React.CSSProperties> = {
  center:      { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:        { display:"flex", minHeight:"100vh" },
  sidebar:     { width:220, background:"#0f172a", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", padding:"24px 0", flexShrink:0 },
  brand:       { fontSize:16, fontWeight:700, color:"#f1f5f9", padding:"0 20px 24px" },
  nav:         { display:"flex", flexDirection:"column", gap:4, padding:"0 12px", flexGrow:1 },
  navItem:     { display:"block", padding:"10px 12px", borderRadius:8, color:"#64748b", textDecoration:"none", fontSize:14 },
  navActive:   { background:"#1e293b", color:"#f1f5f9" },
  sideBottom:  { padding:"16px 20px", borderTop:"1px solid #1e293b" },
  adminName:   { fontSize:13, color:"#94a3b8", marginBottom:8 },
  logoutBtn:   { background:"transparent", border:"1px solid #334155", color:"#64748b", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, width:"100%" },
  main:        { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:     { margin:"0 0 28px", fontSize:24, fontWeight:700 },
  statsGrid:   { display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:16, marginBottom:32 },
  statCard:    { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 18px" },
  statIcon:    { fontSize:24, marginBottom:10 },
  statValue:   { fontSize:26, fontWeight:700, marginBottom:4 },
  statLabel:   { fontSize:12, color:"#64748b" },
  section:     { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, overflow:"hidden" },
  sectionHeader:{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 20px", borderBottom:"1px solid #1e293b" },
  sectionTitle: { margin:0, fontSize:16, fontWeight:700 },
  viewAll:     { color:"#3b82f6", textDecoration:"none", fontSize:13 },
  tableWrap:   { overflowX:"auto" },
  table:       { width:"100%", borderCollapse:"collapse" },
  th:          { padding:"12px 16px", textAlign:"left", fontSize:12, color:"#64748b", fontWeight:600, textTransform:"uppercase", borderBottom:"1px solid #1e293b" },
  tr:          { borderBottom:"1px solid #0f172a" },
  td:          { padding:"12px 16px", fontSize:13 },
  badge:       { display:"inline-block", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700 },
  actionBtn:   { background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"5px 10px", cursor:"pointer", fontSize:12 },
};
