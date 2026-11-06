# AI contributor guide

These instructions apply to the repository. Read the source and the newest user request; historical plans are not standing authorization to change AWS.

## Read first

1. [README](README.md): product, roles and development entry points.
2. [Documentation index](docs/README.md): distinguish current guidance, proposals and history.
3. [V4 architecture](docs/architecture/G03-V4-architecture.md) and [decisions](docs/decisions/README.md): contracts and reasons.
4. [Current deployment](docs/operations/current-deployment.md) and [intake verification](docs/operations/student-intake-verification.md): dated AWS evidence and testing limits.
5. [Contributing](CONTRIBUTING.md) and the source/tests for the requested area.

Do not load every historical rollout file by default. Follow the index for the task at hand.

## Find the right files

Read the shared [repository map](docs/repository-map.md) for folder contents, entry points, generated/private files and task-to-source examples. The root README contains only a compact tree; keep detailed folder explanations in that map so human contributors and AI use one reference.

Modify source in `src/` or the tracked root public-page files, not generated `dist/` bundles. Runtime code is separate from `scripts/operations/` operator tools and `scripts/ui-preview/` synthetic previews. SQL in `src/db/migrations/` and `src/db/upgrades/` has different baselines; `data/` contains datasets/fixtures, not a place to export live student records. Update the map when adding/moving a meaningful folder; do not enumerate every generated file or private checkpoint.

## Keep four kinds of status separate

- **Requirement:** intended behavior or approved scope; not proof of implementation.
- **Code:** behavior in a named commit; not proof that AWS runs that commit.
- **Deployment:** version/alias/job/configuration observed at a stated time.
- **Verification:** command, environment, commit and result, including skips and mocked boundaries.

When evidence conflicts, report the difference. Do not assume `main`, a successful build, a ZIP, or a merged PR equals live deployment. Refresh a deployment snapshot only from actual evidence; do not silently replace its date with today's date.

## Product and trust boundaries

- Student uses TU; the assigned Coordinator and Committee use Cognito. Resolve verified identities to internal users; never select another Student, trust a browser role, or auto-link by name/email.
- TU identity verification is not a complete academic record. Self-reported curriculum/major/track/year stays marked pending review. Missing verified grade policy is `UNKNOWN`, not `PASS`.
- Phase 1 applications are separate from legacy company/Project plans. Do not convert legacy plans or browser drafts into successful server submissions.
- Submit succeeds only with committed snapshot/checksum, destination delivery receipt and audit. A queued application is not accepted, forwarded or selected.
- Keep pilot account/round allowlists and deployment-stage gates. Coordinator opening a round cannot bypass them. Do not turn maintenance off to fix a blocked feature.
- Preserve returned-correction deadlines, immutable submission history, ownership/scope checks, versions, operation IDs and transaction/locking behavior.
- Public directory access does not authorize access to positions, student records or private documents. Keep preview fixtures and local tokens out of production bundles.

## Safe working rules

- Inspect `git status` and relevant diff first; preserve unrelated changes. Do not switch/reset branches or overwrite files to obtain a clean tree.
- Implement only the requested scope. Request confirmation before uncertain account linking, data correction, service interruption, audience widening or additional cloud resources/permissions.
- AWS writes, migrations, live probes with side effects and production deployments require explicit approval for that operation. Existing rollout documents and prior approvals are not blanket permission.
- Do not commit, push, create/merge PRs or change review/branch-protection rules unless requested. Keep review approval independent of CI success.
- Never commit/log passwords, API keys, tokens, signing material, private documents, real student profiles or private pilot UUID bindings. Use synthetic fixtures and sanitized summaries. Do not ask users to send passwords in chat.
- `tmp/`, release artifacts and operational checkpoints may be ignored/local-only. Do not publish their contents or assume a teammate has them; see deployment handoff requirements.

## Database and release rules

- Never run test/reset/seed/general `migrate` commands against RDS or a database with retained data.
- Fresh/workspace migrations and observed-schema upgrades are different lineages. Read the architecture before touching either.
- Historical SQL bytes and recorded checksums are immutable. Add a reviewed forward migration; do not rewrite history to pass a gate or invent the missing original production SQL.
- Runtime roles are not migration owners. Do not broaden permanent grants or disable constraints/audit to make a test pass.
- Packaging does not apply SQL or authorize deployment. Bind source, configuration and artifact hashes; verify compatibility and rollback before any approved release.

## Validation by change type

Use Node.js 22 and `npm ci`. On PowerShell use `npm.cmd` if `npm.ps1` is blocked. Inspect [package scripts](package.json) and the [CI workflow](.github/workflows/v4-verification.yml) for exact commands.

| Changed area | Checks to select |
| --- | --- |
| Markdown/links only | `npm run test:docs`, `git diff --check` |
| JavaScript | `npm run lint` plus relevant focused suite |
| TU identity/transport | `npm run test:tu-auth`; registration/split-auth database tests as relevant |
| Application/intake/control | `npm run test:student-intake`, `npm run test:application`, `npm run test:coordinator`, `npm run test:phase1-schedule` |
| Shared frontend | `npm run test:frontend`, `npm run test:ui-preview`; rendered Desktop/Mobile QA when relevant |
| SQL/release packaging | `npm run verify:migrations`, `npm run test:release`, observed-upgrade checks for that lineage |
| Cross-cutting runtime | Full `npm test` with the workflow's dedicated disposable database variables, plus affected checks above |

DB suites can reset fixtures and require separate loopback databases. Intake requires `STUDENT_INTAKE_TEST_DATABASE_URL` pointing to `coed_intake_test`, `NODE_ENV=test` and `INTAKE_DISPOSABLE=true`. Do not substitute RDS or weaken a name/reset guard. The local wrapper does not set every new suite's DB variable; follow [verification setup and limits](docs/operations/student-intake-verification.md), not an assumption that `test:local` covers all integration tests.

Do not count skipped tests as passed, mocked Gateway claims as genuine Cognito authentication, DOM tests as rendered visual QA, or local storage as live S3 acceptance. Report what ran **this turn** separately from prior evidence. Documentation-only work does not require a new AWS inspection.

## Documentation maintenance

Keep the root README short and link details through `docs/README.md`. Update architecture for structural changes, decisions for changed reasoning, deployment only after observed release changes, and verification with reproducible evidence/limits. Label superseded proposals and V2/V3 snapshots; retain their original evidence. Never use an old proposal as an executable deployment instruction.
