export async function remoteRequest<T>(path: string, body: object = {}, signal?: AbortSignal): Promise<T> {
  // Keep temporary pairing tokens out of toolkit request/response-body logs.
  // Match the platform's base path and CSRF header without logging payloads.
  const base = (process.env.CLIENT_BASE_PATH || '/').replace(/\/?$/, '/');
  const request = new AbortController();
  const abort = () => request.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) request.abort();
  const timer = setTimeout(abort, 4000);
  try {
    const response = await fetch(`${base}api/remote/${path}`, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(window.csrfToken ? { 'X-Suda-Csrf-Token': window.csrfToken } : {}) }, body: JSON.stringify(body), signal: request.signal });
    const data = await response.json();
    if (!response.ok) throw { response: { data } };
    return data as T;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
export function remoteError(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = error.response as { data?: { error?: { message?: string } } };
    if (response.data?.error?.message) return response.data.error.message;
  }
  return '网络未连接，请检查两台手机的网络后重试';
}
