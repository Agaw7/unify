const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('environment template and operational scripts contain no payment provider credentials', () => {
  const template = fs.readFileSync(path.resolve('.env.example'), 'utf8');
  assert.doesNotMatch(template, /PAYMONGO|LIVE_PAYMENTS_ENABLED|LIVE_PAYOUTS_ENABLED|LIVE_REFUNDS_ENABLED/i);
  for (const script of ['check-checkout.cjs', 'reconcile-checkout.cjs', 'scripts/check-live-paymongo.cjs']) {
    assert.equal(fs.existsSync(path.resolve(script)), false, `${script} should be removed`);
  }
});
