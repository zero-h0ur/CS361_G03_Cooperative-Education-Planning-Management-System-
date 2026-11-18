// Synthetic provider keys only; never replace with the private operator handoff.
import { ISSUER } from '../../scripts/loadtest/b2b-import.mjs';

export const syntheticBindings = () => ({
  issuer: ISSUER,
  accounts: Array.from({ length: 10 }, (_, i) => ({
    alias: `loadtest${String(i + 1).padStart(2, '0')}`,
    subject: `99000000-0000-70a5-${String(i + 1).padStart(4, '0')}-000000000001`
  }))
});
