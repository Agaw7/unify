# Funded live plans and commissions

> **Archived:** The processor-backed business-funding checks described below
> have been removed. The current budget page is read-only and shows recorded
> ledger totals, not a live account balance. Do not follow old funding setup
> instructions; see `../README.txt`.

Migration 18 creates new live contracts and a separate business rewards ledger. It does not import old demo balances, investments, registration bonuses, grants, or commissions. The initial business budget is zero. A proposed PHP 10,000 allocation in the UI is not credited automatically.

## Funding

The owner first funds the configured PayMongo source wallet. An MFA-verified administrator opens `/admin/business-budget` and checks the wallet. The server retrieves `/v2/wallets` with `balance` and `account`, requires one matching configured source account, activated status, live mode and PHP currency, and reads integer centavos. An allocation repeats this read and records the actual source snapshot with a unique funding reference and idempotency key.

Allocatable funds exclude all member available/reserved/held balances, existing unallocated and reserved rewards, and accumulated product receipts. A stated budget or payment screenshot cannot credit the ledger. Keep separate cash for provider fees and do not withdraw funds externally that back existing member obligations; the app cannot prevent transfers made outside UNIFY. Source configuration matching and an available balance do not independently verify the origin of a top-up; the administrator attests its business ownership and records its reference.

## Product purchases and free grants

Existing product prices and daily amounts are read from `investment_products`. Each new contract snapshots its name, price, daily amount and the existing 365-day term. The whole daily reward obligation is reserved from the business budget before either purchase or free grant. Purchase receipts are recorded separately and cannot automatically refill rewards. Purchases debit settled available PHP funds. Free grants require an MFA-verified administrator, an existing non-admin member, and at most one welcome grant per member. No member balance is deducted for a free grant.

The first claim unlocks after 24 hours. Claims catch up elapsed unclaimed days, stop after 365 days, and move already-reserved rewards to the member PHP wallet. The existing schedule does not automatically return the plan purchase price at maturity; this is displayed in the purchase terms and acknowledgment. Database locking, per-day claim records and idempotent purchases prevent duplicate credits. Withdrawals retain current verification, recipient and payout-mode controls.

## Referral commissions

L1/L2/L3 rates remain 30%/2%/1%, rounded down to centavos per level. A provider-verified deposit must also be released against actual settlement evidence before commissions are processed. Pending deposits and free grants do not qualify. Commissions are paid from the unallocated business budget without reducing the depositor's principal. Insufficiently funded commissions remain pending and cannot be withdrawn. Funding and scheduled reconciliation retry pending commissions; replayed settlement or jobs cannot pay twice. Cycles and repeated ancestors are excluded.

Refunded/disputed deposits do not create new payable commissions; unpaid ones are cancelled. Previously paid commissions remain a business expense; this implementation does not debit recipients retroactively. Member team views expose only subtree phone suffixes and live deposit/commission totals.

## Operations

Applying the migration or deploying code does not create contracts, fund a budget or send money. The operator must perform the actual top-up and allocation. Product availability is limited by the funded full-term rewards allocation, so PHP 10,000 may not cover every plan or grant. Real payment processing still needs a controlled end-to-end payment and payout test.
