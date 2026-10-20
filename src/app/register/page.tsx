
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RegisterPage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "verify">("phone");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function formatPhone(value: string) {
    const cleaned = value.replace(/\D/g, "");

    if (/^09\d{9}$/.test(cleaned)) {
      return "+63" + cleaned.slice(1);
    }

    if (/^639\d{9}$/.test(cleaned)) {
      return "+" + cleaned;
    }

    return null;
  }

  async function sendOTP(e: React.FormEvent) {
    e.preventDefault();

    const formatted = formatPhone(phone);

    if (!formatted) {
      setError("Enter a valid Philippine mobile number.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      phone: formatted,
      options: {
        shouldCreateUser: true,
      },
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    setPhone(formatted);
    setStep("verify");
    setMessage("Verification code sent to your phone.");
  }

  async function verifyOTP(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.verifyOtp({
      phone,
      token: otp,
      type: "sms",
    });

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (!data.session) {
      setError("Verification succeeded, but no session was created.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="unify-login">
      <div className="unify-login-card">
        <div className="unify-login-logo">◆</div>

        <h1>UNIFY</h1>
        <p>Register using your mobile number</p>

        {error && (
          <div className="unify-login-error">{error}</div>
        )}

        {message && <p role="status">{message}</p>}

        {step === "phone" ? (
          <form onSubmit={sendOTP}>
            <label htmlFor="phone">Mobile Number</label>

            <input
              id="phone"
              type="tel"
              autoComplete="tel"
              placeholder="09123456789"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? "Sending..." : "Send OTP"}
            </button>
          </form>
        ) : (
          <form onSubmit={verifyOTP}>
            <label htmlFor="otp">SMS Verification Code</label>

            <input
              id="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Enter OTP"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              required
            />

            <button type="submit" disabled={loading}>
              {loading ? "Verifying..." : "Verify & Register"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setOtp("");
                setMessage("");
              }}
            >
              Change Number
            </button>
          </form>
        )}

        <small>UNIFY — Virtual Investment Simulator</small>
      </div>
    </main>
  );
}
