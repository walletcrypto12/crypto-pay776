const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("admin_token") : null;
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export const api = {
  login:              (body: object)          => apiFetch("/api/admin/login",               { method: "POST", body: JSON.stringify(body) }),
  stats:              ()                       => apiFetch("/api/admin/stats"),
  clients:            ()                       => apiFetch("/api/admin/clients"),
  client:             (id: string)             => apiFetch(`/api/admin/clients/${id}`),
  setClientStatus:    (id: string, status: string) => apiFetch(`/api/admin/clients/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  setClientPlan:      (id: string, plan: string)   => apiFetch(`/api/admin/clients/${id}/plan`,   { method: "PATCH", body: JSON.stringify({ plan }) }),
  deleteClient:       (id: string)             => apiFetch(`/api/admin/clients/${id}`,      { method: "DELETE" }),
  transactions:       (page = 1)               => apiFetch(`/api/admin/transactions?page=${page}`),
};
