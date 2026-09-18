"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

export default function EmbedPage() {
  const router = useRouter();
  const [apiKey,   setApiKey]   = useState<string>("");
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [whForm,   setWhForm]   = useState({ url:"" });
  const [copied,   setCopied]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const [regen,    setRegen]    = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<string|null>(null);
  const [approvalCeiling, setApprovalCeiling] = useState("10000");
  const [savingCeiling, setSavingCeiling] = useState(false);
  const [ceilingSaved, setCeilingSaved] = useState(false);

  const PLATFORM = process.env.NEXT_PUBLIC_PLATFORM_URL || "https://your-platform.com";

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    Promise.all([api.profile(), api.webhooks()])
      .then(([p, w]) => {
        setApiKey(p.apiKey);
        setWebhooks(w);
        setApprovalCeiling(String(p.approvalCeilingUsd ?? 10000));
      })
      .finally(() => setLoading(false));
  }, [router]);

  async function saveApprovalCeiling() {
    setSavingCeiling(true);
    try {
      await api.setApprovalCeiling(parseFloat(approvalCeiling));
      setCeilingSaved(true);
      setTimeout(() => setCeilingSaved(false), 2000);
    } finally { setSavingCeiling(false); }
  }

  const snippet = `<!-- CryptoPay Widget -->
<script
  src="${PLATFORM}/widget.js"
  data-api-key="${apiKey}"
  data-plan-id="YOUR_PLAN_ID"
  defer
></script>
<!-- Place this where you want the Pay button to appear -->
<div id="cryptopay-widget"></div>`;

  async function copySnippet() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  async function regenerate() {
    if (!confirm("This will invalidate your current API key. Continue?")) return;
    setRegen(true);
    try {
      const d = await api.regenerateKey();
      setApiKey(d.apiKey);
    } finally { setRegen(false); }
  }

  async function addWebhook(e: React.FormEvent) {
    e.preventDefault();
    const d = await api.createWebhook(whForm);
    setWebhookSecret(d.secret);
    setWebhooks(prev => [...prev, d]);
    setWhForm({ url:"" });
  }

  async function removeWebhook(id: string) {
    if (!confirm("Delete this webhook?")) return;
    await api.deleteWebhook(id);
    setWebhooks(prev => prev.filter(w => w.id !== id));
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <Sidebar />
      <main style={s.main}>
        <h1 style={s.heading}>Embed Widget</h1>

        {/* API Key */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>API Key</h2>
          <div style={s.keyRow}>
            <code style={s.keyCode}>{apiKey}</code>
            <button style={s.regenBtn} onClick={regenerate} disabled={regen}>{regen?"…":"Regenerate"}</button>
          </div>
          <div style={s.hint}>Keep this secret. Anyone with this key can record payments against your account.</div>
        </div>

        {/* Approval ceiling */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Payment Approval Ceiling</h2>
          <p style={s.sub}>
            When a buyer pays with USDC or USDT, they approve this much spending allowance up front — set it above a typical payment so repeat buyers from the same wallet aren't asked to approve every single time. A larger ceiling means less friction for repeat buyers, but also means more could be at risk if our forwarder contract were ever compromised.
          </p>
          <div style={s.keyRow}>
            <input
              style={{ ...s.input, maxWidth: 200 }}
              type="number"
              min="1"
              step="0.01"
              value={approvalCeiling}
              onChange={(e) => setApprovalCeiling(e.target.value)}
            />
            <button style={s.btn} onClick={saveApprovalCeiling} disabled={savingCeiling}>
              {savingCeiling ? "Saving…" : ceilingSaved ? "✓ Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* Embed code */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Embed Code</h2>
          <p style={s.sub}>Paste this into your website. Replace <code style={s.inlineCode}>YOUR_PLAN_ID</code> with the ID from your Plans page.</p>
          <pre style={s.code}>{snippet}</pre>
          <button style={s.copyBtn} onClick={copySnippet}>{copied ? "✓ Copied!" : "Copy Code"}</button>

          <div style={s.stepsCard}>
            <div style={s.stepTitle}>Quick Start</div>
            <ol style={s.ol}>
              <li>Add at least one wallet address in <a href="/wallets" style={s.link}>Wallets</a></li>
              <li>Create at least one plan in <a href="/plans" style={s.link}>Plans</a></li>
              <li>Copy the snippet above and paste it into your site's HTML</li>
              <li>Replace <code style={s.inlineCode}>YOUR_PLAN_ID</code> with the plan ID (visible in Plans page)</li>
              <li>The widget auto-renders a "Pay Now" button wherever you put the <code style={s.inlineCode}>&lt;div id="cryptopay-widget"&gt;</code></li>
            </ol>
          </div>
        </div>

        {/* Webhooks */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>Webhooks</h2>
          <p style={s.sub}>Get notified when a payment is confirmed. Your endpoint will receive a signed POST request.</p>

          {webhookSecret && (
            <div style={s.secretAlert}>
              <strong>Save this secret — it won't be shown again!</strong>
              <code style={s.secretCode}>{webhookSecret}</code>
              <div style={s.secretNote}>Verify incoming webhooks by checking the <code style={s.inlineCode}>X-CryptoPay-Sig</code> header with HMAC-SHA256 using this secret.</div>
              <button style={s.dismissBtn} onClick={() => setWebhookSecret(null)}>I've saved it ✓</button>
            </div>
          )}

          <form onSubmit={addWebhook} style={s.whForm}>
            <input style={s.input} placeholder="https://yoursite.com/webhooks/payment" type="url" value={whForm.url} onChange={e=>setWhForm({url:e.target.value})} required />
            <button style={s.btn} type="submit">Add Webhook</button>
          </form>

          {webhooks.length ? webhooks.map(w => (
            <div key={w.id} style={s.whRow}>
              <span style={s.whStatus}>{w.active ? "🟢" : "🔴"}</span>
              <code style={s.whUrl}>{w.url}</code>
              <button style={s.removeBtn} onClick={() => removeWebhook(w.id)}>Remove</button>
            </div>
          )) : <div style={s.empty}>No webhooks yet</div>}
        </div>
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  center:       { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:         { display:"flex", minHeight:"100vh" },
  main:         { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:      { margin:"0 0 24px", fontSize:24, fontWeight:700 },
  card:         { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px", marginBottom:20 },
  cardTitle:    { margin:"0 0 12px", fontSize:15, fontWeight:700 },
  sub:          { margin:"0 0 14px", color:"#64748b", fontSize:13 },
  keyRow:       { display:"flex", gap:12, alignItems:"center", marginBottom:8 },
  keyCode:      { flexGrow:1, display:"block", background:"#1e293b", padding:"10px 14px", borderRadius:8, fontSize:12, color:"#94a3b8", wordBreak:"break-all" },
  regenBtn:     { background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"8px 14px", cursor:"pointer", fontSize:12, flexShrink:0 },
  hint:         { fontSize:12, color:"#64748b" },
  code:         { background:"#1e293b", borderRadius:8, padding:"16px", fontSize:12, color:"#94a3b8", overflowX:"auto", lineHeight:1.6, margin:"0 0 12px" },
  copyBtn:      { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"9px 20px", cursor:"pointer", fontSize:13, fontWeight:700 },
  inlineCode:   { background:"#1e293b", padding:"2px 6px", borderRadius:4, fontSize:12 },
  stepsCard:    { background:"#1e293b", borderRadius:8, padding:"16px 20px", marginTop:16 },
  stepTitle:    { fontWeight:700, fontSize:13, marginBottom:10 },
  ol:           { margin:0, paddingLeft:20, display:"flex", flexDirection:"column", gap:6 },
  link:         { color:"#3b82f6", textDecoration:"none" },
  secretAlert:  { background:"#422006", border:"1px solid #92400e", borderRadius:8, padding:"16px", marginBottom:16 },
  secretCode:   { display:"block", background:"#1c0e00", padding:"10px 14px", borderRadius:6, fontSize:12, color:"#fdba74", wordBreak:"break-all", margin:"10px 0" },
  secretNote:   { fontSize:12, color:"#d97706", marginBottom:12 },
  dismissBtn:   { background:"#92400e", color:"#fdba74", border:"none", borderRadius:6, padding:"7px 14px", cursor:"pointer", fontSize:12, fontWeight:700 },
  whForm:       { display:"flex", gap:10, marginBottom:14 },
  input:        { flexGrow:1, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#f1f5f9", fontSize:13, outline:"none" },
  btn:          { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:13, fontWeight:700, flexShrink:0 },
  whRow:        { display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderTop:"1px solid #1e293b" },
  whStatus:     { flexShrink:0 },
  whUrl:        { flexGrow:1, fontFamily:"monospace", fontSize:12, color:"#94a3b8", wordBreak:"break-all" },
  removeBtn:    { background:"#450a0a", border:"none", color:"#fca5a5", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontSize:12, flexShrink:0 },
  empty:        { color:"#64748b", fontSize:13, padding:"12px 0" },
};
