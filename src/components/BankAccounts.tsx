"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Provider = "gcash" | "maya";
type PaymentAccount = {
  id: string;
  provider: Provider;
  account_name: string;
  account_number: string;
  created_at: string;
};

export default function BankAccounts({ onBack }: { onBack: () => void }) {
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [provider, setProvider] = useState<Provider>("gcash");
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) {
      setError("Please sign in to manage payment accounts.");
      setLoading(false);
      return;
    }
    const { data, error: queryError } = await supabase
      .from("payment_accounts")
      .select("id,provider,account_name,account_number,created_at")
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false });
    if (queryError) setError(queryError.message);
    else { setAccounts((data ?? []) as PaymentAccount[]); setError(""); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError(""); setNotice("");
    const cleanNumber = number.trim();
    const cleanName = name.trim();
    if (!/^09\d{9}$/.test(cleanNumber)) {
      setError("Enter an 11-digit Philippine mobile number starting with 09."); return;
    }
    if (cleanName.length < 2 || cleanName.length > 100) {
      setError("Enter the registered account name (2–100 characters)."); return;
    }
    setBusy(true);
    try {
      const { data: auth, error: authError } = await supabase.auth.getUser();
      if (authError || !auth.user) throw new Error("Please sign in again.");
      const { error: insertError } = await supabase.from("payment_accounts").insert({
        user_id: auth.user.id, provider, account_name: cleanName, account_number: cleanNumber,
      });
      if (insertError) throw new Error(insertError.code === "23505" ? "This account is already linked." : insertError.message);
      setName(""); setNumber(""); setNotice("Payment account saved. It has not been verified by GCash or Maya.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save account."); }
    finally { setBusy(false); }
  }

  async function removeAccount(id: string) {
    if (busy || !window.confirm("Remove this linked payment account?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { error: deleteError } = await supabase.from("payment_accounts").delete().eq("id", id);
      if (deleteError) throw new Error(deleteError.message);
      setNotice("Payment account removed.");
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to remove account."); }
    finally { setBusy(false); }
  }

  return (
    <section className="team-panel" style={{ display: "grid", gap: 16 }}>
      <h2>Payment Accounts</h2>
      <p>Link a GCash or Maya account for future withdrawal requests. Saving an account does not verify ownership or send money.</p>
      <form onSubmit={addAccount} style={{ display: "grid", gap: 12, maxWidth: 440 }}>
        <label htmlFor="account-provider">Provider</label>
        <select id="account-provider" value={provider} onChange={e => setProvider(e.target.value as Provider)} disabled={busy} className="w-full rounded-xl bg-slate-800 p-3 text-white">
          <option value="gcash">GCash</option><option value="maya">Maya</option>
        </select>
        <label htmlFor="account-name">Registered account name</label>
        <input id="account-name" value={name} onChange={e => setName(e.target.value)} maxLength={100} required autoComplete="name" placeholder="Full name" className="w-full rounded-xl bg-slate-800 p-3 text-white" />
        <label htmlFor="account-number">GCash / Maya mobile number</label>
        <input id="account-number" value={number} onChange={e => setNumber(e.target.value)} maxLength={11} inputMode="numeric" pattern="09[0-9]{9}" required placeholder="09XXXXXXXXX" className="w-full rounded-xl bg-slate-800 p-3 text-white" />
        <button type="submit" disabled={busy} className="invest-now-button">{busy ? "Saving..." : "Save Payment Account"}</button>
      </form>
      {error && <p role="alert" style={{ color: "#fca5a5" }}>{error}</p>}
      {notice && <p role="status" style={{ color: "#86efac" }}>{notice}</p>}
      <h3>Linked Accounts</h3>
      {loading ? <p>Loading accounts...</p> : accounts.length === 0 ? <p>No GCash or Maya accounts linked yet.</p> : (
        <div style={{ display: "grid", gap: 12 }}>
          {accounts.map(account => (
            <div key={account.id} className="rounded-xl border border-slate-700 p-4" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div>
                <strong>{account.provider === "gcash" ? "GCash" : "Maya"}</strong>
                <p>{account.account_name}</p>
                <p>*******{account.account_number.slice(-4)}</p>
                <small>Saved — not provider-verified</small>
              </div>
              <button type="button" disabled={busy} onClick={() => void removeAccount(account.id)} className="rounded-lg border border-red-500 px-3 py-2 text-red-300">Remove</button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={onBack} className="invest-now-button">Back to Profile</button>
    </section>
  );
}
