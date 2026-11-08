---
version: alpha
name: CO-ED
description: Thai cooperative education workspace
colors:
  primary: '#b61732'
  primary-dark: '#941329'
  burgundy: '#77192d'
  ink: '#192230'
  muted: '#536174'
  canvas: '#f3f5f7'
  border: '#dce2e9'
typography:
  sans:
    fontFamily: 'Prompt, Inter, sans-serif'
  mono:
    fontFamily: 'Inter, sans-serif'
rounded:
  DEFAULT: '8px'
  sm: '6px'
spacing:
  page-max: '1440px'
  section-gap: '22px'
components:
  button: {}
  card: {}
  dialog: {}
---
# CO-ED Design System

## Overview
### Creative North Star
Thai university admissions desk: an orderly roster beneath the existing watercolor campus banner, with burgundy reserved for the current decision.
### Product context and register
Thai university students, coordinators and committees use the same institutional theme. Product UI, Thai language, desktop review with mobile access. Avoid marketing hero cards, gradients and ornamental dashboards.
This file documents existing runtime values rather than generating them. Student tokens belong to `src/frontend/student/workspace.css`; Committee uses those approved values through `src/frontend/committee/styles.js` inside a Shadow Root so Coordinator styles remain isolated. Shell navigation, account/logout and branding belong to `shell-app.js` and workspace presentation primitives.

## Colors
Primary actions use primary; burgundy identifies the current capacity proposal. Green means accepted, amber means pending or tied. Always include a text label with state colors.

## Typography
Prompt supports Thai labels and prose; Inter aligns grades and identifiers. Numeric grades use tabular figures. Empty grades show a dash, never zero.

## Layout
1440px maximum content width; two-column review on desktop, single column below 920px. Below 600px roster rows become cards. Keep pending decisions above the mobile roster.

## Elevation & Depth
White panels and thin borders on the shared gray canvas. Modal backdrop dims the page. No decorative blur; drawers preserve the roster context.

## Shapes
Panels use 8px corners; inputs and actions use 6px. Circular member markers identify committee positions rather than outcomes.

## Components
Native selects and checkboxes preserve keyboard behavior. Native HTML dialog owns modal focus and Escape. Actions remain disabled while a command is pending. Loading, error/retry, no-results and permission expiry are explicit states. Search has a clear action that restores input focus. The final action has a review dialog; counts alone do not publish results.

Coordinator academic review reuses the existing field, feedback and confirmation dialog helpers. Keep the unconfirmed calculation, saved review and original submission provenance visibly distinct. Six evidence checks require deliberate input; saved checks/notes are read-only. Missing approved criteria explains the disabled confirmation/forward actions. Committee handoff displays a read-only stage label and disables decision controls until the server permits them. No new palette or competing review page is introduced.

Student academic entry keeps the same native labeled selects, course sections and stepper. A fixed program course and highest-grade-only entry are business variants, not a new visual system. Show the C minimum and three-credit rule as help text; keep old submitted evidence readable in its original form.

## Motion
Respect reduced motion. Avoid entrance animation around dense review data.

## Accessibility
Visible focus, localized labels, live status and alert regions. Do not replace missing grades with fabricated scores. Keep actor identity and permissions on the server.
