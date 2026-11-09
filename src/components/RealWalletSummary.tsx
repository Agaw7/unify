"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { moneyRequest } from "@/lib/money-client";

const DAY_MS = 86_400_000;
type EarningPlan = { created_at: string; claimed_days: number; duration_days: number };

const php = (centavos: number) => new Intl.NumberFormat("en-PH", {
  style: "currency", currency: "PHP",
}).format(centavos / 100);

export default function RealWalletSummary({ homeCard = false }: { homeCard?: boolean }) {
  const [available, setAvailable] = useState<number | null>(null);
  const [deposit, setDeposit] = useState<number | null>(null);
  const [bonusGranted, setBonusGranted] = useState(false);
  const [automaticBonus, setAutomaticBonus] = useState(false);
  const [bonusReclaimed, setBonusReclaimed] = useState(false);
  const [plans, setPlans] = useState<EarningPlan[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  const [visible, setVisible] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      setLoading(true);
      setError("");
      setAvailable(null);
      setDeposit(null);
      try {
        const result = await moneyRequest("/api/money?summary=balance");
        const value = result.wallet?.available;
        const purchases = result.wallet?.deposit_available;
        if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(purchases) || purchases < 0 || result.wallet?.currency !== "PHP") {
          throw new Error("Unable to verify PHP wallet balance.");
        }
        if (active) {
          setAvailable(value); setDeposit(purchases);
          setPlans(result.plans);
          setNow(Date.now());
          setBonusGranted(result.registrationBonusGranted === true);
          setAutomaticBonus(result.automaticRegistrationBonus === true);
          setBonusReclaimed(result.registrationBonusReclaimed === true);
        }
      } catch (failure) {
        if (active) {
          setError(failure instanceof Error ? failure.message : "Unable to load PHP wallet.");
        }
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    }
    const reload = () => void load();
    void load();
    window.addEventListener("pageshow", reload);
    window.addEventListener("focus", reload);
    return () => {
      active = false;
      window.removeEventListener("pageshow", reload);
      window.removeEventListener("focus", reload);
    };
  }, []);

  useEffect(() => {
    if (!homeCard) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [homeCard]);

  if (homeCard) {
    const amount = (value: number | null) => !visible ? "••••" : value === null ? (loading ? php(0) : "—") : php(value);
    const total = available === null || deposit === null ? null : available + deposit;
    const nextUnlock = (plans ?? []).reduce((earliest, plan) => {
      if (plan.claimed_days >= plan.duration_days) return earliest;
      const unlock = Date.parse(plan.created_at) + (plan.claimed_days + 1) * DAY_MS;
      return Number.isFinite(unlock) ? Math.min(earliest, unlock) : earliest;
    }, Infinity);
    const seconds = Math.max(0, Math.ceil((nextUnlock - now) / 1000));
    const countdown = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map(part => String(part).padStart(2, "0")).join(":");
    return <section className="home-wallet" aria-label="PHP wallet balances" aria-busy={loading}>
      <div className="home-wallet-label">
        <span>Total balance</span>
        <button type="button" aria-label={visible ? "Hide balances" : "Show balances"} onClick={() => setVisible(!visible)}>
          {visible ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>
      <h2 aria-live="polite">{amount(total)}</h2>
      <div className="home-wallet-earning">
        {loading ? "Refreshing balance…" : error ? "Reward schedule unavailable" :
          !Number.isFinite(nextUnlock) ? "No upcoming earnings" : seconds === 0 ? "Daily reward eligible · awaiting credit" :
          <>Next earning in <strong>{countdown}</strong></>}
      </div>
      <dl className="home-wallet-breakdown">
        <div><dt>Available</dt><dd>{amount(available)}</dd></div>

        <div><dt>Deposit balance</dt><dd>{amount(deposit)}</dd><small>For product purchases</small></div>
      </dl>
      {error && <p role="alert">{error}</p>}
      {bonusReclaimed && <p>Registration bonus reclaimed.</p>}
      {available !== null && !bonusGranted && <p>{automaticBonus ? "₱20 registration bonus pending business funding or account review." : "Registration bonus has not been credited."}</p>}
    </section>;
  }

  return <div className="unify-wallet-summary" aria-busy={loading}>
    {loading && <p role="status">Refreshing balance…</p>}
    <div className="unify-balance-card">
      <span>PHP Wallet · Available Balance</span>
      <h2 aria-live="polite">{available === null ? (loading ? php(0) : "—") : php(available)}</h2>
      {error && <p role="alert">{error}</p>}
      {bonusReclaimed && <p>Registration bonus reclaimed.</p>}
      {available !== null && !bonusGranted && automaticBonus && <p>₱20 registration bonus pending business funding or account review.</p>}
      {available !== null && !bonusGranted && !automaticBonus && <p>Registration bonus has not been credited.</p>}
    </div>
    <div className="unify-balance-card">
      <span>Deposit Balance</span>
      <h2>{deposit === null ? (loading ? php(0) : "—") : php(deposit)}</h2>
      <p>For product purchases only · Not withdrawable</p>

    </div>
  </div>;
}
