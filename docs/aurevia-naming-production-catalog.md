# AUREVIA production catalog evidence

Read-only inventory for Supabase project `yjuliuehlgzmpxoetefn`. This export contains schema metadata only.

## buckets

```text
aurevia-test-qr [public=false]
```

## relations

```text
admin_users [r, RLS=t] | daily_team_task_claims [r, RLS=t] | demo_investments [r, RLS=t] | investment_products [r, RLS=t] | manual_qrph_deposits [r, RLS=t] | manual_test_audit [r, RLS=t] | manual_test_ledger [r, RLS=t] | manual_test_requests [r, RLS=t] | manual_test_settings [r, RLS=t] | manual_test_wallets [r, RLS=t] | money_adjustments [r, RLS=t] | money_alerts [r, RLS=t] | money_audit [r, RLS=t] | money_business_budget [r, RLS=t] | money_business_funding [r, RLS=t] | money_business_ledger [r, RLS=t] | money_customers [r, RLS=t] | money_daily_task_claims [r, RLS=t] | money_destinations [r, RLS=t] | money_events [r, RLS=t] | money_gift_codes [r, RLS=t] | money_holds [r, RLS=t] | money_investment_claims [r, RLS=t] | money_investments [r, RLS=t] | money_job_leases [r, RLS=t] | money_ledger [r, RLS=t] | money_promo_claims [r, RLS=t] | money_referral_commissions [r, RLS=t] | money_registration_bonus_queue [r, RLS=t] | money_registration_bonuses [r, RLS=t] | money_settings [r, RLS=t] | money_transactions [r, RLS=t] | money_treasury_accounts [r, RLS=t] | money_treasury_entries [r, RLS=t] | money_verifications [r, RLS=t] | money_wallets [r, RLS=t] | payment_accounts [r, RLS=t] | payment_readiness_reviews [r, RLS=t] | payment_transactions [r, RLS=t] | profiles [r, RLS=t] | sandbox_bonus_ledger [r, RLS=t] | sandbox_deposit_balances [r, RLS=t] | sandbox_earnings_ledger [r, RLS=t] | sandbox_free_plan_grants [r, RLS=t] | sandbox_referral_commissions [r, RLS=t] | sandbox_wallets [r, RLS=t] | sandbox_withdrawal_mode_audit [r, RLS=t] | sandbox_withdrawal_payouts [r, RLS=t] | sandbox_withdrawal_requests [r, RLS=t] | sandbox_withdrawal_settings [r, RLS=t] | simulation_daily_credits [r, RLS=t] | simulation_wallets [r, RLS=t] | team_members [r, RLS=t] | unify_sandbox_transactions [r, RLS=t] | unify_sandbox_wallets [r, RLS=t] | wallet_accounts [r, RLS=t] | wallet_ledger [r, RLS=t] | webhook_events [r, RLS=t] | withdrawal_payout_confirmations [r, RLS=t] | withdrawal_requests [r, RLS=t]
```

## routines

```text
claim_simulation_days(uuid) [plpgsql] | complete_sandbox_withdrawal(uuid,uuid) [plpgsql] | credit_sandbox_referral_commissions() [plpgsql] | credit_sandbox_registration_bonus(uuid) [plpgsql] | get_daily_team_tasks() [sql] | grant_sandbox_free_plan(uuid,uuid,uuid,uuid,text) [plpgsql] | handle_sandbox_bonus_auth() [plpgsql] | handle_sandbox_bonus_profile() [plpgsql] | manual_test_admin_overview(uuid,text,integer) [plpgsql] | manual_test_review(uuid,uuid,text,text,text,boolean) [plpgsql] | manual_test_submit(uuid,uuid,text,bigint,text,text,text,text) [plpgsql] | my_sandbox_team() [plpgsql] | purchase_demo_investment(uuid,numeric) [plpgsql] | reconcile_verified_sandbox_deposit(uuid,text,bigint) [plpgsql] | reject_sandbox_withdrawal(uuid,uuid,text) [plpgsql] | request_configured_sandbox_withdrawal(uuid,numeric,uuid,uuid,boolean) [plpgsql] | request_sandbox_deposit(numeric) [plpgsql] | request_sandbox_withdrawal(numeric,uuid,uuid) [plpgsql] | set_sandbox_withdrawal_mode(uuid,text,integer) [plpgsql] | unify_sandbox_transfer(text,bigint) [plpgsql]
```

## columns

```text
demo_investments.acquisition_type text
demo_investments.amount numeric
demo_investments.created_at timestamp with time zone
demo_investments.daily_income numeric
demo_investments.id uuid
demo_investments.product_id uuid
demo_investments.user_id uuid
sandbox_free_plan_grants.created_at timestamp with time zone
sandbox_free_plan_grants.granted_by uuid
sandbox_free_plan_grants.id uuid
sandbox_free_plan_grants.idempotency_key uuid
sandbox_free_plan_grants.investment_id uuid
sandbox_free_plan_grants.note text
sandbox_free_plan_grants.product_id uuid
sandbox_free_plan_grants.user_id uuid
sandbox_wallets.created_at timestamp with time zone
sandbox_wallets.currency text
sandbox_wallets.remaining_balance numeric
sandbox_wallets.user_id uuid
unify_sandbox_transactions.amount_centavos bigint
unify_sandbox_transactions.balance_after_centavos bigint
unify_sandbox_transactions.created_at timestamp with time zone
unify_sandbox_transactions.id uuid
unify_sandbox_transactions.transaction_type text
unify_sandbox_transactions.user_id uuid
```

## constraints

```text
demo_investments demo_investments_pkey PRIMARY KEY (id)
demo_investments demo_investments_product_id_fkey FOREIGN KEY (product_id) REFERENCES investment_products(id)
demo_investments demo_investments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
manual_test_audit manual_test_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id)
manual_test_audit manual_test_audit_pkey PRIMARY KEY (id)
manual_test_audit manual_test_audit_request_id_fkey FOREIGN KEY (request_id) REFERENCES manual_test_requests(id)
manual_test_ledger manual_test_ledger_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id)
manual_test_ledger manual_test_ledger_pkey PRIMARY KEY (request_id, action)
manual_test_ledger manual_test_ledger_request_id_fkey FOREIGN KEY (request_id) REFERENCES manual_test_requests(id)
manual_test_requests manual_test_requests_amount_check CHECK (((amount >= 1) AND (amount <= 5000000)))
manual_test_requests manual_test_requests_kind_check CHECK ((kind = ANY (ARRAY['deposit'::text, 'withdrawal'::text])))
manual_test_requests manual_test_requests_pkey PRIMARY KEY (id)
manual_test_requests manual_test_requests_receipt_check CHECK ((length(receipt) <= 2800000))
manual_test_requests manual_test_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)
manual_test_requests manual_test_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'under_review'::text, 'approved'::text, 'processing'::text, 'completed'::text, 'rejected'::text, 'failed'::text, 'reversed'::text])))
manual_test_requests manual_test_requests_transaction_mode_check CHECK ((transaction_mode = 'sandbox'::text))
manual_test_requests manual_test_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
manual_test_requests manual_test_requests_user_id_request_key_key UNIQUE (user_id, request_key)
manual_test_settings manual_test_settings_id_check CHECK (id)
manual_test_settings manual_test_settings_pkey PRIMARY KEY (id)
manual_test_wallets manual_test_wallets_available_check CHECK ((available >= 0))
manual_test_wallets manual_test_wallets_pkey PRIMARY KEY (user_id)
manual_test_wallets manual_test_wallets_reserved_check CHECK ((reserved >= 0))
manual_test_wallets manual_test_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
sandbox_bonus_ledger sandbox_bonus_ledger_amount_check CHECK ((amount > (0)::numeric))
sandbox_bonus_ledger sandbox_bonus_ledger_entry_type_check CHECK ((entry_type = ANY (ARRAY['registration_bonus'::text, 'adjustment'::text])))
sandbox_bonus_ledger sandbox_bonus_ledger_pkey PRIMARY KEY (id)
sandbox_bonus_ledger sandbox_bonus_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
sandbox_deposit_balances sandbox_deposit_balances_balance_check CHECK ((balance >= (0)::numeric))
sandbox_deposit_balances sandbox_deposit_balances_currency_check CHECK ((currency = 'PHP'::text))
sandbox_deposit_balances sandbox_deposit_balances_pkey PRIMARY KEY (user_id)
sandbox_deposit_balances sandbox_deposit_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
sandbox_earnings_ledger sandbox_earnings_ledger_amount_check CHECK ((amount > (0)::numeric))
sandbox_earnings_ledger sandbox_earnings_ledger_currency_check CHECK ((currency = 'PHP'::text))
sandbox_earnings_ledger sandbox_earnings_ledger_pkey PRIMARY KEY (id)
sandbox_earnings_ledger sandbox_earnings_ledger_source_type_check CHECK ((source_type = ANY (ARRAY['registration_bonus'::text, 'daily_claim'::text, 'referral_commission'::text])))
sandbox_earnings_ledger sandbox_earnings_ledger_source_type_source_id_user_id_key UNIQUE (source_type, source_id, user_id)
sandbox_earnings_ledger sandbox_earnings_ledger_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
sandbox_free_plan_grants sandbox_free_plan_grants_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id)
sandbox_free_plan_grants sandbox_free_plan_grants_granted_by_idempotency_key_key UNIQUE (granted_by, idempotency_key)
sandbox_free_plan_grants sandbox_free_plan_grants_investment_id_fkey FOREIGN KEY (investment_id) REFERENCES demo_investments(id)
sandbox_free_plan_grants sandbox_free_plan_grants_investment_id_key UNIQUE (investment_id)
sandbox_free_plan_grants sandbox_free_plan_grants_note_check CHECK ((length(note) <= 300))
sandbox_free_plan_grants sandbox_free_plan_grants_pkey PRIMARY KEY (id)
sandbox_free_plan_grants sandbox_free_plan_grants_product_id_fkey FOREIGN KEY (product_id) REFERENCES investment_products(id)
sandbox_free_plan_grants sandbox_free_plan_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id)
sandbox_free_plan_grants sandbox_free_plan_grants_user_id_key UNIQUE (user_id)
sandbox_referral_commissions sandbox_referral_commissions_amount_centavos_check CHECK ((amount_centavos > 0))
sandbox_referral_commissions sandbox_referral_commissions_beneficiary_id_fkey FOREIGN KEY (beneficiary_id) REFERENCES profiles(id)
sandbox_referral_commissions sandbox_referral_commissions_check CHECK ((beneficiary_id <> depositor_id))
sandbox_referral_commissions sandbox_referral_commissions_deposit_centavos_check CHECK ((deposit_centavos > 0))
sandbox_referral_commissions sandbox_referral_commissions_depositor_id_fkey FOREIGN KEY (depositor_id) REFERENCES profiles(id)
sandbox_referral_commissions sandbox_referral_commissions_level_check CHECK (((level >= 1) AND (level <= 3)))
sandbox_referral_commissions sandbox_referral_commissions_pkey PRIMARY KEY (id)
sandbox_referral_commissions sandbox_referral_commissions_rate_bps_check CHECK ((rate_bps = ANY (ARRAY[3000, 200, 100])))
sandbox_referral_commissions sandbox_referral_commissions_transaction_id_beneficiary_id_key UNIQUE (transaction_id, beneficiary_id)
sandbox_referral_commissions sandbox_referral_commissions_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id)
sandbox_referral_commissions sandbox_referral_commissions_transaction_id_level_key UNIQUE (transaction_id, level)
sandbox_wallets sandbox_wallets_currency_check CHECK ((currency = 'PHP'::text))
sandbox_wallets sandbox_wallets_pkey PRIMARY KEY (user_id)
sandbox_wallets sandbox_wallets_remaining_balance_check CHECK ((remaining_balance >= (0)::numeric))
sandbox_wallets sandbox_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
sandbox_withdrawal_mode_audit sandbox_withdrawal_mode_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id)
sandbox_withdrawal_mode_audit sandbox_withdrawal_mode_audit_pkey PRIMARY KEY (id)
sandbox_withdrawal_mode_audit sandbox_withdrawal_mode_audit_version_key UNIQUE (version)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_amount_check CHECK ((amount > (0)::numeric))
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_completed_by_fkey FOREIGN KEY (completed_by) REFERENCES auth.users(id)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_currency_check CHECK ((currency = 'PHP'::text))
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_pkey PRIMARY KEY (id)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_status_check CHECK ((status = 'simulated_paid'::text))
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_transaction_id_fkey FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_transaction_id_key UNIQUE (transaction_id)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_withdrawal_request_id_fkey FOREIGN KEY (withdrawal_request_id) REFERENCES withdrawal_requests(id)
sandbox_withdrawal_payouts sandbox_withdrawal_payouts_withdrawal_request_id_key UNIQUE (withdrawal_request_id)
sandbox_withdrawal_requests sandbox_withdrawal_requests_amount_check CHECK ((amount >= (100)::numeric))
sandbox_withdrawal_requests sandbox_withdrawal_requests_currency_check CHECK ((currency = 'PHP'::text))
sandbox_withdrawal_requests sandbox_withdrawal_requests_payment_method_check CHECK ((payment_method = ANY (ARRAY['gcash'::text, 'maya'::text])))
sandbox_withdrawal_requests sandbox_withdrawal_requests_pkey PRIMARY KEY (id)
sandbox_withdrawal_requests sandbox_withdrawal_requests_processing_mode_check CHECK ((processing_mode = ANY (ARRAY['automatic'::text, 'admin_approval'::text])))
sandbox_withdrawal_requests sandbox_withdrawal_requests_rejected_by_fkey FOREIGN KEY (rejected_by) REFERENCES profiles(id) ON DELETE SET NULL
sandbox_withdrawal_requests sandbox_withdrawal_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reserved'::text, 'processing'::text, 'simulated_paid'::text, 'cancelled'::text, 'rejected'::text])))
sandbox_withdrawal_requests sandbox_withdrawal_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
sandbox_withdrawal_settings sandbox_withdrawal_settings_id_check CHECK (id)
sandbox_withdrawal_settings sandbox_withdrawal_settings_mode_check CHECK ((mode = ANY (ARRAY['automatic'::text, 'admin_approval'::text])))
sandbox_withdrawal_settings sandbox_withdrawal_settings_pkey PRIMARY KEY (id)
sandbox_withdrawal_settings sandbox_withdrawal_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id)
simulation_daily_credits simulation_daily_credits_investment_id_fkey FOREIGN KEY (investment_id) REFERENCES demo_investments(id) ON DELETE CASCADE
unify_sandbox_transactions unify_sandbox_transactions_amount_centavos_check CHECK ((amount_centavos > 0))
unify_sandbox_transactions unify_sandbox_transactions_balance_after_centavos_check CHECK ((balance_after_centavos >= 0))
unify_sandbox_transactions unify_sandbox_transactions_pkey PRIMARY KEY (id)
unify_sandbox_transactions unify_sandbox_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['deposit'::text, 'withdraw'::text])))
unify_sandbox_transactions unify_sandbox_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
unify_sandbox_wallets unify_sandbox_wallets_balance_centavos_check CHECK ((balance_centavos >= 0))
unify_sandbox_wallets unify_sandbox_wallets_pkey PRIMARY KEY (user_id)
unify_sandbox_wallets unify_sandbox_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
```

## grants

```text
demo_investments anon DELETE
demo_investments anon INSERT
demo_investments anon REFERENCES
demo_investments anon SELECT
demo_investments anon TRIGGER
demo_investments anon TRUNCATE
demo_investments anon UPDATE
demo_investments authenticated DELETE
demo_investments authenticated INSERT
demo_investments authenticated REFERENCES
demo_investments authenticated SELECT
demo_investments authenticated TRIGGER
demo_investments authenticated TRUNCATE
demo_investments authenticated UPDATE
demo_investments postgres DELETE
demo_investments postgres INSERT
demo_investments postgres REFERENCES
demo_investments postgres SELECT
demo_investments postgres TRIGGER
demo_investments postgres TRUNCATE
demo_investments postgres UPDATE
demo_investments service_role DELETE
demo_investments service_role INSERT
demo_investments service_role REFERENCES
demo_investments service_role SELECT
demo_investments service_role TRIGGER
demo_investments service_role TRUNCATE
demo_investments service_role UPDATE
sandbox_free_plan_grants authenticated SELECT
sandbox_free_plan_grants postgres DELETE
sandbox_free_plan_grants postgres INSERT
sandbox_free_plan_grants postgres REFERENCES
sandbox_free_plan_grants postgres SELECT
sandbox_free_plan_grants postgres TRIGGER
sandbox_free_plan_grants postgres TRUNCATE
sandbox_free_plan_grants postgres UPDATE
sandbox_free_plan_grants service_role DELETE
sandbox_free_plan_grants service_role INSERT
sandbox_free_plan_grants service_role REFERENCES
sandbox_free_plan_grants service_role SELECT
sandbox_free_plan_grants service_role TRIGGER
sandbox_free_plan_grants service_role TRUNCATE
sandbox_free_plan_grants service_role UPDATE
```

## indexes

```text
CREATE INDEX manual_test_member_history ON public.manual_test_requests USING btree (user_id, created_at DESC)
CREATE INDEX sandbox_commissions_beneficiary ON public.sandbox_referral_commissions USING btree (beneficiary_id, created_at DESC)
CREATE INDEX sandbox_earnings_user_created_idx ON public.sandbox_earnings_ledger USING btree (user_id, created_at DESC)
CREATE INDEX sandbox_withdrawals_user_created_idx ON public.sandbox_withdrawal_requests USING btree (user_id, created_at DESC)
CREATE INDEX sandbox_withdrawals_user_history ON public.sandbox_withdrawal_requests USING btree (user_id, created_at DESC)
CREATE UNIQUE INDEX demo_investments_pkey ON public.demo_investments USING btree (id)
CREATE UNIQUE INDEX manual_test_audit_pkey ON public.manual_test_audit USING btree (id)
CREATE UNIQUE INDEX manual_test_ledger_pkey ON public.manual_test_ledger USING btree (request_id, action)
CREATE UNIQUE INDEX manual_test_paid_reference ON public.manual_test_requests USING btree (reference) WHERE ((kind = 'deposit'::text) AND (status = ANY (ARRAY['approved'::text, 'reversed'::text])))
CREATE UNIQUE INDEX manual_test_requests_pkey ON public.manual_test_requests USING btree (id)
CREATE UNIQUE INDEX manual_test_requests_user_id_request_key_key ON public.manual_test_requests USING btree (user_id, request_key)
CREATE UNIQUE INDEX manual_test_settings_pkey ON public.manual_test_settings USING btree (id)
CREATE UNIQUE INDEX manual_test_transfer_reference ON public.manual_test_requests USING btree (transfer_reference) WHERE (transfer_reference IS NOT NULL)
CREATE UNIQUE INDEX manual_test_wallets_pkey ON public.manual_test_wallets USING btree (user_id)
CREATE UNIQUE INDEX sandbox_bonus_ledger_pkey ON public.sandbox_bonus_ledger USING btree (id)
CREATE UNIQUE INDEX sandbox_deposit_balances_pkey ON public.sandbox_deposit_balances USING btree (user_id)
CREATE UNIQUE INDEX sandbox_earnings_ledger_pkey ON public.sandbox_earnings_ledger USING btree (id)
CREATE UNIQUE INDEX sandbox_earnings_ledger_source_type_source_id_user_id_key ON public.sandbox_earnings_ledger USING btree (source_type, source_id, user_id)
CREATE UNIQUE INDEX sandbox_earnings_one_registration_bonus ON public.sandbox_earnings_ledger USING btree (user_id) WHERE (source_type = 'registration_bonus'::text)
CREATE UNIQUE INDEX sandbox_free_plan_grants_granted_by_idempotency_key_key ON public.sandbox_free_plan_grants USING btree (granted_by, idempotency_key)
CREATE UNIQUE INDEX sandbox_free_plan_grants_investment_id_key ON public.sandbox_free_plan_grants USING btree (investment_id)
CREATE UNIQUE INDEX sandbox_free_plan_grants_pkey ON public.sandbox_free_plan_grants USING btree (id)
CREATE UNIQUE INDEX sandbox_free_plan_grants_user_id_key ON public.sandbox_free_plan_grants USING btree (user_id)
CREATE UNIQUE INDEX sandbox_one_registration_bonus_per_user ON public.sandbox_bonus_ledger USING btree (user_id) WHERE (entry_type = 'registration_bonus'::text)
CREATE UNIQUE INDEX sandbox_referral_commissions_pkey ON public.sandbox_referral_commissions USING btree (id)
CREATE UNIQUE INDEX sandbox_referral_commissions_transaction_id_beneficiary_id_key ON public.sandbox_referral_commissions USING btree (transaction_id, beneficiary_id)
CREATE UNIQUE INDEX sandbox_referral_commissions_transaction_id_level_key ON public.sandbox_referral_commissions USING btree (transaction_id, level)
CREATE UNIQUE INDEX sandbox_wallets_pkey ON public.sandbox_wallets USING btree (user_id)
CREATE UNIQUE INDEX sandbox_withdrawal_mode_audit_pkey ON public.sandbox_withdrawal_mode_audit USING btree (id)
CREATE UNIQUE INDEX sandbox_withdrawal_mode_audit_version_key ON public.sandbox_withdrawal_mode_audit USING btree (version)
CREATE UNIQUE INDEX sandbox_withdrawal_payouts_pkey ON public.sandbox_withdrawal_payouts USING btree (id)
CREATE UNIQUE INDEX sandbox_withdrawal_payouts_transaction_id_key ON public.sandbox_withdrawal_payouts USING btree (transaction_id)
CREATE UNIQUE INDEX sandbox_withdrawal_payouts_withdrawal_request_id_key ON public.sandbox_withdrawal_payouts USING btree (withdrawal_request_id)
CREATE UNIQUE INDEX sandbox_withdrawal_requests_pkey ON public.sandbox_withdrawal_requests USING btree (id)
CREATE UNIQUE INDEX sandbox_withdrawal_settings_pkey ON public.sandbox_withdrawal_settings USING btree (id)
CREATE UNIQUE INDEX sandbox_withdrawals_user_idempotency ON public.sandbox_withdrawal_requests USING btree (user_id, idempotency_key)
CREATE UNIQUE INDEX unify_sandbox_transactions_pkey ON public.unify_sandbox_transactions USING btree (id)
CREATE UNIQUE INDEX unify_sandbox_wallets_pkey ON public.unify_sandbox_wallets USING btree (user_id)
```

## policies

```text
public.demo_investments Users can view their own demo investments SELECT {authenticated} USING (( SELECT auth.uid() AS uid) = user_id) CHECK 
public.investment_products Anyone can view demo products SELECT {anon,authenticated} USING true CHECK 
public.sandbox_bonus_ledger View own sandbox bonuses SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_deposit_balances View own sandbox deposit balance SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_earnings_ledger Read own sandbox earnings SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_free_plan_grants Read own free plan grant SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_referral_commissions Own simulated commissions SELECT {authenticated} USING (beneficiary_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_wallets View own sandbox wallet SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.sandbox_withdrawal_requests View own sandbox withdrawals SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.simulation_daily_credits Read own simulation credits SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.simulation_wallets Read own simulation wallet SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.unify_sandbox_transactions Read own sandbox transactions SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK 
public.unify_sandbox_wallets Read own sandbox wallet SELECT {authenticated} USING (user_id = ( SELECT auth.uid() AS uid)) CHECK
```

## triggers

```text
CREATE TRIGGER credit_sandbox_referral_commissions AFTER UPDATE OF status ON public.payment_transactions FOR EACH ROW EXECUTE FUNCTION credit_sandbox_referral_commissions()
CREATE TRIGGER on_auth_user_sandbox_bonus AFTER INSERT OR UPDATE OF email_confirmed_at, phone_confirmed_at ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_sandbox_bonus_auth()
CREATE TRIGGER on_profile_sandbox_bonus AFTER INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION handle_sandbox_bonus_profile()
```

## version

```text
17.11
```

## Exact relation-name references in stored routine source

## demo_investments

```text
claim_simulation_days(uuid) | get_daily_team_tasks() | grant_sandbox_free_plan(uuid,uuid,uuid,uuid,text) | purchase_demo_investment(uuid,numeric)
```

## sandbox_free_plan_grants

```text
grant_sandbox_free_plan(uuid,uuid,uuid,uuid,text)
```

## sandbox_wallets

```text
claim_simulation_days(uuid) | credit_sandbox_referral_commissions() | credit_sandbox_registration_bonus(uuid) | purchase_demo_investment(uuid,numeric) | reject_sandbox_withdrawal(uuid,uuid,text) | request_configured_sandbox_withdrawal(uuid,numeric,uuid,uuid,boolean) | request_sandbox_withdrawal(numeric,uuid,uuid)
```

## simulated_balance

```text
(none)
```

## test_transactions

```text
(none)
```

## unify_sandbox_transactions

```text
unify_sandbox_transfer(text,bigint)
```

## unify_sandbox_wallets

```text
unify_sandbox_transfer(text,bigint)
```

## Edge Functions

The production dashboard shows “Deploy your first edge function.”
