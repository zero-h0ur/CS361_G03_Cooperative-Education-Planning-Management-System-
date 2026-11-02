# Application UI ownership

| Capability | Owner | Source of truth | Verification |
| --- | --- | --- | --- |
| Shell/navigation | shell-app.js, Student workspace presentation | role allowlist in routes.js | authenticated-shell tests |
| Select/Listbox | native select | option value and server cohort scope | committee-ui tests, browser Preview |
| Table Selection | Committee workspace selected Set | server validates accepted applicant ids | committee-ui, committee-workspace DB tests |
| Form | native labeled controls and command adapter | committee-workspace-domain.js | domain validation tests |
| Date | stored timestamps, Thai presentation | server UTC timestamps | no client date input in this feature |
| Scrollbar | authenticated shell, Committee stylesheet boundary | CSS styles.js | narrow viewport check |
| Toast | workspace live status | awaited server response | retry UI test |
| CRUD | committee API + operation receipt | PostgreSQL transaction, version, scope, operation id | committee-workspace DB test |

Committee: any member proposes; exactly one pending proposal; proposer cannot vote; both other members accept; rejection permits a new proposal. An accepted capacity enables explicit finalization. Coordinator owns publication. Preserve a failed command's operation id when retrying an uncertain network result. Refresh on conflict; do not silently overwrite. Synthetic data stays in scripts/ui-preview.
