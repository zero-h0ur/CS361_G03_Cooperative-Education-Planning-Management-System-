// Release/rollback worktrees under tmp are independent source trees, not tests
// belonging to this checkout. Explicit roots also avoid duplicate package names.
module.exports = {
  roots: ['<rootDir>/tests'],
  modulePathIgnorePatterns: ['<rootDir>/tmp/release-candidates/']
};
