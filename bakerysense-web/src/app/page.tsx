import Link from "next/link";

const STATS = [
  { label: "Forecast accuracy uplift", value: "−27% WAPE", note: "LightGBM q=0.5 vs seasonal-naive" },
  { label: "SKUs beaten baseline", value: "19 / 20", note: "French Bakery Kaggle dataset" },
  { label: "JS↔Python parity", value: "700 / 700", note: "within 1e-4 absolute" },
  { label: "End-to-end latency", value: "~5–15s", note: "Gemma 4 tool-calling turn" },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-20">
      <header className="mb-16 max-w-3xl">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[var(--brand-100)] px-3 py-1 text-xs font-medium text-[var(--brand-900)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--brand-500)]" />
          Gemma 4 Good Hackathon · Retail + Food Waste
        </div>
        <h1 className="text-5xl font-semibold tracking-tight text-[var(--ink)] md:text-6xl">
          AI production copilot for retail chains.
        </h1>
        <p className="mt-6 text-lg text-[var(--ink-muted)]">
          BakerySense combines a quantile demand model with a Gemma 4 agent to tell merchants
          <strong> exactly how much to produce and restock each day</strong>, with plain-language
          explanations grounded in real drivers. Multi-tenant, multi-branch, runs on Cloudflare.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/signin" className="rounded-md bg-[var(--brand-700)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--brand-900)]">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-md border border-[var(--border-strong)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)]">
            Create a tenant
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.label} className="rounded-lg border border-[var(--border)] bg-white p-5 shadow-[var(--shadow-sm)]">
            <div className="text-xs uppercase tracking-wide text-[var(--ink-subtle)]">{s.label}</div>
            <div className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ink)]">{s.value}</div>
            <div className="mt-1 text-xs text-[var(--ink-muted)]">{s.note}</div>
          </div>
        ))}
      </section>

      <section className="mt-16 rounded-lg border border-[var(--border)] bg-white p-6 shadow-[var(--shadow-sm)]">
        <h2 className="text-xl font-semibold">Sample exchange</h2>
        <div className="mt-4 space-y-3 text-sm">
          <div><strong>Manager:</strong> How many TRADITIONAL BAGUETTE should we bake tomorrow at Quito Centro?</div>
          <div><strong>BakerySense:</strong> Bake 135. The model forecasts q=0.7 of 135 units, driven by lag_7=+46 (last Thursday was strong) and rolling_mean_7=+29.</div>
        </div>
      </section>
    </main>
  );
}
