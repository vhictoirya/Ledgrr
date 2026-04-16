"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Dashboard } from "@/components/Dashboard";
import { LandingHero } from "@/components/LandingHero";

export default function Home() {
  const { ready, authenticated } = usePrivy();

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return authenticated ? <Dashboard /> : <LandingHero />;
}
