const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Run the ESM checksum gate in Node, not Jest's CommonJS VM. Use the same
// reviewed names and exact-byte checksums as release preparation on Node 20+.
function readReviewedMigrationRows() {
  const script = path.join(__dirname, '..', '..', 'scripts', 'operations', 'reviewed-migrations.mjs');
  const { migrations } = JSON.parse(execFileSync(process.execPath, [script], {
    encoding: 'utf8',
    windowsHide: true,
  }));
  return migrations.map(({ name, checksum }) => ({ version: name, checksum }));
}

module.exports = { readReviewedMigrationRows };
