import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import vercel from "vite-plugin-vercel";
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss(), vercel()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") }
  }
})
