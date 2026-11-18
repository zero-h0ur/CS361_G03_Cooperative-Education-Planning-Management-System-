# Pinned teammate input

`pr178-generate-companies.mjs` is the unmodified generator from Purinat's
[PR #178](https://github.com/zero-h0ur/CS361_G03_Cooperative-Education-Planning-Management-System-/pull/178),
commit `88aa0bc4369a4a8099638800c2d691fa3c8f8ebd`, original path
`scripts/loadtest/generate-companies.mjs`, Git blob `8cc5e0c6bead682ece0deca2197c600f408448d7`.
The focused test verifies the original Git blob hash, including bytes/newlines.

B2b consumes its exported dataset (400 synthetic companies, 800 positions) without
running its CLI or generated upsert SQL against RDS. Only the public synthetic
dataset is packaged; private Cognito bindings arrive separately in memory.
This copy avoids merging/overwriting an existing dirty `scripts/loadtest/` tree.
It does not approve running the upstream seed/smoke/stack scripts.

Follow-up: main `03876b6` now includes the original generator at its original
path. Retain this byte-pinned copy to preserve B2b's reviewed input provenance;
integration does not rewrite the historical deployed ZIP or its hashes. LF is
enforced by `.gitattributes` on both paths and the generated SQL. CI checks both
the pinned blob and the upstream generator/SQL contract, without running its SQL.
