import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Evolution OS futuristic palette
        void: "#05060f",
        surface: "#0b0e1f",
        panel: "#10142b",
        accent: "#22d3ee", // cyan
        accent2: "#a855f7", // purple
        accent3: "#ec4899", // pink
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 20px rgba(34, 211, 238, 0.35)",
        "glow-purple": "0 0 24px rgba(168, 85, 247, 0.35)",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
        floatUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseGlow: "pulseGlow 1.4s ease-in-out infinite",
        floatUp: "floatUp 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
