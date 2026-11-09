# UNIFY manual review v1

This procedure configures application review controls; it does not represent PayMongo approval or a legal compliance determination.

## Member submission

Support must establish a private channel and its evidence retention/access rules before requesting identity documents. The application does not upload or store identity documents. Never request passwords, OTPs, or wallet PINs. Give the member a case reference after receiving evidence through that channel. A made-up reference is not evidence.

The member opens `/money`, selects account identity or a saved recipient, enters the case reference, and confirms the declaration. The API binds the request to the signed-in user and checks recipient ownership in the database. Pending/current approved requests cannot be duplicated. Rejected or expired cases may be resubmitted with support.

## Administrator decision

Use `/admin/money` after MFA. The reviewing administrator must differ from the subject member. Check evidence against the actual person and, for ownership, the exact recipient account in the recipient submissions section. Record the reviewed institution BIC for ownership approval. Do not infer ownership merely from a matching typed name or phone number.

Select the request, enter `UNIFY manual review v1` as the process, and provide a member-visible result with a case reference in Evidence / case reference. Record no private ID numbers in that field. Approvals require confirmation of an actual evidence check and a future expiry within one year. Reject insufficient/mismatched evidence and explain what support needs. Revoke approval if evidence becomes invalid.

`VERIFICATION_REVIEW_ENABLED=true` permits these decisions. Existing database functions enforce independent administration and append immutable audit decisions. Member history shows current decisions; administrator audit history preserves earlier decisions. Identity approval does not settle deposits, verify recipients automatically, or initiate transfers.

## Payment readiness

After migration 16, QRPh deposits do not require identity approval. Payment confirmation is automatic after verified provider confirmation; account restrictions still apply. Identity and recipient ownership approval are required only for withdrawals. Settlement evidence, available real funds, payout source configuration, and independent payout approval/submission are separate requirements. Test balances are never converted into real funds.

## Live withdrawal modes

Migration 17 defaults to Admin Approval. An MFA-verified administrator can change the mode with an audited reason in Live withdrawal settings. Only new requests inherit the selected mode; pending requests keep their snapshot. Automatic requests claim exactly once before the PayMongo call. Unknown results remain processing for provider reconciliation, never automatic resubmission. Manual requests retain independent review and payout submission. Both modes require current identity and recipient approval, account eligibility, settled available real funds and live source configuration. Changing modes itself sends no money.
