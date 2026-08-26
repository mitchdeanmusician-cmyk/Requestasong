import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Change this to your repo name if the site is at username.github.io/repo-name/
// Leave as "/" only if using a custom domain or username.github.io root repo.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
