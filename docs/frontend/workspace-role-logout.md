# Workspace branding, role navigation and logout fixes

## Why this change

The former public `navbar-auth.js` inferred role from decoded ID-token claims and
defaulted missing/unknown values to STUDENT. The protected shell correctly used
`GET /api/v3/me`, so a Staff account could see a Student badge and links in Public
navigation, then receive access denied on the actual Student route. That denial
was correct; the navigation role source was wrong.

Public logout only cleared sessionStorage and reloaded. It did not close the
Cognito-hosted browser session. The shell also cleared tokens before passing
control to SDK sign-out, removing information needed by the SDK.

## Branding and campus artwork

- Student/Staff use `.protected-shell--campus`; Advisor layout remains separate.
- The logo uses the same 44px framed mark, 28px image, compact CO-ED wordmark and
  hover/focus rotation as the public header. Reduced motion disables the transform.
- The existing campus image uses its natural aspect ratio, not a cropped cover.
  Horizontal/vertical gradient masks fade the edges. Artwork is limited to 480px
  at the right; the heading has a compact 96px minimum instead of a 340px hero gap.
  Long headings/descriptions can grow naturally. Data cards remain opaque/readable.
- `resources/images/logomini.png` and the existing generated campus asset are reused.
  No new architectural image, logo, external asset or image-generation step is added.

## One authoritative role source

The public Navbar now bundles the same Amplify adapter and `/me` client as the
shell. Until verification finishes, it stays anonymous. Missing configuration,
expired/unavailable API, unsupported role or malformed response never falls back
to STUDENT. Public page content stays available without login.

| Verified role | Dashboard | Secondary link |
| --- | --- | --- |
| STUDENT | `#/student/profile` | `#/student/plan` |
| STAFF | `#/staff/students` | `#/staff/plans` |
| ADVISOR | `#/advisor/students` | None |

Name/email are optional presentation fields from the SDK session only, not role
or permission inputs. They are rendered with textContent, never injected HTML.
All endpoints still enforce server-side role, ownership, scope and capabilities.

`navbar-auth.js` is now a source module bundled by `npm run build`; serve `dist`,
not an unbuilt repository root. Original Public page scripts remain unbundled.
All four Public pages load runtime-config before Navbar initialization.

## Logout and local cleanup

Both Navbar and shell invoke the same auth adapter:

1. Remove private identity/route UI and abort active requests immediately.
2. Block new token reads from the current client instance.
3. Let the SDK perform **client/session sign-out** (`signOut()`) while tokens are
   still present. For a revocation-enabled session (`origin_jti`), the installed
   SDK sends `RevokeToken` with this client's refresh token before local removal.
   Do not use `global: true`: `GlobalSignOut` needs
   `aws.cognito.signin.user.admin`, which this public client's scopes intentionally
   exclude. This is not an all-device logout operation.
4. Clear local SDK tokens and authentication keys from both localStorage and sessionStorage:
   - `CognitoIdentityServiceProvider.<configured-client-id>.*`
   - Legacy `co-ed:session`, `co-ed:return-route`, `amplify-signin-with-hostedUI`
5. Notify other tabs and navigate to the configured Cognito `/logout` endpoint,
   including when old OAuth metadata is absent or SDK sign-out fails.

Other client IDs, theme settings, directory favorites and unrelated storage are
not erased. A persistent `co-ed:auth-logout` random nonce is retained solely to let
a suspended/BFCache tab detect a missed logout; it contains no user ID, token or PII.
Restored pages revalidate Session before rendering protected content. Aborted
requests cannot repopulate private UI even if a transport ignores cancellation.

Explicit sign-in requests `prompt: LOGIN`. Cognito Hosted UI logout is necessary
because JavaScript cannot delete Cognito-domain cookies. Browser password managers
may still autofill saved credentials; do not disable accessible autofill/paste.
External social/OIDC IdP sessions are separate and are not logged out by this change.

If redirect/local cleanup fails, private UI remains removed and a retry is offered;
do not report provider logout as verified. SDK refresh-token revocation remains
best-effort on network/service failure: the installed SDK catches a rejected
`RevokeToken` request and continues cleanup. A resolved `logout()` promise or a
successful redirect alone therefore does **not** prove remote revocation.
Token revocation must be enabled for the client and a fresh session must carry
`origin_jti`; a legacy session without it is not evidence of revocation support.
Other same-origin tabs clear local access through the existing nonce, but no
claim is made that this revokes separately issued sessions on other devices.
Offline JWT validators can accept an
already-issued token until expiration: this frontend change is not immediate
server-side revocation or a new backend authorization control.

AWS references:

- https://docs.aws.amazon.com/cognito/latest/developerguide/logout-endpoint.html
- https://docs.aws.amazon.com/cognito-user-identity-pools/latest/APIReference/API_RevokeToken.html
- https://docs.aws.amazon.com/cognito/latest/developerguide/token-revocation.html

## Verification

```powershell
npm.cmd ci
npm.cmd run test:frontend
npm.cmd run test:ui-preview
npm.cmd run build
git diff --check
```

Automated tests cover verified-role links, unknown/401/403/503 states, unsafe name
strings, menu keyboard behavior, stale async responses, scoped storage cleanup,
SDK failures, Hosted UI logout URL, fresh-login options, BFCache and cross-tab
invalidation. Most UI tests mock SDK/network dependencies.
`tests/auth-client-revocation.test.js` instead uses the lockfile-installed SDK and
the actual auth adapter, replacing only HTTP with synthetic responses. It checks
the exact `RevokeToken` target/client/body, order before token removal, lack of an
admin-scope requirement, duplicate calls, service rejection, an empty session and
a legacy non-revocable session. It makes no AWS calls and is not deployed proof.

For local visual review:

```powershell
npm.cmd run dev:ui
```

- Student: http://localhost:8081/app.html#/student/profile
- Plan: http://localhost:8081/app.html#/student/plan
- Staff: http://localhost:8081/app.html?role=STAFF#/staff/students

Check 320/768/1366px, logo hover/focus/reduced motion, full campus artwork with
faded boundaries, no horizontal overflow, and readable cards.
Preview remains synthetic and cannot verify Cognito logout or actual permissions.

### Real Cognito/API review (test environment owner)

1. Build with the existing public Cognito/API configuration and a matching origin.
   The callback/sign-out URLs must already be allowed for the Cognito client.
   No IAM key, production secret or AWS configuration mutation is needed for this PR.
2. Sign in with a synthetic Staff account; visit each Public page and verify the
   Staff badge and dashboard/secondary links target Staff routes. Repeat with Student
   and Advisor to verify role separation.
3. Logout once from a Public dropdown and once from a protected route. Observe a
   successful `RevokeToken` request followed by Cognito-domain `/logout` navigation
   then the configured sign-out page. Inspect status/operation names locally only;
   never export a HAR, copy request bodies or publish token-bearing screenshots.
4. Confirm auth tokens/legacy session keys for this client are gone from both stores,
   while a harmless test preference remains. Never paste tokens, names/emails or raw
   storage screenshots into a public PR.
5. Click Login: verify fresh interactive native Cognito authentication rather than
   silently resuming the previous Hosted UI session. Saved browser autofill is separate.
6. Open two tabs, logout in one, then restore the other or use Back/Refresh. Private
   content must not reappear without Session verification.
7. Simulate failed `/me`/network/redirect: no Student fallback, no automatic login
   loop, no protected success UI and a visible recovery path where appropriate.

Browser visual review and real Cognito/API testing must be recorded separately
from automated test results; do not mark them passed solely because the suites pass.
