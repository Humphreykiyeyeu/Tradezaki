"use client";

/**
 * One headline number.
 *
 * A stat tile rather than a one-bar chart: when the data is a single current
 * value, the number *is* the visualisation, and drawing a bar beside it adds
 * ink without adding information.
 *
 * `hint` exists because half of these metrics are jargon to someone who has not
 * traded professionally, and a dashboard that shows "Profit factor 1.82" without
 * saying what good looks like is decoration.
 */
export default function StatTile({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "neutral";
  hint?: string;
}) {
  return (
    <div className="group relative border border-line rounded-xl p-3.5 bg-panel/60 hover:border-line/80 transition">
      <div className="flex items-center gap-1.5 mb-1.5">
        <p className="font-mono text-[9px] uppercase tracking-widest text-mist">{label}</p>
        {hint && (
          <span
            tabIndex={0}
            role="note"
            aria-label={hint}
            className="w-3.5 h-3.5 rounded-full border border-line text-mist grid place-items-center text-[8px] cursor-help shrink-0 focus:outline-none focus:border-signal"
          >
            ?
          </span>
        )}
      </div>

      <p
        className={`font-display font-bold text-xl leading-none tabular-nums ${
          tone === "up" ? "text-signal" : tone === "down" ? "text-danger" : "text-[#E7ECE9]"
        }`}
      >
        {value}
      </p>

      {sub && <p className="font-mono text-[10px] text-mist mt-1.5 truncate">{sub}</p>}

      {hint && (
        <span className="pointer-events-none absolute left-3 right-3 bottom-full mb-1 z-20 hidden group-hover:block group-focus-within:block px-2.5 py-1.5 rounded-md border border-line bg-ink/95 backdrop-blur text-[10px] leading-relaxed text-mist shadow-xl">
          {hint}
        </span>
      )}
    </div>
  );
}
