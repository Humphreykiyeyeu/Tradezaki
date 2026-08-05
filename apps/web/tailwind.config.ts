import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0B0F0E", // page background — near-black, not pure black
        panel: "#121714", // card/panel surface
        line: "#1F2822", // hairline borders
        mist: "#8A9A93", // secondary text
        signal: "#3ED9A0", // primary accent — guardian green
        alert: "#E8A33D", // caution / cooldown amber
        danger: "#E2604F", // loss / stop red
      },
      fontFamily: {
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
