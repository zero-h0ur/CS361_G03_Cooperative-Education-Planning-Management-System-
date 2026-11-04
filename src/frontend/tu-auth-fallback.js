// Transport selection only. API failures must never become browser-only success.
// Preview fixtures and opt-in legacy Draft recovery are separate from this client.
export function createTuAuthClients(options) {
  const selected = (base, tu) => new Proxy({}, {
    get(_target, key) {
      const client = options.isTuAuthActive() ? options[tu] : options[base];
      const value = client?.[key];
      return typeof value === 'function' ? value.bind(client) : value;
    }
  });
  return {
    studentProfileClient: selected('baseStudentProfileClient', 'tuStudentProfileClient'),
    applicationClient: selected('baseApplicationClient', 'tuApplicationClient'),
    workflowClient: selected('baseWorkflowClient', 'tuWorkflowClient'),
    studentPlanClient: selected('baseStudentPlanClient', 'tuStudentPlanClient')
  };
}
