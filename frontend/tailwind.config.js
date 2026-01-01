/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      boxShadow: {
        glass: "0 10px 30px rgba(0,0,0,0.35)",
      },
    },
  },
  plugins: [],
};
