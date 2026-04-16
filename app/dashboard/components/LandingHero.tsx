"use client";

import { usePrivy } from "@privy-io/react-auth";

export function LandingHero() {
  const { login } = usePrivy();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-4 bg-gray-950">
      {/* Grid background */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] opacity-30" />

      <div className="relative z-10 text-center max-w-3xl">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-sm mb-8">
          <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
          DePIN Network · Powered by x402
        </div>

        <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6 bg-gradient-to-br from-white via-gray-200 to-gray-500 bg-clip-text text-transparent">
          Stripe for x402
        </h1>

        <p className="text-xl text-gray-400 mb-4 max-w-2xl mx-auto leading-relaxed">
          Run a facilitator node. Stake tokens. Earn <span className="text-indigo-400 font-semibold">0.07%</span> on every
          micropayment you route — permissionlessly, on Solana.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-6 mb-12 text-sm text-gray-500">
          <Stat label="Network Fee" value="0.05–0.1%" />
          <span className="text-gray-700">·</span>
          <Stat label="Facilitator Share" value="80%" />
          <span className="text-gray-700">·</span>
          <Stat label="Protocol Cut" value="20%" />
          <span className="text-gray-700">·</span>
          <Stat label="Unstake Timelock" value="7 days" />
        </div>

        {/* CTA */}
        <button
          onClick={login}
          className="px-8 py-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-lg transition-all duration-200 shadow-lg shadow-indigo-900/40 hover:shadow-indigo-800/60"
        >
          Connect Wallet to Run a Node
        </button>

        <p className="mt-4 text-sm text-gray-600">
          Supports Phantom, Backpack, Solflare, or Privy embedded wallet
        </p>

        {/* Feature grid */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-4 text-left">
          <FeatureCard
            icon="⚡"
            title="Instant Settlement"
            desc="Fees credited on-chain per payment. Claim rewards anytime."
          />
          <FeatureCard
            icon="🔒"
            title="Slashing Protection"
            desc="Stake acts as collateral. Bad actors lose stake via governance."
          />
          <FeatureCard
            icon="🌐"
            title="Any API, Any Chain"
            desc="Route payments on Solana, Base, or Ethereum via x402 protocol."
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-gray-400">{label}: </span>
      <span className="text-white font-medium">{value}</span>
    </span>
  );
}

function FeatureCard({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/50 p-5">
      <div className="text-2xl mb-3">{icon}</div>
      <h3 className="font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{desc}</p>
    </div>
  );
}
