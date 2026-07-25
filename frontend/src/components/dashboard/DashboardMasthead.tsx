import { Skeleton } from "@/components/ui/skeleton";

/**
 * The Dashboard's briefing masthead — the product's ONE gradient surface.
 *
 * A headline sentence is the hero; the two KPI tiles support it at 28px. This
 * ordering is deliberate (see DESIGN.md → The Masthead-Not-Metric Rule): the
 * anti-reference is the SaaS "big gradient number" layout, which is this exact
 * banner inverted — a giant number as hero with the sentence demoted. Don't
 * enlarge the tiles or drop the sentence.
 *
 * The gradient and glow are built from the brand tokens, so the banner is
 * theme-aware (light/dark) and would follow a future accent switch for free —
 * it belongs to the screen, not to any one accent variant.
 */
const gradient =
  "linear-gradient(105deg, var(--brand-hover), var(--brand) 55%, color-mix(in srgb, var(--brand) 60%, #ffffff))";
const glow = "0 18px 40px -18px color-mix(in srgb, var(--brand) 55%, transparent)";

function Kpi({ value, label, loading }: { value: string; label: string; loading: boolean }) {
  return (
    <div
      className="min-w-[104px] rounded-xl px-5 py-3.5 text-center"
      style={{ background: "rgba(0,0,0,0.2)" }}
    >
      {loading ? (
        <Skeleton className="mx-auto h-7 w-16 bg-white/20" />
      ) : (
        <div className="font-mono text-[28px] font-semibold leading-none tabular-nums text-white">
          {value}
        </div>
      )}
      <div className="mt-1.5 text-[11px] font-medium uppercase leading-none tracking-wide text-white/80">
        {label}
      </div>
    </div>
  );
}

export function DashboardMasthead({
  listings,
  suppliers,
  loading = false,
}: {
  listings: number | undefined;
  suppliers: number | undefined;
  loading?: boolean;
}) {
  const fmt = (n: number | undefined) => (n == null ? "—" : n.toLocaleString());

  return (
    <div
      className="relative mb-6 overflow-hidden rounded-card p-7"
      style={{ background: gradient, boxShadow: glow }}
    >
      {/* Dotted radial texture — decorative only. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-6">
        <div className="max-w-xl">
          <span
            className="mb-3 inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold uppercase leading-none tracking-wider text-white"
            style={{ background: "rgba(0,0,0,0.22)" }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-white" />
            Live catalog
          </span>
          <h2 className="text-pretty text-[24px] font-semibold leading-[1.2] tracking-tight text-white">
            Every supplier&rsquo;s brochure, priced and searchable.
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-white/80">
            Ask in plain language, compare trade names, and export the cheapest
            match in seconds.
          </p>
        </div>
        <div className="flex shrink-0 gap-3">
          <Kpi value={fmt(listings)} label="Listings" loading={loading} />
          <Kpi value={fmt(suppliers)} label="Suppliers" loading={loading} />
        </div>
      </div>
    </div>
  );
}
