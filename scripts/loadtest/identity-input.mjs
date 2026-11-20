// Cognito subjects are opaque provider identifiers, not internal RFC UUIDs.
// This tool accepts only the exact bounded UUID-shaped test handoff, without
// imposing UUID version/variant bits or normalizing the supplied value.
export function validTestSubject(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
}
