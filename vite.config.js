import { defineConfig } from 'vite';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { libraryDevApi } from './tools/library-dev-api.js';
import { languageFiles } from './tools/lang-files.js';
import { configDevApi } from './tools/config-dev-api.js';
import { openFileDevApi } from './tools/open-file-dev-api.js';

// Relative base so the build also works when loaded by the Tauri desktop shell.
// The library dev API only runs on the dev server (`npm run dev`); the desktop
// app uses the Rust commands in src-tauri/src/library.rs instead.
export default defineConfig({
  base: './',
  // App version for the 关于 page (第 72 节); tools/set-version.js keeps package.json in sync.
  define: { __APP_VERSION__: JSON.stringify(JSON.parse(readFileSync('package.json', 'utf8')).version) },
  clearScreen: false,
  // Other pages: the Molang 监视器 window (第 61 节) and the 独立窗口 shell (第 62 节).
  build: { rollupOptions: { input: { main: path.resolve('index.html'), 'molang-inspector': path.resolve('molang-inspector.html'), popout: path.resolve('popout.html') } } },
  server: { strictPort: true, watch: { ignored: [path.resolve('library'), path.resolve('Config'), path.resolve('src-tauri')] } },
  plugins: [libraryDevApi(), languageFiles(), configDevApi(), openFileDevApi()],
});
