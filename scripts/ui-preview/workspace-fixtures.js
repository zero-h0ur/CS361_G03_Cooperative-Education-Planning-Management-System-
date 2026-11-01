import {createPreviewClients} from './fixtures.js';
import {enhanceWorkflowPreview} from './workflow-fixtures.js';
import {selectionPreview} from './selection-fixtures.js';
import {createApplicationPreview,APPLICATION_SCENARIOS} from './application-fixtures.js';
// Keep the old preview model on a recognized legacy scenario when a new
// application scenario is selected. Only the new client receives that scenario.
export function createWorkspacePreviewClients({role='STUDENT',scenario=role==='ADVISOR'?'assigned':['COORDINATOR','COMMITTEE'].includes(role)?'pending':'draft',delayMs=250}={}) {
  if(['COORDINATOR','COMMITTEE'].includes(role))return selectionPreview(role,scenario);
  const applicationScenario=role==='STUDENT' && Object.hasOwn(APPLICATION_SCENARIOS,scenario);
  const legacyScenario=applicationScenario?'draft':scenario;
  const clients=enhanceWorkflowPreview(createPreviewClients({scenario:legacyScenario,role,delayMs}),{scenario:legacyScenario,role});
  if(role==='STUDENT')clients.applicationClient=createApplicationPreview({scenario:applicationScenario?scenario:'application-pending'});
  return clients;
}
