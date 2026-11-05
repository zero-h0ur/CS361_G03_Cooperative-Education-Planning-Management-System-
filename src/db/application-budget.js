const {performance}=require('node:perf_hooks');
const {ServiceUnavailableError}=require('../api/errors');
// A single transaction budget, not a fresh timeout for each SQL/storage call.
// Rollback/release use the original client so expiry never prevents cleanup.
function applicationBudget(client,{milliseconds=24000,now=()=>performance.now()}={}){
  const deadline=now()+milliseconds;
  const remaining=()=>{
    const ms=Math.floor(deadline-now());
    if(ms<=0)throw new ServiceUnavailableError('ทำรายการเกินเวลาที่กำหนด กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง','APPLICATION_TIMEOUT');
    return ms;
  };
  return {
    signal:()=>AbortSignal.timeout(Math.max(1,Math.min(20000,remaining()))),
    async query(...args){
      await client.query("SELECT set_config('statement_timeout',$1,true)",[Math.min(3000,remaining())+'ms']);
      remaining();return client.query(...args);
    }
  };
}
module.exports={applicationBudget};
