"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { api } from "@/lib/api";

type Plan = { id:string; name:string; priceUsd:number; intervalDays:number|null; features:string|null; active:boolean };
const BLANK = { name:"", priceUsd:"", intervalDays:"", features:"", lifetime: false };

export default function PlansPage() {
  const router = useRouter();
  const [plans,   setPlans]   = useState<Plan[]>([]);
  const [form,    setForm]    = useState(BLANK);
  const [editId,  setEditId]  = useState<string|null>(null);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");

  useEffect(() => {
    if (!localStorage.getItem("client_token")) { router.push("/"); return; }
    api.plans().then(setPlans).finally(() => setLoading(false));
  }, [router]);

  function set(k: string, v: any) { setForm(f => ({ ...f, [k]: v })); }

  function startEdit(p: Plan) {
    setEditId(p.id);
    setForm({ name: p.name, priceUsd: String(p.priceUsd), intervalDays: p.intervalDays ? String(p.intervalDays) : "", features: p.features ?? "", lifetime: !p.intervalDays });
    setError("");
  }

  function cancelEdit() { setEditId(null); setForm(BLANK); setError(""); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setSaving(true);
    const body = {
      name:        form.name,
      priceUsd:    parseFloat(form.priceUsd),
      intervalDays:(form as any).lifetime ? null : parseInt(form.intervalDays) || null,
      features:    form.features || null,
    };
    try {
      if (editId) {
        const updated = await api.updatePlan(editId, body);
        setPlans(prev => prev.map(p => p.id === editId ? updated : p));
        cancelEdit();
      } else {
        const created = await api.createPlan(body);
        setPlans(prev => [...prev, created]);
        setForm(BLANK);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setSaving(false); }
  }

  async function deletePlan(id: string) {
    if (!confirm("Delete this plan?")) return;
    await api.deletePlan(id);
    setPlans(prev => prev.filter(p => p.id !== id));
    if (editId === id) cancelEdit();
  }

  if (loading) return <div style={s.center}>Loading…</div>;

  return (
    <div style={s.page}>
      <Sidebar />
      <main style={s.main}>
        <h1 style={s.heading}>Subscription Plans</h1>

        {/* Form */}
        <div style={s.card}>
          <h2 style={s.cardTitle}>{editId ? "Edit Plan" : "Create Plan"}</h2>
          <form onSubmit={save} style={s.form}>
            <div style={s.row}>
              <input style={s.input} placeholder="Plan name (e.g. Pro Monthly)" value={form.name} onChange={e=>set("name",e.target.value)} required />
              <input style={{...s.input,...s.inputSm}} type="number" placeholder="Price USD" min="0" step="0.01" value={form.priceUsd} onChange={e=>set("priceUsd",e.target.value)} required />
            </div>
            <div style={s.row}>
              <label style={s.checkRow}>
                <input type="checkbox" checked={(form as any).lifetime} onChange={e=>set("lifetime",e.target.checked)} />
                <span style={{marginLeft:8}}>Lifetime (no expiry)</span>
              </label>
              {!(form as any).lifetime && (
                <input style={{...s.input,...s.inputSm}} type="number" placeholder="Interval days (e.g. 30)" min="1" value={form.intervalDays} onChange={e=>set("intervalDays",e.target.value)} />
              )}
            </div>
            <input style={s.input} placeholder="Features (comma-separated, optional)" value={form.features} onChange={e=>set("features",e.target.value)} />
            {error && <div style={s.error}>{error}</div>}
            <div style={s.formActions}>
              <button style={s.btn} type="submit" disabled={saving}>{saving ? "Saving…" : editId ? "Update" : "Create Plan"}</button>
              {editId && <button style={s.cancelBtn} type="button" onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </div>

        {/* Plan list */}
        {plans.length ? (
          <div style={s.planGrid}>
            {plans.map(p => (
              <div key={p.id} style={{ ...s.planCard, ...(editId===p.id?s.planCardActive:{}) }}>
                <div style={s.planName}>{p.name}</div>
                <div style={s.planPrice}>${p.priceUsd.toFixed(2)}</div>
                <div style={s.planInterval}>{p.intervalDays ? `Every ${p.intervalDays} days` : "Lifetime"}</div>
                {p.features && (
                  <ul style={s.features}>
                    {p.features.split(",").map(f => <li key={f} style={s.featureItem}>{f.trim()}</li>)}
                  </ul>
                )}
                <div style={s.planActions}>
                  <button style={s.editBtn} onClick={() => startEdit(p)}>Edit</button>
                  <button style={s.deleteBtn} onClick={() => deletePlan(p.id)}>Delete</button>
                </div>
              </div>
            ))}
          </div>
        ) : <div style={s.empty}>No plans yet. Create your first plan above.</div>}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  center:       { display:"flex", alignItems:"center", justifyContent:"center", height:"100vh" },
  page:         { display:"flex", minHeight:"100vh" },
  main:         { flexGrow:1, padding:"32px 36px", overflowY:"auto" },
  heading:      { margin:"0 0 24px", fontSize:24, fontWeight:700 },
  card:         { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px 24px", marginBottom:24 },
  cardTitle:    { margin:"0 0 16px", fontSize:15, fontWeight:700 },
  form:         { display:"flex", flexDirection:"column", gap:12 },
  row:          { display:"flex", gap:10, alignItems:"center" },
  input:        { flexGrow:1, background:"#1e293b", border:"1px solid #334155", borderRadius:8, padding:"10px 14px", color:"#f1f5f9", fontSize:13, outline:"none" },
  inputSm:      { flexGrow:0, width:160 },
  checkRow:     { display:"flex", alignItems:"center", fontSize:13, color:"#94a3b8", cursor:"pointer" },
  error:        { background:"#450a0a", border:"1px solid #991b1b", borderRadius:8, padding:"10px 14px", color:"#fca5a5", fontSize:13 },
  formActions:  { display:"flex", gap:10 },
  btn:          { background:"#3b82f6", color:"#fff", border:"none", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:13, fontWeight:700 },
  cancelBtn:    { background:"#1e293b", color:"#94a3b8", border:"1px solid #334155", borderRadius:8, padding:"10px 20px", cursor:"pointer", fontSize:13 },
  planGrid:     { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))", gap:16 },
  planCard:     { background:"#0f172a", border:"1px solid #1e293b", borderRadius:12, padding:"20px" },
  planCardActive:{ borderColor:"#3b82f6" },
  planName:     { fontSize:15, fontWeight:700, marginBottom:6 },
  planPrice:    { fontSize:28, fontWeight:800, marginBottom:4 },
  planInterval: { fontSize:12, color:"#64748b", marginBottom:12 },
  features:     { margin:"0 0 12px", padding:"0 0 0 16px" },
  featureItem:  { fontSize:12, color:"#94a3b8", marginBottom:4 },
  planActions:  { display:"flex", gap:8 },
  editBtn:      { flex:1, background:"#1e293b", border:"1px solid #334155", color:"#94a3b8", borderRadius:6, padding:"7px", cursor:"pointer", fontSize:12 },
  deleteBtn:    { background:"#450a0a", border:"none", color:"#fca5a5", borderRadius:6, padding:"7px 12px", cursor:"pointer", fontSize:12 },
  empty:        { color:"#64748b", fontSize:13 },
};
