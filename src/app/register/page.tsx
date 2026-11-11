
"use client";
import ThemeWelcome from "@/components/WelcomeArtwork";
import AureviaLogo from "@/components/AureviaLogo";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { referralCode } from "@/lib/referral";

export default function RegisterPage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [referral, setReferral] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const code = referralCode(new URLSearchParams(window.location.search).get('ref'));
    if (!code) return;
    void Promise.resolve(supabase.rpc('resolve_invite_code', { p_code: code })).then(({ data, error }) => {
      if (!active) return;
      if (!error && typeof data === 'string' && data.length === 6) setReferral(data);
      else setError('Unable to verify your invitation code. Please check your invite link.');
    }).catch(() => {
      if (active) setError('Unable to verify your invitation code. Please try again.');
    });
    return () => { active = false; };
  }, []);

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    const rawReferral = new URLSearchParams(window.location.search).get('ref');
    const code = referralCode(rawReferral);
    if (rawReferral !== null && !code) {
      setError("Invalid invitation link. Please ask your inviter for a new link.");
      return;
    }

    if (!/^09[0-9]{9}$/.test(phone)) {
      setError("Enter exactly 11 digits starting with 09.");
      return;
    }
    const formattedPhone = "+63" + phone.slice(1);

    if (password.length < 6) {
      setError("Use a password with at least 6 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const { data, error: authError } =
        await supabase.auth.signUp({
          phone: formattedPhone,
          password,
          ...(code ? { options: { data: { referral_code: referral || code } } } : {}),
        });

      if (authError) {
        const duplicate = authError.code === "phone_exists" ||
          authError.code === "user_already_exists" ||
          /^user already registered\.?$/i.test(authError.message);
        setError(duplicate ? "This mobile number is already registered. Please sign in." : authError.message);
        return;
      }

      if (!data.user || (!data.session && data.user.identities?.length === 0)) {
        setError("Unable to register this mobile number. If you already have an account, please sign in.");
        return;
      }

      if (data.session) {
        router.replace("/dashboard");
        router.refresh();
      } else {
        setMessage(
          "Account created. Complete any required verification before signing in."
        );
      }
    } catch {
      setError("Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="unify-login">
      <ThemeWelcome/>
      <form
        className="unify-login-card"
        onSubmit={handleRegister}
      >
        <AureviaLogo className="aurevia-login-logo" />
        <h1>AROMEVA</h1>
        <p>Create your account</p>
        <p style={{ color: "#cbd5e1", fontSize: 13, lineHeight: 1.5 }}>₱20 registration bonus is credited automatically when business funding is available. An unspent bonus may be reclaimed if there is no completed deposit or approved identity verification.</p>

        {error && (
          <div className="unify-login-error" role="alert">
            {error}
          </div>
        )}

        {message && <p role="status">{message}</p>}

        <label htmlFor="phone">Mobile Number</label>
        <input
          id="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          pattern="09[0-9]{9}"
          title="Enter exactly 11 digits starting with 09."
          aria-describedby="phone-format"
          placeholder="09123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onInvalid={() => setError("Enter exactly 11 digits starting with 09.")}
          required
        />
        <p id="phone-format">Enter 11 digits starting with 09.</p>


<label htmlFor="password">Password</label>

<div className="password-wrapper">
  <input
    id="password"
    type={showPassword ? "text" : "password"}
    autoComplete="new-password"
    minLength={6}
    placeholder="Enter your password"
    value={password}
    onChange={(e) => setPassword(e.target.value)}
    required
  />

  <button
    type="button"
    className="password-toggle"
    onClick={() => setShowPassword(!showPassword)}
    aria-label={showPassword ? "Hide password" : "Show password"}
    aria-pressed={showPassword}
  >
    {showPassword ? <EyeOff size={21} /> : <Eye size={21} />}
  </button>
</div>

<label htmlFor="confirm">Confirm Password</label>

<div className="password-wrapper">
  <input
    id="confirm"
    minLength={6}
    type={showConfirmPassword ? "text" : "password"}
    autoComplete="new-password"
    placeholder="Confirm your password"
    value={confirmPassword}
    onChange={(e) => setConfirmPassword(e.target.value)}
    required
  />

  <button
    type="button"
    className="password-toggle"
    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
    aria-label={
      showConfirmPassword ? "Hide confirm password" : "Show confirm password"
    }
    aria-pressed={showConfirmPassword}
  >
    {showConfirmPassword ? <EyeOff size={21} /> : <Eye size={21} />}
  </button>
</div>


        {referral && <div className="unify-registration-referral"><span>Invitation code</span><strong>{referral}</strong></div>}

        <button type="submit" disabled={loading}>
          {loading ? "Creating Account..." : "Register"}
        </button>

        <p>
          Already have an account?{" "}
          <Link href="/login">Login Here</Link>
        </p>
      </form>
    </main>
  );
}
