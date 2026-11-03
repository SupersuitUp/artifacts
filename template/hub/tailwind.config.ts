import type { Config } from 'tailwindcss'

export default {
  // The shell's classes live in @supersuit/artifacts (compiled JS); scan it or they vanish at build.
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', './node_modules/@supersuit/artifacts/lib/**/*.js'],
  theme: { extend: {} },
  plugins: [],
} satisfies Config
