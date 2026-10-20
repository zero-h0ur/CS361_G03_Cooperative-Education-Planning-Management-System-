export function createDirectoryClient({ apiBaseUrl, getAccessToken, fetchImpl = fetch } = {}) {
  const base = new URL(apiBaseUrl);
  if (base.protocol !== 'https:' && base.hostname !== 'localhost') throw new Error('Invalid API origin.');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid API origin.');
  let signedOut = false;
  async function read(path, { signal, token } = {}) {
    const response = await fetchImpl(base.origin + path, { signal, credentials: 'omit', redirect: 'error',
      headers: { Accept: 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
    if (!response.ok) { const error = new Error('Directory request failed.'); error.status = response.status; throw error; }
    return response.json();
  }
  async function accessToken() {
    if (!getAccessToken || signedOut) return null;
    try { const token = await getAccessToken(); return signedOut ? null : token; } catch { return null; }
  }
  return Object.freeze({
    invalidate() { signedOut = true; },
    async list(filters = {}, { signal } = {}) {
      const token = await accessToken();
      const query = new URLSearchParams();
      for (const key of ['q', 'location', 'page', 'pageSize']) if (filters[key]) query.set(key, String(filters[key]));
      if (token) for (const key of ['role', 'duration', 'recruitingOnly']) {
        if (filters[key]) query.set(key, String(filters[key]));
      }
      if (token) {
        try {
          const result = await read('/api/v3/directory/companies?' + query, { token, signal });
          if (signedOut) throw new Error('Session ended.');
          return result;
        } catch (error) {
          if (![401, 403].includes(error.status)) throw error;
          signedOut = true;
          for (const key of ['role', 'duration', 'recruitingOnly']) query.delete(key);
        }
      }
      return read('/api/directory/companies?' + query, { signal });
    },
    async detail(id, { signal } = {}) {
      const token = await accessToken();
      if (token) {
        try {
          const result = await read('/api/v3/directory/companies/' + encodeURIComponent(id), { token, signal });
          if (signedOut) throw new Error('Session ended.');
          return result;
        } catch (error) {
          if (![401, 403].includes(error.status)) throw error;
          signedOut = true;
        }
      }
      return read('/api/directory/companies/' + encodeURIComponent(id), { signal });
    }
  });
}
