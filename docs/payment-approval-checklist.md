# Independent payment approval checklist

- Verify the legal entity and applicable authorization for the exact investment,
  return, referral and promotional model with qualified independent reviewers.
- Obtain written PalawanPay merchant approval for that exact collection purpose.
- Obtain written approval for the business disbursement channel and recipient types.
- Record evidence reference, scope, expiry, reviewer and decision in an append-only
  review entry through a separately reviewed database change. Do not upload passwords,
  PINs, OTPs, personal banking credentials or unnecessary identity documents.
- Establish reconciliation, safeguarding, refunds/reversals, complaints, incident
  response, limits, separation of duties, backup/restore and access-review procedures.
- Review all historical obligations and sources of funded rewards separately from
  customer deposits. Test credits must never be represented as available real funds.
- Design an independently reviewed activation release only after evidence is verified.
  Editing environment flags or adding a review row alone must not activate processing.
- Use a controlled sandbox acceptance test with independent reviewers first. A future
  real payment test must be explicitly authorized and executed by the account owner.

Current state: new real-money execution is blocked in code; no approvals have been
independently verified by this implementation.
