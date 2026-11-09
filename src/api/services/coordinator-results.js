// Read model only: a saved Committee decision, never a new selection algorithm.
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function capacity(proposal){
  if(!proposal)return null;
  const hasTotal=Object.hasOwn(proposal,'total'),hasLegacy=Object.hasOwn(proposal,'normal')||Object.hasOwn(proposal,'special');
  if(hasTotal&&hasLegacy&&(!Number.isInteger(proposal.normal)||!Number.isInteger(proposal.special)||proposal.normal<0||proposal.special<0||proposal.total!==proposal.normal+proposal.special))return null;
  const value=hasTotal?proposal.total:
    Number.isInteger(proposal.normal)&&Number.isInteger(proposal.special)&&proposal.normal>=0&&proposal.special>=0?proposal.normal+proposal.special:null;
  return Number.isInteger(value)&&value>0&&value<=999?value:null;
}
function result(state,roster,{scopeLimited=false}={}){
  if(scopeLimited)return {status:'SCOPE_LIMITED',capacity:null,proposal_status:null,forwarded:null,selected:null,not_selected:null,applicants:[],finalized_at:null};
  const count=capacity(state?.proposal),base={capacity:count,proposal_status:state?.proposal?.status || null,forwarded:roster.length,selected:null,not_selected:null,applicants:[],finalized_at:null};
  if(state?.finalized!==true)return {...base,status:'PENDING'};
  const retained=state.applicants,selected=state.selected;
  const valid=Array.isArray(retained)&&retained.length>0&&retained.every(a=>a&&UUID.test(a.id)&&Number.isInteger(a.version)&&a.version>0)&&
    new Set(retained.map(a=>a.id)).size===retained.length&&Array.isArray(selected)&&selected.length>0&&new Set(selected).size===selected.length&&
    selected.every(id=>retained.some(a=>a.id===id))&&state.proposal?.status==='accepted'&&count!==null&&
    roster.length===retained.length&&new Set(roster.map(a=>a.id)).size===roster.length&&
    retained.every(a=>roster.some(row=>row.id===a.id&&row.version===a.version));
  if(!valid)return {...base,status:'INCOMPLETE'};
  const chosen=new Set(selected),applicants=roster.map(row=>({...row,outcome:chosen.has(row.id)?'SELECTED':'NOT_SELECTED'}))
    .sort((a,b)=>(a.full_name || '').localeCompare(b.full_name || '','th')||a.id.localeCompare(b.id));
  return {...base,status:'CONFIRMED',selected:chosen.size,not_selected:roster.length-chosen.size,applicants,
    finalized_at:(Array.isArray(state.history)?state.history.find(entry=>entry?.title==='finalize')?.at:null) || null};
}
function summary(panels){
  const all=panels.length>0,scoped=all&&panels.every(p=>p.result.status!=='SCOPE_LIMITED');
  const complete=scoped&&panels.every(p=>p.result.status==='CONFIRMED');
  const capacityReady=scoped&&panels.every(p=>p.result.capacity!==null&&p.result.proposal_status==='accepted');
  const sum=key=>panels.reduce((n,p)=>n+p.result[key],0);
  return {panels:panels.length,confirmed_panels:panels.filter(p=>p.result.status==='CONFIRMED').length,
    forwarded:all?(scoped?sum('forwarded'):null):0,capacity:capacityReady?sum('capacity'):null,
    selected:complete?sum('selected'):null,not_selected:complete?sum('not_selected'):null};
}
module.exports={capacity,result,summary};
