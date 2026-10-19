# Student workspace reference alignment

The Student Profile and My Plan pages follow the supplied red/gold reference:
white left navigation, compact right-aligned session bar, warm ivory canvas,
pale campus illustration with diagonal crimson ribbon, pink icon circles,
four-card Plan overview and a connected history timeline.

The explicit product overrides remain: brand name **CO-ED** (not CO-ED TU),
and the existing `resources/images/logomini.png` logo.

## Plan interactions retained

The overview order is status, readiness/details, submit, history.
The status card's “แก้ไขแผน” action opens and focuses the native expandable
management panel after the overview. It contains the existing Plan picker and
complete editor. NEEDS_REVISION opens this panel initially. Empty Plans still
show the create form directly. No API payload, permission, status-transition,
idempotency or concurrency rules are bypassed.

Cycle display names use the existing authenticated Cycle options endpoint;
the actual submitted reference remains the Cycle ID. On temporary lookup
failure the original ID is retained, and authentication failures use the normal
expired/forbidden paths.

## Decorative asset provenance

Path: `resources/images/student-campus-banner.png`.
Generated with the built-in image generation tool, using the supplied screenshot
as a style/composition reference. This is an invented decorative campus, not an
official photograph or a claim of architectural accuracy. The image is hidden
from assistive technologies and never conveys required information.

Final generation prompt:

> Use case: illustration-story. Asset type: production website header background only, NOT a full UI screenshot. The attached image is a composition and style reference: recreate ONLY its pale cream/gold watercolor campus-building background behind the page heading, including the diagonal red ribbon at the far right. Generate a wide landscape banner (roughly 3:1). Left 45 percent is almost blank warm ivory #faf8f5 fading softly into the illustration. On the right half, a delicate low-opacity watercolor Thai university campus with a long cream building with muted terracotta roof and a slim historic tower with a pointed orange roof, soft golden trees, subtle translucent diagonal gold bands. At extreme right a broad diagonal crimson #c8102e ribbon rising to upper-right, matching reference, not dominating the central space. Pale architectural details, airy and restrained, fade the bottom edge to ivory for seamless page blending. No letters, words, text, logos, icons, controls, white cards, sidebar, people, watermark, or UI elements. This is a decorative invented architectural illustration, not a photograph or an exact historic depiction. Preserve the attached reference's gentle cream, gold, peach and crimson colors.

## Review

Use `npm run dev:ui` and the Student routes at localhost:8081.
Test narrow (320px), tablet and desktop layouts, native summary keyboard
activation, Manage button focus, save/submit locks and conflict recovery.
The reference is a visual target, not a pixel-exact screenshot assertion.
