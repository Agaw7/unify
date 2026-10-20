
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [verifiedPhone, setVerifiedPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  async function handleSendOTP(e: React.FormEvent) {
    e.preventDefault();

    const formattedPhone = formatPhone(phone);

    if (!formattedPhone) {
      setError("Enter a valid Philippine mobile number.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    const { error: authError } =
      await supabase.auth.signInWithOtp({
        phone: formattedPhone,
        options: {
          shouldCreateUser: false,
        },
      });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    setVerifiedPhone(formattedPhone);
    setStep("otp");
    setMessage("If this number is registered, an OTP has been sent.");
  }

  async function handleVerifyOTP(e: React.FormEvent) {
    e.preventDefault();

    setLoading(true);
    setError("");

    const { data, error: authError } =
      await supabase.auth.verifyOtp({
        phone: verifiedPhone,
        token: otp.trim(),
        type: "sms",
      });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    if (!data.session) {
      setError("Login failed. No session was created.");
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <main className="unify-login">
      <form
        className="unify-login-card"
        onSubmit={
          step === "phone"
            ? handleSendOTP
            : handleVerifyOTP
        }
      >
        <div className="unify-login-logo">◆</div>

        <h1>UNIFY</h1>

        <p>
          {step === "phone"
            ? "Sign in using your mobile number"
            : "Verify your mobile number"}
        </p>

        {error && (
          <div className="unify-login-error">
            {error}
          </div>
        )}

        {message && (
          <p role="status">{message}</p>
        )}

        {step === "phone" ? (
          <>
            <label htmlFor="phone">
              Mobile Number
            </label>

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
              {loading ? "Sending OTP..." : "Send OTP"}
            </button>
          </>
        ) : (
          <>
            <label htmlFor="otp">
              SMS Verification Code
            </label>

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
              {loading ? "Verifying..." : "Verify & Login"}
            </button>

            <button
              type="button"
              onClick={() => {
                setStep("phone");
                setOtp("");
                setError("");
                setMessage("");
              }}
            >
              Change Number
            </button>
          </>
        )}

        <p style={{ marginTop: "20px" }}>
          Don&apos;t have an account?{" "}
          <a
            href="/register"
            style={{ color: "#00D2FF" }}
          >
            Register Here
          </a>
        </p>

        <small>
          UNIFY Virtual Investment Simulator
        </small>
      </form>
    </main>
  );
}
