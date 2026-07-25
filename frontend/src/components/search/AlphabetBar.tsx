import { forwardRef, useEffect, useRef } from "react";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * A-Z tabs for alphabet pagination. "All" clears the letter filter. Each
 * letter restricts results to chemicals whose English name starts with it;
 * the page count adapts per letter (a letter with 50 items has more pages
 * than one with 20).
 *
 * 27 buttons never fit one phone row at a thumb-sized target, so below lg the
 * bar is a single horizontally scrollable strip (snapped, edge-faded, 44px
 * targets). At lg and up it wraps into the block it always was. The active
 * letter is scrolled back into view so returning to the page doesn't strand
 * the selection off-screen.
 */
export function AlphabetBar({
  value,
  onChange,
}: {
  value: string | null; // lowercase letter or null for All
  onChange: (letter: string | null) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const strip = stripRef.current;
    const active = activeRef.current;
    if (!strip || !active) return;
    // Only correct the strip's own scroll — never the page's.
    const { left: sl, right: sr } = strip.getBoundingClientRect();
    const { left: al, right: ar } = active.getBoundingClientRect();
    if (al < sl || ar > sr) {
      strip.scrollTo({
        left: active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2,
        behavior: "smooth",
      });
    }
  }, [value]);

  return (
    <div
      ref={stripRef}
      className="scroll-strip -mx-1 flex gap-1 px-1 pb-1 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0"
      role="group"
      aria-label="Browse by first letter"
    >
      <LetterButton
        label="All"
        active={value === null}
        onClick={() => onChange(null)}
        wide
        ref={value === null ? activeRef : undefined}
      />
      {LETTERS.map((letter) => {
        const isActive = value === letter.toLowerCase();
        return (
          <LetterButton
            key={letter}
            label={letter}
            active={isActive}
            onClick={() => onChange(letter.toLowerCase())}
            ref={isActive ? activeRef : undefined}
          />
        );
      })}
    </div>
  );
}

const LetterButton = forwardRef<
  HTMLButtonElement,
  { label: string; active: boolean; onClick: () => void; wide?: boolean }
>(({ label, active, onClick, wide }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={[
      // Full 44px on touch, tightened to the original 32px for mouse users so
      // the desktop bar stays as compact as it was.
      "h-11 shrink-0 rounded-btn border text-xs font-medium transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
      "[@media(pointer:fine)]:h-8",
      wide ? "px-4 [@media(pointer:fine)]:px-3" : "w-11 [@media(pointer:fine)]:w-8",
      active
        ? "border-brand bg-brand text-on-brand"
        : "border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-muted",
    ].join(" ")}
  >
    {label}
  </button>
));
LetterButton.displayName = "LetterButton";
