// The TU bridge is a transport for Student endpoints, not an auth bypass or
// a second workflow. Cognito routes keep their existing authorizer boundary.
const id='[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const routes=[
  ['GET',/^\/api\/v3\/me$/],
  ['GET',/^\/api\/v3\/students\/me$/],['PATCH',/^\/api\/v3\/students\/me$/],
  ['GET',/^\/api\/v3\/student\/selection$/],
  ['GET',new RegExp(`^/api/v4/cycles/${id}/(?:schedule|selection-decision)$`,'i')],
  ['POST',new RegExp(`^/api/v4/cycles/${id}/(?:confirm|waive)$`,'i')],
  ['GET',/^\/api\/v4\/notifications$/],
  ['PATCH',new RegExp(`^/api/v4/notifications/${id}/read$`,'i')],
  ['GET',/^\/api\/v4\/application-options$/],
  ['GET',/^\/api\/v4\/applications$/],['POST',/^\/api\/v4\/applications$/],
  ['GET',new RegExp(`^/api/v4/applications/${id}$`,'i')],
  ['PATCH',new RegExp(`^/api/v4/applications/${id}$`,'i')],
  ['GET',new RegExp(`^/api/v4/applications/${id}/readiness$`,'i')],
  ['POST',new RegExp(`^/api/v4/applications/${id}/(?:submit|uploads|documents/${id}/download|uploads/${id}/complete)$`,'i')],
  ['PUT',new RegExp(`^/api/v4/applications/${id}/uploads/${id}/content$`,'i')],
  ['GET',new RegExp(`^/api/v4/applications/${id}/documents/${id}/content$`,'i')]
];
function allowsTuBridge(method,path) {
  return routes.some(([verb,pattern])=>(method==='OPTIONS' || method===verb) && pattern.test(path));
}
module.exports={allowsTuBridge};
