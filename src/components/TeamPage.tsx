
"use client";

import { useEffect, useState } from "react";
import { Copy, Users, Check, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";

type Member = {
  id: string;
  full_name: string | null;
  created_at: string;
};

export default function TeamPage({
  userId
}: {
  userId: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadTeam() {
      const { data: profile, error: profileError } =
        await supabase
          .from("profiles")
          .select("invite_code")
          .eq("id", userId)
          .single();

      if (profileError) {
        setError(profileError.message);
        return;
      }

      setCode(profile?.invite_code || "");

      const { data, error: membersError } = await supabase
        .from("team_members")
        .select("id, full_name, created_at")
        .eq("invited_by", userId)
        .order("created_at", { ascending: false });

      if (membersError) {
        setError(membersError.message);
        return;
      }

      setMembers(data || []);
    }

    loadTeam();
  }, [userId]);

  const inviteLink = code && typeof window !== "undefined"
    ? `${window.location.origin}/?ref=${encodeURIComponent(code)}`
    : "";

  async function copyLink() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
    } catch {
      setError("Unable to copy. Please copy the link manually.");
    }
  }

  return (
    <div className="team-page">
      <div className="page-heading">
        <h2>My Team</h2>
        <p>Invite friends to explore Vault Invest Demo.</p>
      </div>

      <section className="team-panel">
        <h3>Invite Link</h3>
        <div className="invite-link">
          {inviteLink || "Loading invitation link..."}
        </div>
        <button
          className="invite-button"
          onClick={copyLink}
          disabled={!inviteLink}
        >
          {copied ? <Check size={20} /> : <Copy size={20} />}
          {copied ? "Copied!" : "Copy Invite Link"}
        </button>
        <p className="simulation-note">
          Invitations are for educational access only.
          No referral commissions or monetary rewards.
        </p>
      </section>

      <section className="team-stats-card">
        <div className="team-gradient">
          <Users size={26} />
          <span>MY DEMO COMMUNITY</span>
          <h2>{members.length} Members</h2>
        </div>
        <div className="team-stat-grid">
          <div>
            <strong>{members.length}</strong>
            <span>INVITED</span>
          </div>
          <div>
            <strong>{members.length}</strong>
            <span>REGISTERED</span>
          </div>
          <div>
            <strong>0</strong>
            <span>REWARDS</span>
          </div>
        </div>
      </section>

      <section className="team-members">
        <div className="section-heading">
          <h3>Members</h3>
          <span>{members.length} users</span>
        </div>

        {error && <p className="notice">{error}</p>}

        {members.length === 0 ? (
          <div className="team-empty">
            <UserPlus size={36} />
            <h3>No members yet</h3>
            <p>Share your invite link with friends.</p>
          </div>
        ) : (
          members.map(member => (
            <div className="member-row" key={member.id}>
              <div className="member-avatar">
                <Users size={19} />
              </div>
              <div>
                <strong>{member.full_name || "Demo Member"}</strong>
                <span>
                  Joined {new Date(member.created_at)
                    .toLocaleDateString()}
                </span>
              </div>
              <span className="member-status">Joined</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
