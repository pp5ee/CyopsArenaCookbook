/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        arena: {
          bg: "#0A0E17",
          surface: "#111827",
          "surface-hover": "#1a2332",
          border: "#1E293B",
          accent: "#06B6D4",
          "accent-glow": "#22D3EE",
          text: "#E2E8F0",
          muted: "#94A3B8",
          danger: "#F43F5E",
          "danger-dim": "#7F1D1D",
          success: "#10B981",
          "success-dim": "#064E3B",
          warning: "#F59E0B",
        },
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(to bottom, rgba(10,14,23,0.4), rgba(10,14,23,0.95))",
      },
      boxShadow: {
        "glow-accent": "0 0 15px rgba(6,182,212,0.35)",
        "glow-accent-lg": "0 0 30px rgba(6,182,212,0.5)",
      },
    },
  },
  plugins: [],
};
