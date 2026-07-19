/** @type {import('tailwindcss').Config} */
export default {
  // shadcn/ui expects a "darkMode" class strategy and content globs
  // covering every place Tailwind class names appear. The app itself is
  // light-only (a calm, data-dense internal tool), but the strategy is
  // kept so class-gated dark styles remain possible later.
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // Committed everywhere via the base layer in index.css. Geist for the
        // whole UI (one calm, precise superfamily), Geist Mono for data.
        sans: [
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      colors: {
        // --- Neutral "ink" scale (cool, slightly blue-grey — NOT Tailwind
        // slate). The app's calm surface + text system. ---
        ink: {
          50: "#F6F7F9",
          100: "#ECEEF2",
          200: "#DDE1E8",
          300: "#C4CBD5",
          400: "#98A2B1",
          500: "#6B7688",
          600: "#4E5768",
          700: "#3A4150",
          800: "#262C38",
          900: "#171B24",
          950: "#0F1219",
        },
        // --- Brand accent: a deep teal-cyan. Scientific, calm, confident.
        // Used for primary actions, links, and key data (price chips). ---
        brand: {
          50: "#E8F6F4",
          100: "#CBEBE7",
          200: "#9CD8D1",
          300: "#66C0B7",
          400: "#33A79C",
          500: "#158C82",
          600: "#0F7A72", // primary fill (white text ≈ 4.8:1)
          700: "#0B615A", // hover / data text on light (≈ 6.5:1)
          800: "#0B4E48",
          900: "#0C403B",
        },
        // --- Semantic states (custom, cohesive with the neutral scale). ---
        success: {
          50: "#E9F7EF",
          100: "#CDEBD9",
          600: "#12855A",
          700: "#0E6D4A",
        },
        warning: {
          50: "#FCF3E6",
          100: "#F7E2BF",
          600: "#B4791A",
          700: "#8F5E12",
        },
        danger: {
          50: "#FCECEC",
          100: "#F6D2D2",
          600: "#C6413B",
          700: "#A5322D",
        },
      },
      borderRadius: {
        // Named radii so intent reads in the class list.
        chip: "7px",
        btn: "10px",
        card: "14px",
        panel: "18px",
      },
      boxShadow: {
        // Soft elevation for cards/panels; deeper "pop" for overlays.
        card: "0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)",
        "card-hover":
          "0 4px 12px -2px rgb(16 24 40 / 0.10), 0 2px 6px -2px rgb(16 24 40 / 0.06)",
        pop: "0 12px 32px -8px rgb(16 24 40 / 0.20), 0 4px 12px -4px rgb(16 24 40 / 0.12)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)",
      },
    },
  },
  plugins: [],
};
