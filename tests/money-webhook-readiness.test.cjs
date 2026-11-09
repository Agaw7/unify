const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [file] : [];
  });
}

test('application source contains no payment-provider credentials, API host, or webhook integration', () => {
  const source = sourceFiles(path.resolve('src'));
  const combined = source.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(combined, /PAYMONGO_|api\.paymongo\.com|checkout\.paymongo\.com|PayMongo/i);
  const retiredRoute = fs.readFileSync(path.resolve('src/app/api/payments/webhooks/paymongo/route.ts'), 'utf8');
  assert.match(retiredRoute, /status:\s*404/);
  assert.doesNotMatch(retiredRoute, /fetch\(|database\(|rpc\(/);
});
