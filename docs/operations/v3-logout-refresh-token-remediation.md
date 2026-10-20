# V3 logout refresh-token remediation (#84 / Decision #48)

## Scope and cause

The post-PR-126 adapter called `signOut({ global: true })`, but the configured
public OAuth scopes are `openid email coed-api/access`. Cognito `GlobalSignOut`
requires `aws.cognito.signin.user.admin`. In the lockfile-installed Amplify Auth
6.21.2, the global branch catches the resulting service error and does not fall
back to `RevokeToken`. Thus a clean-looking local logout did not establish the
refresh-token revocation required by Decision #48. No stolen-token reuse or
credential disclosure was demonstrated by this source/config review.

The adapter now calls the supported **current-session** `signOut()` path. The SDK
uses `RevokeToken` for a session with `origin_jti`, before removing local tokens.
There is no new OAuth scope, IAM permission, dependency, backend endpoint, schema,
AWS configuration change or deployment in this patch.

Existing scoped storage cleanup, same-origin cross-tab/BFCache invalidation,
pending-response guards and explicit Hosted UI logout are preserved. Other
devices and independently issued sessions are not promised a global logout.

## Limits that must remain explicit

- The Cognito client must have token revocation enabled. Use a fresh synthetic
  login; a legacy token without `origin_jti` makes the SDK skip revocation.
- The SDK swallows `RevokeToken` network/service errors and still clears local
  state. A resolved promise, empty storage or a login redirect is not remote
  revocation evidence. A fresh attempt with a new session is needed for live
  acceptance after a failed/ambiguous revoke; do not call it PASS.
- Cognito Hosted UI logout closes its browser cookie; it is separate from refresh
  revocation. External identity-provider sessions are also separate.
- As explicitly accepted in #48, an already-issued JWT can still pass API
  signature/expiry checks until its expiration (at most 60 minutes). Protected
  requests still check internal account status/permissions. This patch adds no
  immediate access-token denylist or all-device revocation mechanism.
- The owner-waived genuine-expiry wait in #83 remains SKIPPED, not PASS.

## Automated verification

`npm run test:frontend` includes both adapter tests with SDK mocks and
`tests/auth-client-revocation.test.js`, which runs the actual installed Amplify
SDK against a replaced HTTP boundary. All credentials are synthetic, no requests
reach AWS, and the tests require no account credentials.

The real-SDK tests cover:

1. Exact `RevokeToken` operation, client and fake refresh token, before cleanup,
   with scopes that do not include the GlobalSignOut admin scope.
2. Concurrent calls share one revocation operation.
3. Service rejection still closes local access, without treating SDK resolution
   as proof that remote revocation succeeded.
4. No stored session still reaches explicit Hosted UI logout.
5. A legacy session without revocation metadata is not remote-revocation proof.

### Local result (2026-10-20)

Working branch: `fix/84-refresh-token-logout`, based on main
`dea7648698fc1ac49be561cbb2ab57e8d8d5172e`. The patch is not committed/deployed.

- Full `npm test`: **885 passed** (845 Jest + 40 Node TAP); frontend subset:
  **305 passed** in 13 suites. PostgreSQL integration used a new disposable
  localhost-only Docker database; RDS and pre-existing databases were not used.
- UI preview: **24 Jest + 2 Node TAP passed**. The loopback server initially
  encountered sandbox `listen EPERM`; it passed on the permission-enabled rerun.
- Production frontend build with the strict configuration guard and synthetic
  public configuration: **passed**. This is a local build, not an Amplify deploy.
- `git diff --check`: **passed**.

## Deployed acceptance still required

Local tests do not close #84. After the reviewed patch is merged and its normal
Amplify build succeeds, bind the deployed JS to that candidate and record:

- Fresh synthetic Student, Staff and Advisor login on main; no real university
  personal data or production account mutation.
- Logout from both Public navbar and protected shell. In browser network tools,
  check `RevokeToken` succeeds **before** leaving for Cognito `/logout`.
  Record only operation name/status/time, never request bodies, HAR files,
  tokens, cookies, profile claims or raw storage screenshots.
- The test session's old refresh token cannot obtain new tokens after logout.
  If this is automated, use an owner-reviewed helper with a hidden prompt,
  memory-only tokens and redacted results; do not paste tokens into chat, shell
  arguments, files or PRs. This check does not require a one-hour expiry wait.
- Other same-origin tabs remove private UI and require a new login after logout,
  including Back/Refresh/BFCache restore. Harmless preferences remain intact.
- Record any network/service failure as unverified remote revocation. Do not
  broaden OAuth scopes or claim all-device logout to make the result pass.

No live revoke/reuse check has been performed by this patch. Remaining #84
operational, privacy and release acceptance gates are separate.

## References

- [Accepted Decision #48](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/issues/48)
- [Amplify sign-out](https://docs.amplify.aws/react/frontend/auth/sign-out/)
- [Cognito RevokeToken](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_RevokeToken.html)
- [Cognito GlobalSignOut scope](https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_GlobalSignOut.html)
- [Cognito token revocation limits](https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html)
