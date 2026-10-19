# V3 main authenticated frontend rollout — #82

## Status and scope

Rollout started on 2026-10-19 (Asia/Bangkok) from reviewed main commit
`8805f1d70a81649ba7e74ead989e174d38119180`, after PR #118 merged and #81 closed.
All #82 implementation/test dependencies were checked closed before deployment.
This rollout retains the already migrated RDS and healthy secret-mode V3 API.
It does not reapply migrations, seed/reset data, rotate credentials, modify IAM,
open database networking, or add IaC/performance infrastructure.

Main URL: `https://main.d1d9qrqnsi5nl6.amplifyapp.com/`
Protected entry: `/app.html`.

**Job 51 deployment, main Student/Staff login/logout and DB gates verified:** on 2026-10-20
(Asia/Bangkok), the owner ran `coed-main82.py --check 51` and reported main Amplify
Job 51 SUCCEED, with BUILD, DEPLOY and VERIFY all SUCCEED. The check also confirmed
the intended main runtime config, reviewed JS/CSS hashes and public/API/CORS smoke.
The owner also confirmed successful live main Student/Staff login, the displayed
read paths and logout/reopen requiring login for both accounts. The fresh read-only
DB verification subsequently passed 13/13, including the exact migration checksum.
The strict-build source/documentation changes still need PR checks, review and
merge. Full workflow/overall release acceptance remains separate in #83/#84.

Main subsequently advanced to `9f2443a00b3d52c16961e7b1bf58bd10cc5ba7c4`
through UI PR #120. The Job 51 hashes and owner screenshots below identify the
earlier verified artifact; they are not evidence that the newer UI artifact was
deployed or accepted. Preserve PR #120 when integrating this ops-only change, and
verify the resulting deployment separately rather than spoofing source metadata
or manually starting another Job 51 replacement.

Read-only recheck on 2026-10-20 (Asia/Bangkok), without starting another deploy:
homepage, protected entry, Directory and runtime config returned HTTP 200; hosted
protected JS/CSS still matched both reviewed hashes below. Runtime configuration
had the exact main sign-in/sign-out URLs, intended API and required access scope.
Health and public companies returned 200, anonymous `/api/v3/me` returned 401, and
main CORS preflight returned 204 with the exact origin and Authorization allowed.
The guarded operator helper's isolated mock tests were rerun: 10/10 passed.
The owner's final Job 51 check is recorded below; neither these HTTP reads nor
that job status substitutes for live authenticated acceptance. Strict-build source
changes remain uncommitted locally.

### Owner-supplied authenticated UI evidence

On 2026-10-20 the owner supplied two screenshots during main smoke verification:

- `Screenshot 2569-10-20 at 02.17.08.png`: visible main-origin Student Profile
  route, Student session/menu and synthetic student profile loaded successfully.
- `Screenshot 2569-10-20 at 02.15.09.png`: Staff Plan detail rendered for the
  synthetic student, with a DRAFT plan in a closed round. The cropped screenshot
  does not expose its origin; the owner subsequently confirmed it was on main.
  A readable detail is not proof of review mutation.

`Screenshot 2569-10-20 at 02.19.16.png` subsequently shows a fresh Sign in form
during the logout/reopen check. This is supporting evidence for the attempted
session; its cropped view does not identify the account or app origin. The owner
explicitly confirmed that both Student and Staff completed this flow on main and
reopening `app.html` after logout required login again. This closes the main
login/logout smoke gate, supported by owner confirmation as well as the images.
No submit, start-review or approval result is inferred from these screenshots;
the closed round is not changed as part of this verification.

## Preflight and recovery points

Owner ran `coed-main82.py` after verifying operator-file SHA-256:
`2d7785b38fa0f06ec269d3709debdc64e4deb2ac216d0f27d4fc8e3fc981c36c`.
The helper's isolated mock tests passed 10 cases, including guards against active
builds, an unexpected Lambda artifact, password URLs, frontend secret keys,
missing JWT scope, unknown client settings and unsafe HEAD-metadata attribution.

Preflight succeeded before any production frontend configuration changed:

- Exact AWS account `676101350279`, region `us-east-1`, connected repository,
  static Amplify app `d1d9qrqnsi5nl6` and PRODUCTION branch `main`.
- Snapshot `coed-before-v3-20261019` belongs to `coed-postgres` and is available.
  This is the pre-migration recovery point, not a claim of a new post-fixture backup.
- Lambda `coed-api` Active / LastUpdateStatus Successful, Node.js 22,
  `src/lambda.handler`, expected secret-mode artifact CodeSha256
  `jw6Koutmpa3kvfYUIr5nQG0bTQw3bpfkIalCB8+/OKI=`.
- Current configuration uses the exact `coed/prod/rds/coed-api` secret ARN,
  `coed_app`, packaged RDS CA and expected issuer/audience, with no DATABASE_URL
  or DB_PASSWORD environment value. No secret content was fetched by the helper.
- All five `/api/v3/{proxy+}` methods use JWT authorizer `wmebsh` and scope
  `coed-api/access`; the original public GET proxy remains unauthenticated.
- Health 200, database-backed public companies 200, anonymous `/api/v3/me` 401,
  and exact main-origin CORS preflight 204 allowing Authorization.

Private CloudShell rollback directory:
`/home/cloudshell-user/coed-main82-backup-eg5l9x18`.
It contains pre-change main branch environment, public Cognito client settings,
CORS settings and a receipt with the previous successful main Job ID/source
metadata. Files are mode 0600 in a 0700 directory; do not commit or post raw
operator backups to GitHub. This helper rejects apparent secret keys on the
frontend before making those backups; no secret value is intentionally backed up.

Healthy **current secret-mode Lambda checkpoint: version 3**. Publishing it did
not update $LATEST code/configuration. Prefer it to version 2 when discussing a
current-runtime recovery point; version 2 predates the secret-mode cutover.
Historical credential-containing versions are not deleted by this rollout.

## Frontend configuration change

Only main branch public build variables were updated, preserving its other
environment entries, stage and auto-build setting:

| Variable | Value |
| --- | --- |
| CO_ED_COGNITO_USER_POOL_ID | us-east-1_WzzG10dCP |
| CO_ED_COGNITO_CLIENT_ID | 3r7a2qjn98v31r1f6vee8ag8e5 |
| CO_ED_COGNITO_DOMAIN | us-east-1wzzg10dcp.auth.us-east-1.amazoncognito.com |
| CO_ED_APP_ORIGIN | https://main.d1d9qrqnsi5nl6.amplifyapp.com |
| CO_ED_API_BASE_URL | https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com |
| CO_ED_REQUIRE_AUTH_CONFIG | 1 |

App client has no client secret and uses authorization-code OAuth. Added only
main callback `/app.html` and logout `/index.html`; existing callbacks/logouts,
default redirect URI, scopes, token settings and preview URLs were preserved.
Allowlist comparisons ignore order but still reject missing/additional entries.
Existing main CORS already passed, so this rollout did not change CORS/routes.

After cloud configuration, this PR enables strict auth configuration directly in
`amplify.yml` so future builds cannot silently deploy an unconfigured protected
entry point. Each newly connected authenticated branch needs its own public
origin/callback settings. No browser code or Lambda package changes are needed.

## Artifact and deployment verification

The RELEASE API may leave commit metadata as `HEAD`; it is not accepted as a
source SHA. Compare actual hosted production bundles with reviewed-source bytes:

| File | Expected SHA-256 |
| --- | --- |
| assets/authenticated-shell.js | 890680a3efcd36ef3bc9a5374ab47e05c895212c3733de6e2503047092deaaea |
| assets/authenticated-shell.css | 1dfaa129f429b3c33e4b5593f716dfba2ca06fbf9338a4885981c1468de47c70 |

Independent reads after Job 51 started returned homepage/app/runtime-config 200,
the exact main callback, all required auth values, and both expected bundle hashes.
The owner completed the final operator check successfully on 2026-10-20:

```sh
# CloudShell normal us-east-1 tab; uses no password/token input.
python3 coed-main82.py --check 51
```

Recorded results: Job 51 and all three steps SUCCEED; homepage, app, Directory,
health and public companies HTTP 200; anonymous `/api/v3/me` HTTP 401; exact main
origin CORS VERIFIED; `MAIN CONFIG AND REVIEWED JS/CSS VERIFIED`. Commit metadata
remained `HEAD`, so source attribution uses the actual matching bundle hashes,
not a claimed commit SHA from that metadata. No additional deploy was started.
The separate authenticated login/logout smoke was subsequently confirmed by the
owner above; this automated check alone does not establish that result.

## Database verification gate

Migration 002 was applied once earlier, with 12/12 checks and preserved V2 row
counts recorded in [secret-runtime evidence](v3-secrets-runtime.md). Do not apply
it again, undo it, or reset fixtures just to collect deployment evidence.

Prepared `coed-db82-readonly.sh` to fetch the existing hash-verified release/CA in
the VPC CloudShell environment, run the 12 existing checks plus an exact immutable
migration checksum check as postgres in one read-only transaction, and require
13/13 passing rows. It uses `sslmode=verify-full` and a hidden password prompt.
No private field values or credentials are printed; only aggregate check results.

The owner attempted the read-only helper on 2026-10-20 after verifying its SHA-256
`041913fd9b4fca1daf4abf2c464cce93cc99e8761d5b3c0dda75daef6647a818`.
Helper, release ZIP, RDS CA and extracted verification SQL hashes all passed.
`pg_isready` then returned `no response` for the private RDS host on TCP 5432.
With `set -e`, the helper stopped before the psql password prompt and before any
verification SQL ran. This is an incomplete connectivity check, not a database
verification failure or a password-authentication failure. First confirm the
operator is in VPC CloudShell `coed-db-viewer`; the transcript alone does not prove
which CloudShell environment ran it. No network rule change or public DB access
was made in response to this result. A subsequent readiness check returned
`accepting connections`, and the owner reran the same hash-verified helper.

The second attempt completed with all 13 checks true:

```text
migration checksum recorded|t|1
btree_gist installed|t|1
required tables present|t|0
required constraints present|t|0
legacy plan backfill valid|t|0
identity and Student references valid|t|0
Plan references valid|t|0
Plan state and version valid|t|0
non-cancelled Plan cardinality valid|t|0
active identity cardinality valid|t|0
active Advisor periods do not overlap|t|0
required protection triggers enabled|t|7
migration checksum matches reviewed release|t|1
DATABASE READ-ONLY VERIFICATION PASSED: 13/13
```

The helper used a single read-only transaction with TLS certificate verification.
No migration, GRANT/REVOKE, password, fixture or table data was changed. The zero
observed values above count missing/invalid records, not empty application tables.
Advisor-period validation checks database invariants only; it is not live Advisor
login/read-scope acceptance. The read-only DB verification gate is satisfied.

## PR source integration and local verification

Branch `ops/82-main-authenticated-rollout` was fast-forwarded to main
`9f2443a00b3d52c16961e7b1bf58bd10cc5ba7c4` after safely preserving the three
pending ops files. PR #120's UI and local-preview changes were retained. The
remaining working diff is only `amplify.yml`, this evidence file and the updated
authenticated-shell configuration documentation; no application, API, SQL or
dependency change is introduced by this ops diff.

Verified locally with Node.js 20.20.2 / npm 10.8.2:

- Frontend regression: 10 suites / 262 tests passed, including Student, Staff,
  Advisor read-only and session/route tests. These tests use injected mocks, not
  live Cognito sessions or a database.
- Strict production build with missing public auth values: rejected as expected
  with `Missing required public auth configuration`.
- Strict production build with the exact main public values: passed; generated
  runtime config has the expected sign-in/sign-out URLs, API and access scope.
- `git diff --check`: passed.

The integrated local production build produced the following hashes. They are
**new UI build expectations**, not replacements for the historical Job 51 record
and not a statement that a new deploy was run:

| File | Local integrated SHA-256 |
| --- | --- |
| assets/authenticated-shell.js | 6d1726f0e12a3175ee4dd7fc941066d3eb4879e51182ae7fbeb51c6f1a2ab596 |
| assets/authenticated-shell.css | 8c0808e1c5f2da718f82e8290e2c060a38112e19dda6231c38a8af98d9f35483 |

`coed-main82.py --check 51` intentionally pins the earlier artifact hashes. Do not
reuse it as a verifier for a different UI release or change its expected hashes
merely to accept an unexplained mismatch. After PR checks/review and merge, verify
the resulting main auto-build and its actual source/artifacts. No additional
manual deployment, commit or push was performed while preparing this evidence.

## Reviewed rollback path (not exercised)

1. Stop additional main merges/deployments and preserve the rollout receipt/job
   results. Keep the known-good authenticated preview #74 available during review.
2. If only frontend configuration is faulty, compare the backed-up main public
   environment, exact Cognito callbacks and current values first. Do not remove
   unrelated/current preview URLs or change Backend/DB permissions to make Login pass.
3. If reverting to the previous frontend release is necessary, restore only the
   reviewed main environment from the private backup, then use Amplify Console
   main deployment history, select the receipt's previous successful deployment
   and **Redeploy this version**. Verify its actual config/artifacts/public pages;
   do not invent commit metadata with a new RELEASE request. A strict-build source
   requires complete auth config, so it must not be combined blindly with the old
   incomplete environment. Review the selected version's build settings first.
4. API code/config is unchanged by this frontend rollout. If an independent API
   regression requires recovery, review checkpoint version 3's code/config before
   any explicit recovery operation; publishing a version alone is not an automatic
   rollback for an API integration that invokes $LATEST.
5. Leave the forward-compatible V3 schema in place for app rollback. RDS snapshot
   restore is a separate controlled recovery into a new instance, with a data-loss
   window review and approved cutover, not a destructive in-place schema downgrade.
6. Repeat public/protected/CORS and authenticated smoke after recovery. No rollback
   was executed or represented as tested during this successful-path rollout yet.

AWS references: [public build variables](https://docs.aws.amazon.com/amplify/latest/userguide/environment-variables.html),
[preserving Cognito client settings](https://docs.aws.amazon.com/boto3/latest/reference/services/cognito-idp/client/update_user_pool_client.html),
[selecting a deployment to redeploy](https://docs.aws.amazon.com/amplify/latest/userguide/custom-build-instance.html).
