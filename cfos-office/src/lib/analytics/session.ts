let cachedSessionId: string | null = null;

export function getSessionId(): string {
  if (typeof window === 'undefined') return 'server';

  if (cachedSessionId) return cachedSessionId;

  cachedSessionId = sessionStorage.getItem('cfo_session_id');
  if (!cachedSessionId) {
    cachedSessionId = crypto.randomUUID();
    sessionStorage.setItem('cfo_session_id', cachedSessionId);
  }

  return cachedSessionId;
}
