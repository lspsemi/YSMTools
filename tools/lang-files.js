// Serves the repository's lang/*.lang files to the page (第 47 节):
// GET ./lang/index.json → ["en.lang", …] and GET ./lang/<file>.
// The dev server reads the folder on every request, so edits to a .lang file
// show up after a page reload. A web build (`npm run build` outside Tauri)
// copies the files into dist/lang/; the desktop build does not, because the
// app reads lang/ next to the executable (src-tauri/src/lang.rs).
import fs from 'node:fs';
import path from 'node:path';

export function languageFiles() {
  const dir = path.resolve('lang');
  const list = () => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(file => file.toLowerCase().endsWith('.lang')).sort() : []);
  return {
    name: 'ysm-language-files',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = decodeURIComponent((request.url || '').split('?')[0]);
        if (!url.startsWith('/lang/')) return next();
        const name = url.slice('/lang/'.length);
        response.setHeader('Cache-Control', 'no-cache');
        if (name === 'index.json') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(list())); return; }
        if (!list().includes(name)) { response.statusCode = 404; response.end(); return; }
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(fs.readFileSync(path.join(dir, name)));
      });
    },
    generateBundle() {
      if (process.env.TAURI_ENV_PLATFORM) return;
      const files = list();
      for (const file of files) this.emitFile({ type: 'asset', fileName: `lang/${file}`, source: fs.readFileSync(path.join(dir, file)) });
      this.emitFile({ type: 'asset', fileName: 'lang/index.json', source: JSON.stringify(files) });
    }
  };
}
