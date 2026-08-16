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
        // Real-money accent. Deliberately NOT red: red has one job in a trading
        // interface, which is "you lost money", and wearing it as the badge for
        // an account made a funded trader feel warned at rest. Blue reads as
        // "this is the live one" without implying anything has gone wrong.
        // 7:1 against ink, so dark text sits on it safely.
        ocean: "#5AA0FF",
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
