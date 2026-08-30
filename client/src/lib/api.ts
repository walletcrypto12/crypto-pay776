const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

function getToken() {
  return typeof window !== "undefined" ? localStorage.getItem("client_token") : null;
}

async function apiFetch(path: string, opts: RequestInit = {}) {
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
  // Auth
  register: (body: object) => apiFetch("/api/client/register", { method: "POST", body: JSON.stringify(body) }),
  login:    (body: object) => apiFetch("/api/client/login",    { method: "POST", body: JSON.stringify(body) }),

  // Stats + profile
  stats:   ()                       => apiFetch("/api/client/stats"),
  profile: ()                       => apiFetch("/api/client/me"),

  // Wallets
  wallets:      ()                       => apiFetch("/api/client/wallets"),
  upsertWallet: (body: object)           => apiFetch("/api/client/wallets",     { method: "POST",   body: JSON.stringify(body) }),
  deleteWallet: (chain: string)          => apiFetch(`/api/client/wallets/${chain}`, { method: "DELETE" }),

  // Plans
  plans:        ()                       => apiFetch("/api/client/plans"),
  createPlan:   (body: object)           => apiFetch("/api/client/plans",       { method: "POST",   body: JSON.stringify(body) }),
  updatePlan:   (id: string, body: object)=> apiFetch(`/api/client/plans/${id}`, { method: "PATCH",  body: JSON.stringify(body) }),
  deletePlan:   (id: string)             => apiFetch(`/api/client/plans/${id}`, { method: "DELETE" }),

  // Transactions
  transactions: (page = 1)              => apiFetch(`/api/client/transactions?page=${page}`),

  // Subscribers
  subscribers:  (page = 1)              => apiFetch(`/api/client/subscribers?page=${page}`),

  // Webhooks
  webhooks:      ()                     => apiFetch("/api/client/webhooks"),
  createWebhook: (body: object)         => apiFetch("/api/client/webhooks",     { method: "POST",   body: JSON.stringify(body) }),
  deleteWebhook: (id: string)           => apiFetch(`/api/client/webhooks/${id}`,{ method: "DELETE" }),

  // API Key
  regenerateKey: () => apiFetch("/api/client/regenerate-key", { method: "POST" }),
};
