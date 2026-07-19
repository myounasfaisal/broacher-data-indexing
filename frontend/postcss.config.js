export default {
  // Tailwind v4 is processed by @tailwindcss/vite (see vite.config.ts) and
  // does its own vendor-prefixing via Lightning CSS — so NO `tailwindcss`
  // PostCSS plugin here (running the v3 plugin on top of v4 double-processed
  // the CSS and broke @apply for custom tokens like bg-ink-50).
  plugins: {},
};
