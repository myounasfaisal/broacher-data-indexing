const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

/**
 * A-Z tabs for alphabet pagination. "All" clears the letter filter. Each
 * letter restricts results to chemicals whose English name starts with it;
 * the page count adapts per letter (a letter with 50 items has more pages
 * than one with 20).
 */
export function AlphabetBar({
  value,
  onChange,
}: {
  value: string | null; // lowercase letter or null for All
  onChange: (letter: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      <LetterButton
        label="All"
        active={value === null}
        onClick={() => onChange(null)}
        wide
      />
      {LETTERS.map((letter) => (
        <LetterButton
          key={letter}
          label={letter}
          active={value === letter.toLowerCase()}
          onClick={() => onChange(letter.toLowerCase())}
        />
      ))}
    </div>
  );
}

function LetterButton({
  label,
  active,
  onClick,
  wide,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-8 rounded-btn border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/70",
        wide ? "px-3" : "w-8",
        active
          ? "border-brand bg-brand text-on-brand"
          : "border-line bg-surface text-fg-muted hover:border-line-strong hover:bg-muted",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
