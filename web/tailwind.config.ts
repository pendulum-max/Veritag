import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        stellar: {
          50: "#f0f7ff",
          100: "#e0effe",
          500: "#2563eb",
          600: "#1d4ed8",
          900: "#0f172a",
        },
      },
    },
  },
  plugins: [],
};

export default config;
