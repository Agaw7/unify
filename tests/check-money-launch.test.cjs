const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('launch check reports automated processing disabled without requiring payment credentials', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'unify-launch-check-'));
  const envFile = path.join(directory, '.env');
  const script = path.resolve('scripts/check-money-launch.cjs');
  try {
    fs.writeFileSync(envFile, [
      'NEXT_PUBLIC_SUPABASE_URL=https://project.example',
      'SUPABASE_SERVICE_ROLE_KEY=placeholder',
      'NEXT_PUBLIC_APP_URL=https://unify.example',
      'CRON_SECRET=01234567890123456789012345678901',
    ].join('\n'));
    const result = spawnSync(process.execPath, [script, '--env', envFile], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Automated deposits and payouts: DISABLED/);
    assert.doesNotMatch(result.stdout, /PayMongo|PAYMONGO/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
