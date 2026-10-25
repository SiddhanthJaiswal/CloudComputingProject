const API_URL = import.meta.env.VITE_API_URL || '/api';

// Fired when the server rejects the session (expired, revoked, or signed out
// elsewhere) so AuthContext can drop the user back to the sign-in screen.
export const SESSION_ENDED_EVENT = 'pp:session-ended';

async function request(path, { method = 'GET', body } = {}) {
  // The session is an HttpOnly cookie - the browser attaches it; scripts never see it.
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no JSON body
  }

  if (!res.ok) {
    if (res.status === 401 && data?.code && data.code !== 'NO_SESSION') {
      window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: data.error }));
    }
    const message = data?.error || `Request failed with status ${res.status}`;
    const error = new Error(message);
    error.status = res.status;
    error.code = data?.code;
    throw error;
  }

  return data;
}

export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  register: (payload) => request('/auth/register', { method: 'POST', body: payload }),
  logout: () => request('/auth/logout', { method: 'POST' })
};
