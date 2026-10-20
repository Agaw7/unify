
"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AuthTestPage() {
  const [status, setStatus] = useState("Checking session...");
  const [userId, setUserId] = useState("");

  useEffect(() => {
    async function checkSession() {
      const { data, error } = await supabase.auth.getUser();

      if (error || !data.user) {
        setStatus("Not logged in");
        return;
      }

      setUserId(data.user.id);
      setStatus("Authenticated");
    }

    checkSession();
  }, []);

  return (
    <main style={{
      background: "#0B1320",
      color: "white",
      minHeight: "100vh",
      padding: 40,
    }}>
      <h1>UNIFY Authentication Test</h1>

      <h2>{status}</h2>

      {userId && (
        <p>User ID: {userId}</p>
      )}
    </main>
  );
}
