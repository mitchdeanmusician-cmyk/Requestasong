import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ---------------------------------------------------------------------------
// IMPORTANT: set `base` to match your GitHub repository name before deploying.
//
// If your repo is named "my-band-app" and lives at:
//   https://github.com/yourname/my-band-app
// then your site will be served from:
//   https://yourname.github.io/my-band-app/
// so base should be:
//   base: "/my-band-app/"
//
// EXCEPTION: if your repo is specifically named "yourname.github.io" (a
// GitHub "user site"), your site is served from the root instead, so use:
//   base: "/"
// ---------------------------------------------------------------------------
export default defineConfig({
  plugins: [react()],
  base: "/Requestasong/",
});
