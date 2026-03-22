/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        pm: {
          good:   "#22c55e",   // green  0-15
          fair:   "#eab308",   // yellow 16-35
          mod:    "#f97316",   // orange 36-75
          poor:   "#ef4444",   // red    >75
        },
      },
    },
  },
  plugins: [],
};
