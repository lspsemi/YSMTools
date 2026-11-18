// Dev-server stand-in for src-tauri/src/open_file.rs (第 54 节): lets the
// "double-click a .ysm file" and single-instance flows run in the browser.
//
//   POST /__open-file/launch  {"args":["D:\\a.ysm"], "cwd":"…"}
//        simulates starting ysm-preview.exe with these arguments while the app
//        runs: model files are queued and the page gets `ysm:open-files`;
//        no file → `ysm:already-running`. Responds with the queued paths.
//        With no page open the queue waits, like a first start with a file.
//   GET  /__open-file/take    → JSON array of queued paths (they become readable)
//   GET  /__open-file/read?path=…  → the file's bytes (taken paths only, once)
import fs from 'node:fs';
import path from 'node:path';

function modelPaths(args, cwd) {
  return args
    .filter(arg => typeof arg === 'string' && !arg.startsWith('-'))
    .map(arg => path.resolve(cwd, arg))
    .filter(file => /\.(?:ysm|zip)$/i.test(file) && fs.statSync(file, { throwIfNoEntry: false })?.isFile());
}

export function openFileDevApi() {
  const pending = [], granted = new Set();
  return {
    name: 'ysm-open-file-dev-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost');
        if (!url.pathname.startsWith('/__open-file/')) return next();
        response.setHeader('Cache-Control', 'no-cache');
        const route = url.pathname.slice('/__open-file/'.length);
        if (route === 'take' && request.method === 'GET') {
          const paths = pending.splice(0);
          for (const file of paths) granted.add(file);
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify(paths));
          return;
        }
        if (route === 'read' && request.method === 'GET') {
          const file = url.searchParams.get('path') || '';
          if (!granted.delete(file)) { response.statusCode = 403; response.end('无法读取该文件'); return; }
          fs.readFile(file, (error, data) => {
            if (error) { response.statusCode = 404; response.end(`无法读取文件：${error.message}`); return; }
            response.setHeader('Content-Type', 'application/octet-stream');
            response.end(data);
          });
          return;
        }
        if (route === 'launch' && request.method === 'POST') {
          const chunks = [];
          request.on('data', chunk => chunks.push(chunk));
          request.on('end', () => {
            try {
              const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
              const paths = modelPaths(Array.isArray(body.args) ? body.args : [], body.cwd || process.cwd());
              if (paths.length) { pending.push(...paths); server.ws.send({ type: 'custom', event: 'ysm:open-files' }); }
              else server.ws.send({ type: 'custom', event: 'ysm:already-running' });
              response.setHeader('Content-Type', 'application/json; charset=utf-8');
              response.end(JSON.stringify({ queued: paths }));
            } catch (error) {
              response.statusCode = 400;
              response.end(String(error));
            }
          });
          return;
        }
        response.statusCode = 404;
        response.end();
      });
    }
  };
}
