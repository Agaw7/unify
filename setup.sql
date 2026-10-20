-- UNIFY: simulated payouts only. Does NOT send GCash/Maya funds.
BEGIN;
CREATE TABLE IF NOT EXISTS public.sandbox_withdrawal_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  withdrawal_request_id uuid NOT NULL UNIQUE REFERENCES public.withdrawal_requests(id),
  transaction_id uuid NOT NULL UNIQUE REFERENCES public.payment_transactions(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'PHP' CHECK (currency = 'PHP'),
  payment_method text NOT NULL,
  completed_by uuid NOT NULL REFERENCES auth.users(id),
  completed_at timestamptz NOT NULL DEFAULT now(),
  simulation_reference uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  is_simulated boolean NOT NULL DEFAULT true CHECK (is_simulated = true)
);
ALTER TABLE public.sandbox_withdrawal_payouts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sandbox_withdrawal_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.sandbox_withdrawal_payouts TO service_role;

CREATE OR REPLACE FUNCTION public.complete_sandbox_withdrawal(
  p_request_id uuid,
  p_admin_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.withdrawal_requests%ROWTYPE;
  v_tx public.payment_transactions%ROWTYPE;
  v_reservation_count integer;
  v_other_entries integer;
BEGIN
  -- Database EXECUTE privilege limits this function to service_role.
  -- The API independently verifies the signed-in admin and the server-only flag.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_admin_id AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access required';
  END IF;

  SELECT * INTO v_request
  FROM public.withdrawal_requests
  WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal not found'; END IF;

  IF v_request.status = 'completed' THEN
    IF EXISTS (
      SELECT 1 FROM public.sandbox_withdrawal_payouts
      WHERE withdrawal_request_id = p_request_id
    ) THEN
      RETURN 'already_simulated_paid';
    END IF;
    RAISE EXCEPTION 'Completed withdrawal has no sandbox payout record';
  END IF;

  IF v_request.status <> 'processing' THEN
    RAISE EXCEPTION 'Approve withdrawal for processing first';
  END IF;
  IF v_request.transaction_id IS NULL THEN
    RAISE EXCEPTION 'Withdrawal transaction missing';
  END IF;

  SELECT * INTO v_tx FROM public.payment_transactions
  WHERE id = v_request.transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction not found'; END IF;

  IF v_tx.transaction_type IS DISTINCT FROM 'withdrawal'
    OR v_tx.status IS DISTINCT FROM 'processing'
    OR v_tx.user_id IS DISTINCT FROM v_request.user_id
    OR v_tx.amount IS DISTINCT FROM v_request.amount
    OR v_tx.currency IS DISTINCT FROM 'PHP'
    OR v_request.currency IS DISTINCT FROM 'PHP'
    OR v_request.amount <= 0
  THEN
    RAISE EXCEPTION 'Withdrawal transaction mismatch';
  END IF;

  SELECT count(*) INTO v_reservation_count
  FROM public.wallet_ledger
  WHERE transaction_id = v_tx.id
    AND user_id = v_request.user_id
    AND entry_type = 'withdrawal_reserve'
    AND amount = v_request.amount;
  IF v_reservation_count <> 1 THEN
    RAISE EXCEPTION 'Exactly one valid withdrawal reservation required';
  END IF;

  SELECT count(*) INTO v_other_entries
  FROM public.wallet_ledger
  WHERE transaction_id = v_tx.id
    AND (entry_type <> 'withdrawal_reserve'
      OR user_id IS DISTINCT FROM v_request.user_id
      OR amount IS DISTINCT FROM v_request.amount);
  IF v_other_entries <> 0 THEN
    RAISE EXCEPTION 'Unexpected ledger entries: manual review required';
  END IF;

  INSERT INTO public.sandbox_withdrawal_payouts (
    withdrawal_request_id, transaction_id, user_id,
    amount, currency, payment_method, completed_by
  ) VALUES (
    v_request.id, v_tx.id, v_request.user_id,
    v_request.amount, v_request.currency, v_request.payment_method, p_admin_id
  );

  UPDATE public.payment_transactions SET status = 'completed'
  WHERE id = v_tx.id AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaction changed'; END IF;

  UPDATE public.withdrawal_requests SET status = 'completed'
  WHERE id = v_request.id AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Withdrawal changed'; END IF;

  -- No wallet update and no new wallet_ledger entry: funds were already reserved.
  RETURN 'simulated_paid';
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_sandbox_withdrawal(uuid,uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_sandbox_withdrawal(uuid,uuid)
  TO service_role;
COMMIT;
