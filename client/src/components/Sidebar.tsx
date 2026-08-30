"use client";
import { useRouter, usePathname } from "next/navigation";

const links = [
  { href:"/dashboard",    icon:"📊", label:"Dashboard" },
  { href:"/wallets",      icon:"💼", label:"Wallets" },
  { href:"/plans",        icon:"📋", label:"Plans" },
  { href:"/subscribers",  icon:"🔔", label:"Subscribers" },
  { href:"/transactions", icon:"💳", label:"Transactions" },
  { href:"/embed",        icon:"🔗", label:"Embed Widget" },
];

export default function Sidebar() {
  const router   = useRouter();
  const pathname = usePathname();
  const name     = typeof window !== "undefined" ? localStorage.getItem("client_name") : "";

  function logout() { localStorage.clear(); router.push("/"); }

  return (
    <aside style={s.sidebar}>
      <div style={s.brand}>💳 CryptoPay</div>
      <nav style={s.nav}>
        {links.map(l => (
          <a key={l.href} href={l.href} style={{ ...s.item, ...(pathname === l.href ? s.active : {}) }}>
            {l.icon} {l.label}
          </a>
        ))}
      </nav>
      <div style={s.bottom}>
        <div style={s.name}>{name}</div>
        <button style={s.logout} onClick={logout}>Sign out</button>
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  sidebar: { width:220, background:"#0f172a", borderRight:"1px solid #1e293b", display:"flex", flexDirection:"column", padding:"24px 0", flexShrink:0, minHeight:"100vh" },
  brand:   { fontSize:16, fontWeight:700, color:"#f1f5f9", padding:"0 20px 24px" },
  nav:     { display:"flex", flexDirection:"column", gap:4, padding:"0 12px", flexGrow:1 },
  item:    { display:"block", padding:"10px 12px", borderRadius:8, color:"#64748b", textDecoration:"none", fontSize:14 },
  active:  { background:"#1e293b", color:"#f1f5f9" },
  bottom:  { padding:"16px 20px", borderTop:"1px solid #1e293b" },
  name:    { fontSize:13, color:"#94a3b8", marginBottom:8 },
  logout:  { background:"transparent", border:"1px solid #334155", color:"#64748b", borderRadius:6, padding:"6px 12px", cursor:"pointer", fontSize:12, width:"100%" },
};
