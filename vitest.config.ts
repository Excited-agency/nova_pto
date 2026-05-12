import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "path"
import { fileURLToPath } from "url"
import { loadEnv } from "vite"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

// Load .env.test into process.env so security/DB tests can read TEST_SUPABASE_* vars
const testEnv = loadEnv("test", __dirname, "")

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/lib/**", "src/hooks/**", "src/components/**"],
      exclude: ["src/test/**", "src/**/*.d.ts"],
    },
    env: {
      ...testEnv,
      VITE_SUPABASE_URL: testEnv.VITE_SUPABASE_URL ?? "http://localhost:54321",
      VITE_SUPABASE_ANON_KEY: testEnv.VITE_SUPABASE_ANON_KEY ?? "test-anon-key",
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
