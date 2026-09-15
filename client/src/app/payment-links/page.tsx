"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

type PaymentLink = { id: string; name: string; priceUsd: number; active: boolean; createdAt: string };
const BLANK = { label: "", amountUsd: "" };

export default function PaymentLinksPage() {
  const router = useRouter();
  const [links,   setLinks]   = useState<PaymentLink[]>([]);
  const [form,    setForm]    = useState(BLANK);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const BACKEND = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
  const urlFor = (id: string) => `${BACKEND}/pay/${id}`;

  function copyUrl(id: string) {
    navigator.clipboard.writeText(urlFor(id));
    setCopiedId(id);
    setTimeout(() => setCopiedId(c => (c === id ? null : c)), 2000);
  }

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    api.paymentLinks().then(setLinks).finally(() => setLoading(false));
  }, [router]);

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSaving(true);
    try {
      const created = await api.createPaymentLink({ label: form.label || undefined, amountUsd: form.amountUsd });
      setLinks(prev => [created, ...prev]);
      setForm(BLANK);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  async function toggleActive(link: PaymentLink) {
    const updated = await api.updatePaymentLink(link.id, { active: !link.active });
    setLinks(prev => prev.map(l => (l.id === link.id ? updated : l)));
  }

  async function remove(id: string) {
    if (!confirm("Delete this payment link? It will stop working immediately.")) return;
    await api.deletePaymentLink(id);
    setLinks(prev => prev.filter(l => l.id !== id));
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <Sidebar />
      <main style={s.main}>
        <h1 style={s.heading}>Payment Links</h1>
        <p style={s.subhead}>
          Create a shareable link for a custom amount — anyone who opens it connects their wallet and pays that amount directly. Good for invoicing a specific customer.
        </p>

        <div style={s.card}>
          <h2 style={s.cardTitle}>Create Payment Link</h2>
          <form onSubmit={create} style={s.form}>
            <div style={s.row}>
              <input style={s.input} placeholder="Label (optional, e.g. Invoice #204)" value={form.label} onChange={e => set("label", e.target.value)} />
              <input style={{ ...s.input, ...s.inputSm }} type="number" placeholder="Amount USD" min="0.01" step="0.01" value={form.amountUsd} onChange={e => set("amountUsd", e.target.value)} required />
            </div>
            {error && <div style={s.error}>{error}</div>}
            <div style={s.formActions}>
              <button style={s.btn} type="submit" disabled={saving}>{saving ? "Creating…" : "Create Link"}</button>
            </div>
          </form>
        </div>

        {links.length ? (
          <div style={s.linkGrid}>
            {links.map(l => (
              <div key={l.id} style={{ ...s.linkCard, ...(l.active ? {} : s.linkCardInactive) }}>
                <div style={s.linkName}>{l.name}</div>
                <div style={s.linkPrice}>${l.priceUsd.toFixed(2)}</div>
                <div style={s.linkStatus}>{l.active ? "Active" : "Deactivated"}</div>
                <div style={s.linkUrlRow}>
                  <code style={s.linkUrlCode}>{urlFor(l.id)}</code>
                  <button style={s.copyBtn} onClick={() => copyUrl(l.id)}>{copiedId === l.id ? "✓ Copied" : "Copy"}</button>
                </div>
                <div style={s.linkActions}>
                  <button style={s.toggleBtn} onClick={() => toggleActive(l)}>{l.active ? "Deactivate" : "Activate"}</button>
                  <button style={s.deleteBtn} onClick={() => remove(l.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div style={s.empty}>No payment links yet. Create one above.</div>}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  center:       { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:         { display:"flex", minHeight:"100vh" },
  main:         { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:      { margin:"0 0 8px", fontSize:24, fontWeight:700 },
  subhead:      { margin:"0 0 24px", fontSize:13, color:"#94a3b8", maxWidth:560 },
  card:         { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px", marginBottom:24 },
  cardTitle:    { margin:"0 0 16px", fontSize:15, fontWeight:700 },
  form:         { display:"flex", flexDirection:"column", gap:12 },
  row:          { display:"flex", gap:10, alignItems:"center" },
  input:        { flexGrow:1, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#f1f5f9", fontSize:13, outline:"none" },
  inputSm:      { flexGrow:0, width:160 },
  error:        { background:"#450a0a", border:"1px solid #991b1b", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13 },
  formActions:  { display:"flex", gap:10 },
  btn:          { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:13, fontWeight:700 },
  linkGrid:     { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:16 },
  linkCard:     { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px" },
  linkCardInactive: { opacity:0.55 },
  linkName:     { fontSize:15, fontWeight:700, marginBottom:6 },
  linkPrice:    { fontSize:28, fontWeight:800, marginBottom:4 },
  linkStatus:   { fontSize:12, color:"#64748b", marginBottom:12 },
  linkUrlRow:   { display:"flex", alignItems:"center", gap:6, marginBottom:12, background:"#1e293b", borderRadius:6, padding:"6px 8px" },
  linkUrlCode:  { flexGrow:1, fontSize:11, color:"#93c5fd", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  copyBtn:      { background:"#334155", border:"none", color:"#f1f5f9", borderRadius:4, padding:"3px 8px", cursor:"pointer", fontSize:10, flexShrink:0 },
  linkActions:  { display:"flex", gap:8 },
  toggleBtn:    { flex:1, background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"7px", cursor:"pointer", fontSize:12 },
  deleteBtn:    { background:"#450a0a", border:"none", color:"#fca5a5", borderRadius:6, padding:"7px 12px", cursor:"pointer", fontSize:12 },
  empty:        { color:"#64748b", fontSize:13 },
};
