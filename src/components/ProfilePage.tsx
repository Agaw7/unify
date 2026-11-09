
"use client";

import { useEffect, useState } from "react";
import {
  UserRound, ChevronRight, Trophy, Wallet,
  TrendingUp, History, LogOut, ShieldCheck
} from "lucide-react";
import { supabase } from "@/lib/supabase";

type ProfilePageProps = {
  userId: string;
  onNavigate: (page: string) => void;
};

export default function ProfilePage({
  userId,
  onNavigate
}: ProfilePageProps) {
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => {
    async function loadProfile() {
      const { data: auth } = await supabase.auth.getUser();

      if (auth.user?.id !== userId) return;

      setEmail(auth.user.email || "");
      setVerified(Boolean(auth.user.email_confirmed_at));

      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", userId)
        .single();

      setName(data?.full_name || "");
    }

    loadProfile();
  }, [userId]);

  async function logout() {
    const { error } = await supabase.auth.signOut();
    if (!error) window.location.replace("/login");
  }

  const menuItems = [
    { label: "Ranking", icon: Trophy, page: "ranking" },
    { label: "Virtual Wallet", icon: Wallet, page: "wallet" },
    { label: "Simulated Earnings", icon: TrendingUp, page: "assets" },
    { label: "Deposit", icon: Wallet, page: "wallet" },
    { label: "Withdraw", icon: Wallet, page: "wallet" },
    { label: "Transaction History", icon: History, page: "wallet" }
  ];

  return (
    <div className="profile-page">
      <div className="page-heading">
        <h2>My Profile</h2>
        <p>Manage your AUREVIA account.</p>
      </div>

      <div className="profile-banner">
        <div className="profile-avatar">
          <UserRound size={36} />
        </div>
        <div className="profile-details">
          <span>ACCOUNT</span>
          <h3>{name || "AUREVIA Member"}</h3>
          <p>{email}</p>
          <div className="verification-status">
            <ShieldCheck size={15} />
            {verified ? "Email Verified" : "Email Not Verified"}
          </div>
        </div>
      </div>

      <div className="profile-menu">
        {menuItems.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.label}
              className="profile-menu-item"
              onClick={() => onNavigate(item.page)}
            >
              <Icon size={21} />
              <span>{item.label}</span>
              <ChevronRight size={20} />
            </button>
          );
        })}

        <button
          className="profile-menu-item logout-item"
          onClick={logout}
        >
          <LogOut size={21} />
          <span>Logout</span>
          <ChevronRight size={20} />
        </button>
      </div>
    </div>
  );
}
