const {pilotScope}=require('./application-access');
function reviewStage(){
 const mode=process.env.COED_API_MAINTENANCE;
 return !mode || mode==='off' || mode==='intake-pilot' && process.env.COED_COORDINATOR_REVIEW_ENABLED==='true';
}
function handoffScope(){
 if(process.env.COED_API_MAINTENANCE!=='intake-pilot' || process.env.COED_COORDINATOR_REVIEW_ENABLED!=='true' || process.env.COED_COMMITTEE_HANDOFF_ENABLED!=='true')return null;
 return pilotScope(process.env.COED_INTAKE_PILOT);
}
module.exports={reviewStage,handoffScope};
