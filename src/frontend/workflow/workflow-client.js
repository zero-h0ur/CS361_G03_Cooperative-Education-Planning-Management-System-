/** Authenticated integration only. No role claims, tokens or personal data in storage. */
export function createWorkflowClient({apiBaseUrl,getAccessToken,fetchImpl=globalThis.fetch.bind(globalThis),currentOrigin=globalThis.location?.origin} = {}) {
  if (!apiBaseUrl || typeof getAccessToken !== 'function') throw new Error('Missing API configuration.');
  const base=new URL(apiBaseUrl,currentOrigin);
  return Object.freeze({
    async request(path,{method='GET',body,signal}={}) {
      const relative=new URL(path,'https://local.invalid');
      const id='[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
      const phase1=new RegExp(`^/api/v4/(?:cycles/${id}/(?:schedule|selection-decision|confirm|waive|announce)|notifications(?:/${id}/read)?)$`,'i');
      if (!path.startsWith('/api/') || relative.origin!=='https://local.invalid' || relative.hash ||
        !(/^\/api\/(?:v3\/|v4\/coordinator\/)/.test(relative.pathname) || phase1.test(relative.pathname))) throw new Error('Unsupported API path.');
      const endpoint=new URL(base.href); endpoint.pathname=`${base.pathname.replace(/\/$/,'')}${relative.pathname}`;
      endpoint.search=relative.search; endpoint.hash='';
      const token=await getAccessToken();
      if (!token) throw Object.assign(new Error('กรุณาเข้าสู่ระบบใหม่'),{status:401});
      let response;
      try {
        response=await fetchImpl(endpoint.href,{method,signal,cache:'no-store',headers:{Accept:'application/json',
          Authorization:`Bearer ${token}`,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
      } catch(error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('เชื่อมต่อไม่สำเร็จ กรุณาลองอีกครั้งด้วยข้อมูลเดิม');
      }
      let payload;
      try { payload=await response.json(); } catch { throw new Error('อ่านผลลัพธ์ไม่สำเร็จ กรุณารีเฟรช'); }
      if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'ทำรายการไม่สำเร็จ กรุณารีเฟรชแล้วลองใหม่'),{status:response.status,code:payload?.error?.code});
      if (!payload || !Object.hasOwn(payload,'data')) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง');
      return payload.data;
    }
  });
}
