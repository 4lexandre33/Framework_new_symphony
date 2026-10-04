import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import { fileURLToPath } from "node:url";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;
const coreEntry = fileURLToPath(new URL("./src/core/index.ts", import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({

  test: {
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/cypress/**",
      "**/.{idea,git,cache,output,temp}/**",
      "**/.migration/**",
      "**/{karma,rollup,webpack,vite,jest,ava,babel,nyc,cypress,playwright}.config.*",
    ],
  },

  resolve: {
    alias: [
      {
        find: /^@core$/,
        replacement: coreEntry,
      },
    ],
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
