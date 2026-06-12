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
        cyber: {
          pink: "#FF2D95",
          "pink-glow": "#FF69B4",
          purple: "#B026FF",
          "purple-glow": "#D05CFF",
          green: "#39FF14",
          "green-glow": "#7CFF5E",
          blue: "#00D4FF",
          "blue-glow": "#33E0FF",
          gold: "#FFD700",
        },
      },
      backgroundImage: {
        "hero-gradient":
          "linear-gradient(to bottom, rgba(10,14,23,0.4), rgba(10,14,23,0.95))",
        "cyber-gradient":
          "linear-gradient(135deg, rgba(6,182,212,0.1) 0%, rgba(176,38,255,0.05) 50%, rgba(255,45,149,0.08) 100%)",
      },
      boxShadow: {
        "glow-accent": "0 0 15px rgba(6,182,212,0.35)",
        "glow-accent-lg": "0 0 30px rgba(6,182,212,0.5)",
        "glow-pink": "0 0 15px rgba(255,45,149,0.35)",
        "glow-purple": "0 0 15px rgba(176,38,255,0.35)",
        "glow-green": "0 0 15px rgba(57,255,20,0.3)",
      },
      animation: {
        "glow-pulse": "glow-pulse 2s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.6s ease-out forwards",
        "bubble-in": "bubble-in 0.3s ease-out forwards",
        "shatter-out": "shatter-out 1.2s ease-in forwards",
        "vote-slide-in": "vote-slide-in 0.4s ease-out forwards",
        "draw-line": "draw-line 2s ease-out forwards",
      },
    },
  },
  plugins: [],
};
