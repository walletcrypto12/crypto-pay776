"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type Balance = {
  chainId: number; chainName: string; symbol: string;
  balanceNative: number | null; balanceUsd: number | null;
  dropAmountNative: number; dropsRemaining: number | null;
};
type Drop = {
  id: string; address: string; chain: string; amountNative: number;
  txHash: string; createdAt: string; client: { name: string } | null;
};
type Relayer = {
  configured: boolean; address: string | null;
  forwarderContract?: string; balanceEth?: number | null; balanceUsd?: number | null;
};
type TronRelayer = {
  configured: boolean; address: string | null;
  forwarderContract?: string; balanceTrx?: number | null; balanceUsd?: number | null;
};
type GasDropData = {
  configured: boolean; address: string | null; balances: Balance[];
  recentDrops: Drop[]; totalDrops?: number; dropsLast24h?: number;
  relayer?: Relayer; tronRelayer?: TronRelayer;
};

export default function GasDropPage() {
  const router = useRouter();
  const [data, setData] = useState<GasDropData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedRelayer, setCopiedRelayer] = useState(false);
  const [copiedTronRelayer, setCopiedTronRelayer] = useState(false);
  const adminName = typeof window !== "undefined" ? localStorage.getItem("admin_name") : "Admin";

  useEffect(() => {
    const token = localStorage.getItem("admin_token");
    if (!token) { router.push("/"); return; }
    api.gasDrop().then(setData).catch(() => { localStorage.removeItem("admin_token"); router.push("/"); }).finally(() => setLoading(false));
  }, [router]);

  function copyAddress() {
    if (!data?.address) return;
    navigator.clipboard.writeText(data.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyRelayerAddress() {
    if (!data?.relayer?.address) return;
    navigator.clipboard.writeText(data.relayer.address);
    setCopiedRelayer(true);
    setTimeout(() => setCopiedRelayer(false), 2000);
  }

  function copyTronRelayerAddress() {
    if (!data?.tronRelayer?.address) return;
    navigator.clipboard.writeText(data.tronRelayer.address);
    setCopiedTronRelayer(true);
    setTimeout(() => setCopiedTronRelayer(false), 2000);
  }

  function logout() { localStorage.clear(); router.push("/"); }
  function shorten(a: string) { return `${a.slice(0, 8)}…${a.slice(-6)}`; }

  if (loading) return <div style={s.center}>Loading…</div>;

  const lowBalanceChains = (data?.balances ?? []).filter(b => b.dropsRemaining !== null && b.dropsRemaining < 3);

  return (
    <div style={s.page}>
      <aside style={s.sidebar}>
        <div style={s.brand}>🔐 CryptoPay</div>
        <nav style={s.nav}>
          <a style={s.navItem} href="/dashboard">📊 Dashboard</a>
          <a style={s.navItem} href="/clients">👥 Clients</a>
          <a style={s.navItem} href="/transactions">💳 Transactions</a>
          <a style={{...s.navItem,...s.navActive}} href="/gas-drop">⛽ Gas Drop</a>
        </nav>
        <div style={s.sideBottom}>
          <div style={s.adminName}>{adminName}</div>
          <button style={s.logoutBtn} onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main style={s.main}>
        <h1 style={s.heading}>Gas Drop Wallet</h1>
        <p style={s.sub}>
          Platform-funded hot wallet that tops up payers who don't have enough native token to cover gas. Cost is absorbed by the platform.
        </p>

        {!data?.configured ? (
          <div style={s.warnBox}>⚠️ Gas drop is not configured on this deployment — no <code>GAS_DROP_PRIVATE_KEY</code> is set.</div>
        ) : (
          <>
            <div style={s.card}>
              <div style={s.cardTitle}>Wallet Address</div>
              <div style={s.addrRow}>
                <code style={s.addrCode}>{data.address}</code>
                <button style={s.copyBtn} onClick={copyAddress}>{copied ? "✓ Copied" : "Copy"}</button>
              </div>
              <div style={s.hint}>Same address across all chains — fund it separately per network from your own wallet. The private key lives only on the server (SSH-only), never here.</div>
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>Relayer Wallet</div>
              {!data?.relayer?.configured ? (
                <div style={s.hint}>⚠️ Relayer is not configured on this deployment — no <code>RELAYER_PRIVATE_KEY</code> is set.</div>
              ) : (
                <>
                  <div style={s.addrRow}>
                    <code style={s.addrCode}>{data.relayer.address}</code>
                    <button style={s.copyBtn} onClick={copyRelayerAddress}>{copiedRelayer ? "✓ Copied" : "Copy"}</button>
                  </div>
                  <div style={s.hint}>
                    Pays gas to complete Ethereum + USDC payments via the CryptoPayForwarderV2 contract, on behalf of payers who've already approved it. Balance: {data.relayer.balanceEth !== null && data.relayer.balanceEth !== undefined ? `${data.relayer.balanceEth.toFixed(5)} ETH` : "—"}
                    {data.relayer.balanceUsd !== null && data.relayer.balanceUsd !== undefined ? ` (~$${data.relayer.balanceUsd.toFixed(2)})` : ""}.
                    {data.relayer.balanceEth !== null && data.relayer.balanceEth !== undefined && data.relayer.balanceEth < 0.005 ? " ⚠️ Low — fund it so relayed payments don't fail." : ""}
                    {" "}The private key lives only on the server (SSH-only), never here.
                  </div>
                </>
              )}
            </div>

            <div style={s.card}>
              <div style={s.cardTitle}>Tron Relayer Wallet</div>
              {!data?.tronRelayer?.configured ? (
                <div style={s.hint}>⚠️ Tron relayer is not configured on this deployment — no <code>TRON_RELAYER_PRIVATE_KEY</code> is set.</div>
              ) : (
                <>
                  <div style={s.addrRow}>
                    <code style={s.addrCode}>{data.tronRelayer.address}</code>
                    <button style={s.copyBtn} onClick={copyTronRelayerAddress}>{copiedTronRelayer ? "✓ Copied" : "Copy"}</button>
                  </div>
                  <div style={s.hint}>
                    Receives ChangeNOW's USDT (TRC20) payout, then forwards it to the client's wallet via CryptoPayForwarderTron. Balance: {data.tronRelayer.balanceTrx !== null && data.tronRelayer.balanceTrx !== undefined ? `${data.tronRelayer.balanceTrx.toFixed(3)} TRX` : "—"}
                    {data.tronRelayer.balanceUsd !== null && data.tronRelayer.balanceUsd !== undefined ? ` (~$${data.tronRelayer.balanceUsd.toFixed(2)})` : ""}.
                    {data.tronRelayer.balanceTrx !== null && data.tronRelayer.balanceTrx !== undefined && data.tronRelayer.balanceTrx < 10 ? " ⚠️ Low — fund it so relayed payments don't fail." : ""}
                    {" "}The private key lives only on the server (SSH-only), never here.
                  </div>
                </>
              )}
            </div>

            {lowBalanceChains.length > 0 && (
              <div style={s.warnBox}>
                ⚠️ Low balance — fewer than 3 drops remaining on: {lowBalanceChains.map(c => c.chainName).join(", ")}
              </div>
            )}

            <div style={s.statsRow}>
              <div style={s.statCard}><div style={s.statVal}>{data.totalDrops ?? 0}</div><div style={s.statLbl}>Total drops sent</div></div>
              <div style={s.statCard}><div style={s.statVal}>{data.dropsLast24h ?? 0}</div><div style={s.statLbl}>Drops in last 24h</div></div>
            </div>

            <div style={s.section}>
              <div style={s.sectionHeader}><h2 style={s.sectionTitle}>Balances by Chain</h2></div>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead><tr>{["Chain","Balance","USD Value","Drop Size","Drops Left"].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.balances.map(b => (
                      <tr key={b.chainId} style={s.tr}>
                        <td style={s.td}>{b.chainName}</td>
                        <td style={s.td}>{b.balanceNative !== null ? `${b.balanceNative.toFixed(5)} ${b.symbol}` : "—"}</td>
                        <td style={s.td}>{b.balanceUsd !== null ? `$${b.balanceUsd.toFixed(2)}` : "—"}</td>
                        <td style={s.td}>{b.dropAmountNative} {b.symbol}</td>
                        <td style={s.td}>
                          <span style={{...s.badge, ...(b.dropsRemaining !== null && b.dropsRemaining < 3 ? s.badgeWarn : s.badgeOk)}}>
                            {b.dropsRemaining ?? "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={s.section}>
              <div style={s.sectionHeader}><h2 style={s.sectionTitle}>Recent Drops</h2></div>
              <div style={s.tableWrap}>
                <table style={s.table}>
                  <thead><tr>{["Date","Merchant","Chain","Amount","Recipient","Tx"].map(h => <th key={h} style={s.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {data.recentDrops.length ? data.recentDrops.map(d => (
                      <tr key={d.id} style={s.tr}>
                        <td style={s.td}>{new Date(d.createdAt).toLocaleString()}</td>
                        <td style={s.td}>{d.client?.name ?? "—"}</td>
                        <td style={s.td}>{d.chain}</td>
                        <td style={s.td}>{d.amountNative}</td>
                        <td style={s.td}><code style={s.addrSm}>{shorten(d.address)}</code></td>
                        <td style={s.td}><code style={s.addrSm}>{shorten(d.txHash)}</code></td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} style={s.empty}>No gas drops sent yet</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
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
  heading:     { margin:"0 0 6px", fontSize:24, fontWeight:700 },
  sub:         { margin:"0 0 24px", color:"#64748b", fontSize:13, maxWidth:640, lineHeight:1.6 },
  warnBox:     { background:"#422006", border:"1px solid #92400e", color:"#fdba74", borderRadius:10, padding:"14px 18px", fontSize:13, marginBottom:20 },
  card:        { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px", marginBottom:20 },
  cardTitle:   { fontSize:15, fontWeight:700, marginBottom:12 },
  addrRow:     { display:"flex", gap:12, alignItems:"center", marginBottom:8 },
  addrCode:    { flexGrow:1, background:"#1e293b", padding:"10px 14px", borderRadius:8, fontSize:13, color:"#93c5fd", wordBreak:"break-all" },
  copyBtn:     { background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"8px 14px", cursor:"pointer", fontSize:12, flexShrink:0 },
  hint:        { fontSize:12, color:"#64748b", lineHeight:1.6 },
  statsRow:    { display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:16, marginBottom:20 },
  statCard:    { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"18px 20px" },
  statVal:     { fontSize:24, fontWeight:700, marginBottom:4 },
  statLbl:     { fontSize:12, color:"#64748b" },
  section:     { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, overflow:"hidden", marginBottom:20 },
  sectionHeader:{ padding:"18px 20px", borderBottom:"1px solid #1e293b" },
  sectionTitle: { margin:0, fontSize:16, fontWeight:700 },
  tableWrap:   { overflowX:"auto" },
  table:       { width:"100%", borderCollapse:"collapse" },
  th:          { padding:"12px 16px", textAlign:"left", fontSize:12, color:"#64748b", fontWeight:600, textTransform:"uppercase", borderBottom:"1px solid #1e293b" },
  tr:          { borderBottom:"1px solid #0f172a" },
  td:          { padding:"12px 16px", fontSize:13 },
  addrSm:      { fontFamily:"monospace", fontSize:11, color:"#94a3b8" },
  badge:       { display:"inline-block", padding:"3px 10px", borderRadius:999, fontSize:11, fontWeight:700 },
  badgeOk:     { background:"#14532d", color:"#86efac" },
  badgeWarn:   { background:"#450a0a", color:"#fca5a5" },
  empty:       { padding:"32px", textAlign:"center", color:"#64748b" },
};
