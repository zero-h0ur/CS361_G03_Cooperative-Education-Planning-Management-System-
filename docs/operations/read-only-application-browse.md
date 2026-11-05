# Read-only Student applications and public company directory

## Scope

The November5,2026 owner approval restores actual reads, not business writes.
`COED_API_MAINTENANCE=browse` keeps reviewed session/profile GETs and permits:

- Public GET `/api/directory/companies` with only q/location/page/pageSize filters.
- Public GET `/api/directory/companies/<UUID>` without queries.
- Authenticated TU Student GET `/api/tu-proxy/api/v4/application-options`,
  `/api/tu-proxy/api/v4/applications`, and exact `<UUID>` detail, without queries.

Normal route authentication and canonical ownership still run. Empty own lists
are actual empty results, not mock applications. Unknown academic fields remain
unverified/null. Directory public projections exclude recruitment/contact fields.

All other routes/methods remain blocked, including create/save/upload/submit,
profile updates, download tickets and readiness/selection/administration paths.
The genuine TU login/registration broker and private issuer are unchanged. Do not
use `off` to remove an error message. The frontend shows a read-only explanation,
hides creation/recovery/save/submit/upload controls and disables file downloads.

## Preconditions and local checks

Use a clean committed branch based on merged main, a verified public RDS CA bundle
in `COED_RDS_CA_FILE`, and a paired candidate from `npm run package:v4-candidate`.
Run `npm run test:read-only-browse`, full regression, real synthetic PostgreSQL
owner isolation/pending-onboarding reads, lint/docs/migration and release checks.
Tests must not use production credentials, live account repair or SQL writes.

Set `COED_PREVIOUS_FRONTEND_ZIP` to the retained current registration frontend
artifact. The controller compares its runtime config, JS and CSS against the
actually published assets before retaining a rollback copy. Never print upload
URLs, complete Lambda environments, provider identities, credentials or tickets.

## Bounded rollout

`scripts/operations/read-only-browse.mjs` operates only on existing `coed-api`
and Amplify app `d1bpmj87vmjb96`, branch main, in ap-southeast-2/account130165494095.
It adds no IAM, SQL, Secret, network, Gateway or standing service. Lambda versions
and normal request/build usage remain subject to existing service charges.

Run one mode at a time, inspect the checkpoint/result before proceeding:

```text
node scripts/operations/read-only-browse.mjs prepare <candidate-directory> --approved-read-only
node scripts/operations/read-only-browse.mjs stage <state-path> --approved-read-only
node scripts/operations/read-only-browse.mjs activate <state-path> --approved-read-only
node scripts/operations/read-only-browse.mjs frontend <state-path> --approved-read-only
node scripts/operations/read-only-browse.mjs status <state-path> --approved-read-only
```

Preparation pins existing live API3/hash/verify config, broker5/issuer4, qualified
integrations, Gateway routes/CORS and the rollback frontend. Stage changes only
existing API latest code and the maintenance variable, revision-guards publication,
and invokes the numeric version before routing. Public company reads must be200
with actual nonempty data and privacy projection; anonymous private reads must be401;
all tested writes/unreviewed routes must remain503 COED_MAINTENANCE. Only then is
the live alias updated under its captured revision. Frontend publication is manual
ZIP deployment; status verifies the published bytes and repeats safe public checks.

## Owner acceptance and limitations

The final positive owner check requires fresh private Login by the owner: profile
latest-application and application list/detail should load; writes stay unavailable.
Do not ask for passwords/tokens/screenshots of personal profiles. Anonymous tests
and synthetic DB coverage do not prove a real owner read. The public directory can
be verified without a session. Admission/curriculum/major confirmation, uploads,
application submission and normal review operations remain separate follow-ups.

## Rollback

Do not replay migrations or delete real accounts. Inspect the checkpoint first.
The `rollback` mode revision-guards only this task's live version back to API3
(verify-only); numeric published versions are retained. If this task's frontend
was published, `rollback-frontend` can restore the byte-verified retained ZIP only
after API rollback and only if the current frontend still matches this release.
Poll `status` to verify the rollback's published assets. Stop on concurrent drift;
never force an alias change or overwrite someone else's frontend deployment.
