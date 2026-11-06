const MODES=Object.freeze(['SCHEDULED','MANUAL_OPEN','CLOSED']);
function evaluateIntake(control,now){
  const time=Date.parse(now),opens=Date.parse(control?.opens_at),closes=Date.parse(control?.closes_at);
  const mode=MODES.includes(control?.mode)?control.mode:'UNCONFIGURED';
  const valid=Number.isFinite(time) && Number.isInteger(control?.version) && control.version>0 &&
    (mode==='CLOSED' && control.opens_at===null && control.closes_at===null ||
     mode==='MANUAL_OPEN' && Number.isFinite(opens) && control.closes_at===null ||
     mode==='SCHEDULED' && Number.isFinite(opens) && Number.isFinite(closes) && opens<closes);
  const is_open=Boolean(valid && (mode==='MANUAL_OPEN' && Number.isFinite(opens) && opens<=time && control.closes_at===null ||
    mode==='SCHEDULED' && Number.isFinite(opens) && Number.isFinite(closes) && opens<closes && opens<=time && time<closes));
  const reason=!valid || mode==='UNCONFIGURED'?'UNCONFIGURED':mode==='CLOSED'?'CLOSED':is_open?'OPEN':time<opens?'UPCOMING':'EXPIRED';
  return {mode,version:control?.version || 0,is_open,reason,opens_at:control?.opens_at || null,closes_at:control?.closes_at || null,server_time:now};
}
module.exports={MODES,evaluateIntake};
