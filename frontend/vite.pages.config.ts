import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

function pagesBase() {
  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) return "/";
  const [owner, name] = repository.split("/");
  return name === `${owner}.github.io` ? "/" : `/${name}/`;
}

export default defineConfig({
  base: pagesBase(),
  plugins: [react()],
  build: {
    outDir: "pages-dist",
    emptyOutDir: true,
  },
});
