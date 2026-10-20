
"use client";
import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

    const cleaned = phone.replace(/\D/g, "");
    let formattedPhone: string;

    if (/^09\d{9}$/.test(cleaned)) {
      formattedPhone = "+63" + cleaned.slice(1);
    } else if (/^639\d{9}$/.test(cleaned)) {
      formattedPhone = "+" + cleaned;
    } else {
      setError("Enter a valid Philippine mobile number.");
      return;
    }

    if (password.length < 12) {
      setError("Use a password with at least 12 characters.");
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
        });

      if (authError) {
        setError(authError.message);
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
      <form
        className="unify-login-card"
        onSubmit={handleRegister}
      >
        <div className="unify-login-logo">◆</div>
        <h1>UNIFY</h1>
        <p>Create your account</p>

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
          autoComplete="tel"
          placeholder="09123456789"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />


<label htmlFor="password">Password</label>

<div className="password-wrapper">
  <input
    id="password"
    type={showPassword ? "text" : "password"}
    autoComplete="new-password"
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
