const API_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as any).error || res.statusText);
  }
  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  getSession: () => request<any>("/api/auth/get-session"),

  // Quota & Credits
  getQuota: () => request<{
    totalAvailable: number;
  }>("/api/quota"),

  getCredits: () => request<{
    totalAvailable: number;
  }>("/api/credits"),

  getCreditsTransactions: (limit = 50, offset = 0) =>
    request<{
      transactions: any[];
      total: number;
      limit: number;
      offset: number;
    }>(`/api/credits/transactions?limit=${limit}&offset=${offset}`),

  // Redeem
  redeemCode: (code: string) =>
    request<{ success: boolean; credits: number; newBalance: number }>(
      "/api/redeem",
      { method: "POST", body: JSON.stringify({ code }) }
    ),
};

export { API_URL };
