export function getApiKey(): string {
  const params = new URLSearchParams(window.location.search);
  const keyFromUrl = params.get('key');
  if (keyFromUrl) {
    localStorage.setItem('adminApiKey', keyFromUrl);
    return keyFromUrl;
  }
  return localStorage.getItem('adminApiKey') || '';
}

export async function apiFetch<T>(basePath: string, endpoint: string, options: RequestInit = {}): Promise<T> {
  const apiKey = getApiKey();
  const response = await fetch(`${basePath}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
      ...(options.headers as Record<string, string> || {}),
    },
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || error.error || 'Request failed');
  }
  return response.json();
}

export function adminApi<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>('/api/v1/admin', endpoint, options);
}

export function chatApi<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>('/api/v1', endpoint, options);
}

export function processingApi<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>('/api/v1/processing', endpoint, options);
}

export function questionsApi<T = unknown>(endpoint: string, options?: RequestInit): Promise<T> {
  return apiFetch<T>('/api/v1/questions', endpoint, options);
}
