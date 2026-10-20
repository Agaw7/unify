
"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function formatPhone(value: string): string | null {
  const cleaned = value.replace(/\D/g, "");

  if (/^09\d{9}$/.test(cleaned)) {
    return "+63" + cleaned.slice(1);
  }

  if (/^639\d{9}$/.test(cleaned)) {
    return "+" + cleaned;
  }

  return null;
}

export default function LoginPage() {
  const router = useRouter();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;

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

      if (authError || !data.session) {
        setError("Invalid mobile number or password.");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Unable to log in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="unify-login">
      <form
        className="unify-login-card"
        onSubmit={handleLogin}
      >
        <div className="unify-login-logo">◆</div>

        <h1>UNIFY</h1>
        <p>Sign in to your account</p>

        {error && (
          <div className="unify-login-error" role="alert">
            {error}
          </div>
        )}

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
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="Enter your password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>

        <p style={{ marginTop: "20px" }}>
          Don&apos;t have an account?{" "}
          <a href="/register" style={{ color: "#00D2FF" }}>
            Register Here
          </a>
        </p>

        <small>UNIFY</small>
      </form>
    </main>
  );
}
