# Simulated deposit referral commissions

Apply migrations 07 and 08 for signup attribution and test deposit commissions.
New registrations send `referral_code` in signup metadata. The profile-insert
trigger validates the code and records one direct relationship in `team_members`.
An existing account cannot change its inviter by editing its auth metadata.

Migration 10 adds unique six-character `short_invite_code` values for existing
and new profiles. New links use these short codes. Original `invite_code` values
remain valid; `resolve_invite_code` translates an old link to its display code
without returning a profile or contact information. Registration displays the
code below Confirm Password. Do not truncate the original code to six characters.

Migration 08 awards L1 30%, L2 2%, and L3 1% when a `payment_transactions`
PayMongo/PHP deposit changes to completed with a matching `deposit_credit` in
`wallet_ledger`. Pending checkouts and deposits without that verification record
earn nothing. Rates apply to the full verified deposit; each commission is rounded
down to the nearest centavo. Cycles stop traversal, which never exceeds 3 ancestors.

The immutable commission record has unique deposit/beneficiary and deposit/level
keys. It is inserted in the same transaction as the simulated wallet credit.
Retries cannot credit twice, and a failed credit rolls back the completion update.
Authenticated users can read their own commission rows, but cannot insert, change,
or delete them. `my_sandbox_team()` returns only the current user's subtree and
totals, with the newest 100 members per level. Migration 09 adds the last four
phone digits and each member's total completed test deposits backed by matching
deposit-credit ledger entries. Full phone numbers and live PHP records are never
returned. Pending, cancelled, and unverified deposits are excluded.
Migration 11 adds `earned_commission` per member, summing commission ledger rows
for the current caller and that depositor. It includes only actual credited
commissions, so older deposits without commission awards do not inflate the total.

Commission credits go only into `sandbox_wallets.remaining_balance`. They can be
used in the existing simulated purchases and withdrawals. They never credit the
real PHP `money_wallets` balance. This feature does not implement real-money
commissions or a real payout. It applies to payment confirmations after migration
installation; previously completed deposits are not backfilled.

Tests: `node --test tests/referral-signup.test.cjs tests/sandbox-commissions.test.cjs`
