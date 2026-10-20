"use client";

import { Eye, EyeOff, X, LockKeyhole } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function formatPhone(value: string): string | null {
  const cleaned = value.replace(/\D/g, "");
  if (/^09\d{9}$/.test(cleaned)) return "+63" + cleaned.slice(1);
  if (/^639\d{9}$/.test(cleaned)) return "+" + cleaned;
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const termsCloseRef = useRef<HTMLButtonElement>(null);
  const forgotCloseRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try {
      const savedPhone = localStorage.getItem("unify_remembered_phone");
      if (savedPhone) {
        setPhone(savedPhone);
        setRememberMe(true);
      }
    } catch {
      // Browser storage can be unavailable.
    }
  }, []);

  useEffect(() => {
    if (!showTerms && !showForgot) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowTerms(false);
        setShowForgot(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    const closeButton = showTerms ? termsCloseRef.current : forgotCloseRef.current;
    closeButton?.focus();
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showTerms, showForgot]);

  function updateRememberMe(checked: boolean) {
    setRememberMe(checked);
    if (!checked) {
      try {
        localStorage.removeItem("unify_remembered_phone");
      } catch {
        // Ignore storage failures.
      }
    }
  }


async function handleLogin(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (loading) return;

  if (!agreed) {
    setError("Please agree to the Terms & Conditions.");
    return;
  }

  const formattedPhone = formatPhone(phone);

  if (!formattedPhone) {
    setError("Enter a valid Philippine mobile number.");
    return;
  }

  setLoading(true);
  setError("");

  try {
    const { data, error: authError } =
      await supabase.auth.signInWithPassword({
        phone: formattedPhone,
        password,
      });

    if (authError) {
      console.error("UNIFY Supabase authentication error:", {
        message: authError.message,
        code: authError.code,
        status: authError.status,
        name: authError.name,
      });

      const errorMessage = authError.message.toLowerCase();

      if (
        errorMessage.includes("fetch") ||
        errorMessage.includes("network")
      ) {
        setError(
          "Cannot reach Supabase Authentication. Check your internet connection and Supabase configuration."
        );
      } else if (authError.status === 429) {
        setError("Too many login attempts. Please try again later.");
      } else if (
        errorMessage.includes("invalid login credentials")
      ) {
        setError("Incorrect mobile number or password.");
      } else if (
        errorMessage.includes("phone not confirmed")
      ) {
        setError("Please verify your mobile number first.");
      } else {
        setError(`Login failed: ${authError.message}`);
      }

      return;
    }

    if (!data.session) {
      setError(
        "Sign-in did not return a session. Check account verification."
      );
      return;
    }

    try {
      if (rememberMe) {
        localStorage.setItem(
          "unify_remembered_phone",
          phone
        );
      } else {
        localStorage.removeItem(
          "unify_remembered_phone"
        );
      }
    } catch {
      // Authentication succeeds even if browser storage is unavailable.
    }

    router.replace("/dashboard");
    router.refresh();
  } catch (err) {
    console.error("UNIFY unexpected login error:", err);

    setError(
      "An unexpected login error occurred. Check the browser console."
    );
  } finally {
    setLoading(false);
  }
}


  return (
    <main className="unify-login">
      <form className="unify-login-card" onSubmit={handleLogin}>
        <div className="unify-login-logo">◆</div>
        <h1>UNIFY</h1>
        <p>Sign in to your account</p>

        {error && <div className="unify-login-error" role="alert">{error}</div>}

        <label htmlFor="phone">Mobile Number</label>
        <input
          id="phone"
          type="tel"
          autoComplete="tel"
          placeholder="09123456789"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          required
        />

        <label htmlFor="password">Password</label>
        <div className="password-wrapper">
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShowPassword((value) => !value)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
          </button>
        </div>

        <div className="login-options">
          <label className="remember-option">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => updateRememberMe(event.target.checked)}
            />
            Remember me
          </label>
          <button
            type="button"
            className="text-link"
            onClick={() => setShowForgot(true)}
          >
            Forgot password?
          </button>
        </div>

        <div className="terms-option">
          <label className="remember-option" htmlFor="unify-agreement">
            <input
              id="unify-agreement"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
            />
            I agree to the
          </label>
          <button
            type="button"
            className="text-link"
            onClick={() => setShowTerms(true)}
          >
            Terms &amp; Conditions
          </button>
        </div>

        <button type="submit" disabled={loading || !agreed}>
          {loading ? "Signing in..." : "Log In"}
        </button>

        <p style={{ marginTop: "20px" }}>
          Don&apos;t have an account?{" "}
          <Link href="/register" style={{ color: "#00D2FF" }}>
            Register Here
          </Link>
        </p>
        <small>UNIFY</small>
      </form>

      {showTerms && (
        <div
          className="unify-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowTerms(false);
          }}
        >
          <section
            className="unify-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-title"
            aria-describedby="terms-description"
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h2 id="terms-title">Terms &amp; Conditions</h2>
              <button
                ref={termsCloseRef}
                type="button"
                onClick={() => setShowTerms(false)}
                aria-label="Close terms"
              >
                <X size={24} />
              </button>
            </div>
            <div className="sheet-content" id="terms-description">
              <h3>1. Eligibility</h3>
              <p>You must be at least 18 years old to register for UNIFY.</p>
              <h3>2. Account &amp; Security</h3>
              <p>Keep your password confidential. Do not share your account credentials.</p>
              <h3>3. Registration Bonus</h3>
              <p>Eligible new members receive a one-time ₱30 simulated registration bonus. This is not real money and cannot be withdrawn.</p>
              <h3>4. Simulated Wallet</h3>
              <p>Test-mode balances and earnings are for simulation purposes only.</p>
              <h3>5. Deposits &amp; Withdrawals</h3>
              <p>Any real-money payment features are separate from the simulated wallet and subject to applicable legal and provider requirements.</p>
              <h3>6. Privacy &amp; Support</h3>
              <p>Contact official UNIFY support for account assistance or disputes. Review the platform privacy policy for how your personal information is handled.</p>
            </div>
            <button
              type="button"
              className="sheet-primary"
              onClick={() => {
                setAgreed(true);
                setShowTerms(false);
              }}
            >
              I Understand
            </button>
          </section>
        </div>
      )}

      {showForgot && (
        <div
          className="unify-modal-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setShowForgot(false);
          }}
        >
          <section
            className="unify-bottom-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="forgot-title"
            aria-describedby="forgot-description"
          >
            <div className="sheet-handle" />
            <div className="sheet-header">
              <h2 id="forgot-title">Forgot Password?</h2>
              <button
                ref={forgotCloseRef}
                type="button"
                onClick={() => setShowForgot(false)}
                aria-label="Close password recovery"
              >
                <X size={24} />
              </button>
            </div>
            <div className="sheet-content" id="forgot-description">
              <LockKeyhole size={36} aria-hidden="true" />
              <p>To reset your password, your account ownership must be verified.</p>
              <p>Phone-number password recovery is not available until a secure SMS verification provider or another verified recovery method is configured. Contact official UNIFY support for assistance. Never share your password or verification codes.</p>
            </div>
            <button
              type="button"
              className="sheet-primary"
              onClick={() => setShowForgot(false)}
            >
              Back to Login
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
