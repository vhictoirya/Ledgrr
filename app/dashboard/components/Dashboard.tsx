"use client";

import { useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useFacilitator, useNodeActions, useEarningsHistory } from "@/hooks/useFacilitator";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const MIN_STAKE = 1_000_000_000n; // 1,000 tokens (6 decimals)

function formatTokens(units: string | number): string {
  return (Number(units) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function formatUsdc(units: string | number): string {
  const n = BigInt(String(units).split(".")[0]);
  return `${(n / 1_000_000n).toLocaleString()}.${String(n % 1_000_000n).padStart(6, "0").slice(0, 2)}`;
}

export function Dashboard() {
  const { logout } = usePrivy();
  const {
    facilitatorState: state,
    networkConfig,
    activeFacilitators,
    loading,
    error,
    refresh,
    walletAddress,
  } = useFacilitator();

  const {
    register,
    claimRewards,
    addStake,
    requestUnstake,
    withdrawStake,
    txLoading,
    txError,
    lastTx,
  } = useNodeActions();

  const earningsHistory = useEarningsHistory();

  // Register modal state
  const [showRegister, setShowRegister] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [stakeInput, setStakeInput] = useState("1000");

  const isActive = state?.status === "active";
  const isUnstaking = state?.status === "unstaking";
  const isRegistered = !!state;

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            X
          </div>
          <span className="font-semibold text-white">x402 Network</span>
          <span className="text-gray-600 text-sm">/ Facilitator Dashboard</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 font-mono">
            {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "—"}
          </span>
          <button
            onClick={refresh}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white transition"
          >
            Refresh
          </button>
          <button
            onClick={logout}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-700 text-gray-400 hover:border-red-700 hover:text-red-400 transition"
          >
            Disconnect
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Errors */}
        {(error || txError) && (
          <div className="rounded-xl border border-red-800 bg-red-900/20 px-4 py-3 text-red-400 text-sm">
            {error ?? txError}
          </div>
        )}

        {/* Last tx toast */}
        {lastTx && (
          <div className="rounded-xl border border-green-800 bg-green-900/20 px-4 py-3 text-green-400 text-sm flex items-center justify-between">
            <span>Transaction confirmed</span>
            <span className="font-mono text-xs">{lastTx.slice(0, 20)}…</span>
          </div>
        )}

        {/* Node status row */}
        <div className="flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isActive ? "bg-green-400 animate-pulse" : "bg-gray-600"
            }`}
          />
          <span className="text-sm text-gray-400">
            Status:{" "}
            <span className={isActive ? "text-green-400" : "text-gray-500"}>
              {state?.status ?? (loading ? "loading…" : "not registered")}
            </span>
          </span>
          {networkConfig && (
            <span className="text-xs text-gray-600">
              · Network fee: {networkConfig.feeBps / 100}% · {networkConfig.totalFacilitators} nodes ·{" "}
              {formatTokens(networkConfig.totalStaked)} X402 staked
            </span>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Staked"
            value={state ? `${formatTokens(state.stakedAmount)} X402` : "—"}
            sub="your stake"
            color="indigo"
          />
          <StatCard
            label="Pending Rewards"
            value={state ? `$${formatUsdc(state.pendingRewards)}` : "—"}
            sub="claimable USDC"
            color="green"
          />
          <StatCard
            label="Total Earned"
            value={state ? `$${formatUsdc(state.totalEarned)}` : "—"}
            sub="all time"
            color="purple"
          />
          <StatCard
            label="Payments Routed"
            value={state ? Number(state.paymentsRouted).toLocaleString() : "—"}
            sub="all time"
            color="yellow"
          />
        </div>

        {/* Chart */}
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-6">
            Earnings — last 30 days
          </h2>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={earningsHistory}>
              <defs>
                <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" tick={{ fill: "#6b7280", fontSize: 11 }} />
              <YAxis tick={{ fill: "#6b7280", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8 }}
                labelStyle={{ color: "#9ca3af" }}
                itemStyle={{ color: "#e5e7eb" }}
              />
              <Area type="monotone" dataKey="earned" stroke="#6366f1" strokeWidth={2} fill="url(#eg)" name="USDC" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Actions */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 space-y-3">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Node Actions
            </h2>

            {/* Register */}
            {!isRegistered && (
              <ActionButton
                label="Register as Facilitator"
                desc="Stake X402 tokens and go live"
                variant="primary"
                loading={txLoading === "register"}
                onClick={() => setShowRegister(true)}
              />
            )}

            {/* Claim rewards */}
            <ActionButton
              label="Claim Rewards"
              desc={state ? `$${formatUsdc(state.pendingRewards)} USDC pending` : "No pending rewards"}
              variant="success"
              disabled={!isActive || state?.pendingRewards === "0"}
              loading={txLoading === "claim"}
              onClick={async () => {
                await claimRewards();
                refresh();
              }}
            />

            {/* Add stake */}
            <AddStakeButton
              loading={txLoading === "addStake"}
              disabled={!isActive}
              onSubmit={async (amount) => {
                await addStake(amount);
                refresh();
              }}
            />

            {/* Request unstake */}
            <ActionButton
              label="Request Unstake"
              desc="Starts 7-day timelock before withdrawal"
              variant="danger"
              disabled={!isActive}
              loading={txLoading === "unstake"}
              onClick={async () => {
                if (!confirm("Start the 7-day unstake timelock?")) return;
                await requestUnstake();
                refresh();
              }}
            />

            {/* Withdraw */}
            {isUnstaking && (
              <ActionButton
                label="Withdraw Stake"
                desc={`Available after ${new Date(
                  (state!.registeredAt + 7 * 86400) * 1000
                ).toLocaleDateString()}`}
                variant="default"
                loading={txLoading === "withdraw"}
                onClick={async () => {
                  await withdrawStake();
                  refresh();
                }}
              />
            )}
          </div>

          {/* Facilitator network */}
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
              Network ({activeFacilitators.length} active nodes)
            </h2>
            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {activeFacilitators.length === 0 && (
                <p className="text-sm text-gray-600">No active facilitators found on-chain.</p>
              )}
              {activeFacilitators.map((f) => (
                <div
                  key={f.address}
                  className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                >
                  <div>
                    <p className="text-sm font-mono text-white">
                      {f.address.slice(0, 8)}…{f.address.slice(-6)}
                      {f.address === walletAddress && (
                        <span className="ml-2 text-xs text-indigo-400">(you)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">{f.endpoint}</p>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <p className="text-xs text-gray-400">{formatTokens(f.stakedAmount)} X402</p>
                    <p className="text-xs text-green-500">{f.status}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <IntegrationSnippet />
      </main>

      {/* Register modal */}
      {showRegister && (
        <RegisterModal
          onClose={() => setShowRegister(false)}
          onSubmit={async (ep, stake) => {
            await register(ep, stake);
            setShowRegister(false);
            refresh();
          }}
          loading={txLoading === "register"}
          endpoint={endpoint}
          setEndpoint={setEndpoint}
          stakeInput={stakeInput}
          setStakeInput={setStakeInput}
        />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, color,
}: {
  label: string; value: string; sub: string;
  color: "indigo" | "green" | "purple" | "yellow";
}) {
  const borders = { indigo: "border-indigo-900/50", green: "border-green-900/50", purple: "border-purple-900/50", yellow: "border-yellow-900/50" };
  const colors = { indigo: "text-indigo-300", green: "text-green-300", purple: "text-purple-300", yellow: "text-yellow-300" };
  return (
    <div className={`rounded-2xl border ${borders[color]} bg-gray-900/40 p-5`}>
      <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-bold ${colors[color]}`}>{value}</p>
      <p className="text-xs text-gray-600 mt-1">{sub}</p>
    </div>
  );
}

function ActionButton({
  label, desc, variant, disabled, loading, onClick,
}: {
  label: string; desc: string;
  variant: "primary" | "success" | "default" | "danger";
  disabled?: boolean; loading?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    primary: "border-indigo-700 text-indigo-300 hover:bg-indigo-900/30",
    success: "border-green-700 text-green-300 hover:bg-green-900/30",
    default: "border-gray-700 text-gray-300 hover:bg-gray-800",
    danger: "border-red-900 text-red-400 hover:bg-red-900/20",
  };
  return (
    <button
      disabled={disabled || loading}
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-xl border transition disabled:opacity-30 disabled:cursor-not-allowed ${styles[variant]}`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
        </div>
        {loading && (
          <div className="w-4 h-4 border border-current border-t-transparent rounded-full animate-spin opacity-60" />
        )}
      </div>
    </button>
  );
}

function AddStakeButton({
  disabled, loading, onSubmit,
}: {
  disabled?: boolean; loading?: boolean;
  onSubmit: (amount: bigint) => void;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("500");

  if (!open) {
    return (
      <ActionButton
        label="Add Stake"
        desc="Increase stake to boost reputation"
        variant="default"
        disabled={disabled}
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <div className="border border-gray-700 rounded-xl p-4 space-y-3">
      <p className="text-sm font-medium text-gray-300">Add Stake</p>
      <div className="flex gap-2">
        <input
          type="number"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="tokens"
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
        />
        <button
          disabled={loading}
          onClick={() => {
            onSubmit(BigInt(Math.floor(parseFloat(val) * 1_000_000)));
            setOpen(false);
          }}
          className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50"
        >
          {loading ? "…" : "Stake"}
        </button>
        <button onClick={() => setOpen(false)} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-300">
          Cancel
        </button>
      </div>
    </div>
  );
}

function RegisterModal({
  onClose, onSubmit, loading, endpoint, setEndpoint, stakeInput, setStakeInput,
}: {
  onClose: () => void;
  onSubmit: (endpoint: string, stake: bigint) => void;
  loading?: boolean;
  endpoint: string; setEndpoint: (v: string) => void;
  stakeInput: string; setStakeInput: (v: string) => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md space-y-5">
        <h2 className="text-lg font-semibold text-white">Register as Facilitator</h2>

        <div className="space-y-4">
          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Node Endpoint URL
            </label>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-node.example.com"
              className="mt-1.5 w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400 uppercase tracking-wider">
              Stake Amount (X402 tokens, min 1,000)
            </label>
            <input
              type="number"
              value={stakeInput}
              onChange={(e) => setStakeInput(e.target.value)}
              min="1000"
              className="mt-1.5 w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm text-white outline-none focus:border-indigo-500"
            />
            <p className="text-xs text-gray-600 mt-1">
              = {Number(stakeInput).toLocaleString()} X402 tokens (6 decimals ={" "}
              {(Number(stakeInput) * 1_000_000).toLocaleString()} base units)
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            disabled={loading || !endpoint || Number(stakeInput) < 1000}
            onClick={() =>
              onSubmit(endpoint, BigInt(Math.floor(Number(stakeInput) * 1_000_000)))
            }
            className="flex-1 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <span className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
                Submitting…
              </>
            ) : (
              "Register & Stake"
            )}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 rounded-xl border border-gray-700 text-gray-400 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IntegrationSnippet() {
  const [tab, setTab] = useState<"express" | "next" | "curl">("express");

  const snippets = {
    express: `import { createX402Middleware } from "@x402-network/sdk";

app.use("/api/premium",
  createX402Middleware({
    price: "1000000",        // 1 USDC (6 decimals)
    recipient: "YOUR_ADDR",
    facilitatorUrl: "https://node1.x402.network",
    currency: "USDC",
    network: "base-sepolia",
  })
);`,
    next: `import { withX402 } from "@x402-network/sdk";

export default withX402(
  async (req, res) => {
    res.json({ data: "premium content" });
  },
  {
    price: "1000000",
    recipient: "YOUR_ADDR",
    facilitatorUrl: "https://node1.x402.network",
  }
);`,
    curl: `# Get 402 challenge
curl https://api.yoursite.com/premium

# Client pays on Base Sepolia → encodes tx as X-Payment header
# Re-request with payment:
curl https://api.yoursite.com/premium \\
  -H "X-Payment: <base64-encoded-payload>"`,
  };

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        Merchant Integration
      </h2>
      <div className="flex gap-2 mb-4">
        {(["express", "next", "curl"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs rounded-lg transition ${
              tab === t
                ? "bg-indigo-600 text-white"
                : "border border-gray-700 text-gray-400 hover:text-white"
            }`}
          >
            {t === "express" ? "Express" : t === "next" ? "Next.js" : "cURL"}
          </button>
        ))}
      </div>
      <pre className="text-xs text-gray-300 overflow-x-auto leading-relaxed bg-gray-950 rounded-xl p-4">
        <code>{snippets[tab]}</code>
      </pre>
    </div>
  );
}
