"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Users, ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Member = {
  id: string;
  phone: string | null;
  role: string;
  created_at: string | null;
  invite_code: string | null;
};

export default function AdminUsersPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadMembers = useCallback(async () => {
    setRefreshing(true);
    setError("");
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        router.replace("/login");
        return;
      }
      const response = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: "no-store",
      });
      const result: { members?: Member[]; error?: string } = await response.json();
      if (response.status === 403) {
        setError("Administrator access required.");
        return;
      }
      if (!response.ok) throw new Error(result.error || "Unable to load members.");
      setMembers(result.members ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load members.");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, [router]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  return (
    <main style={{ minHeight: "100vh", background: "#0B1F3A", color: "#fff", padding: "24px", fontFamily: "inherit" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <Link href="/admin" style={{ color: "#00D2FF", display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 24 }}>
          <ArrowLeft size={18} /> Back to Admin
        </Link>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <h1 style={{ display: "flex", gap: 10, alignItems: "center" }}><Users /> User Management</h1>
            <p style={{ color: "#9BB5D1" }}>Registered UNIFY members (read-only)</p>
          </div>
          <button type="button" onClick={() => void loadMembers()} disabled={refreshing}
            style={{ padding: "10px 14px", background: "#00C8F8", color: "#061526", border: 0, borderRadius: 9, fontWeight: 700, cursor: "pointer", display: "flex", gap: 8, alignItems: "center" }}>
            <RefreshCw size={16} /> {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </header>
        {error && <p role="alert" style={{ color: "#FF9999" }}>{error}</p>}
        {!error && <p style={{ color: "#9BB5D1" }}>Total members: {members.length}</p>}
        <div style={{ overflowX: "auto", borderRadius: 14, background: "#10243B", marginTop: 18 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680, textAlign: "left" }}>
            <thead><tr>{["Mobile Number", "Role", "Invite Code", "Joined", "User ID"].map((heading) =>
              <th key={heading} style={{ padding: 14, borderBottom: "1px solid #29445F", color: "#9BB5D1" }}>{heading}</th>
            )}</tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id}>
                  <td style={{ padding: 14, borderBottom: "1px solid #29445F" }}>{member.phone ?? "Not available"}</td>
                  <td style={{ padding: 14, borderBottom: "1px solid #29445F" }}>{member.role}</td>
                  <td style={{ padding: 14, borderBottom: "1px solid #29445F" }}>{member.invite_code ?? "—"}</td>
                  <td style={{ padding: 14, borderBottom: "1px solid #29445F" }}>{member.created_at ? new Date(member.created_at).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" }) : "—"}</td>
                  <td style={{ padding: 14, borderBottom: "1px solid #29445F", fontSize: 12 }}>{member.id}</td>
                </tr>
              ))}
              {!loading && members.length === 0 && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center", color: "#9BB5D1" }}>{error ? "No data available." : "No members found."}</td></tr>}
              {loading && <tr><td colSpan={5} style={{ padding: 20, textAlign: "center" }}>Loading members...</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
