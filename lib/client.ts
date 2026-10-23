export async function api<T = any>(
  url: string,
  options: RequestInit = {}
): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { data: null, error: body.error || `Error ${res.status}`, status: res.status };
    }
    return { data: body, error: null, status: res.status };
  } catch (e: any) {
    return { data: null, error: e.message || "Error de red", status: 0 };
  }
}

export async function getMe() {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}
