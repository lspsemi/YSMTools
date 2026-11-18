// Dev-server stand-in for the desktop config commands (src-tauri/src/config.rs,
// 第 51 节): GET /__config/settings.json → 200 with the file or 204 when there
// is none; PUT writes it. The file is <repo>/Config/settings.json.
import fs from 'node:fs';
import path from 'node:path';

export function configDevApi() {
  const dir = path.resolve('Config');
  const file = path.join(dir, 'settings.json');
  return {
    name: 'ysm-config-dev-api',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if ((request.url || '').split('?')[0] !== '/__config/settings.json') return next();
        response.setHeader('Cache-Control', 'no-cache');
        if (request.method === 'GET') {
          if (!fs.existsSync(file)) { response.statusCode = 204; response.end(); return; }
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(fs.readFileSync(file));
          return;
        }
        if (request.method !== 'PUT') { response.statusCode = 405; response.end(); return; }
        const chunks = [];
        request.on('data', chunk => chunks.push(chunk));
        request.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8');
            JSON.parse(text);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(`${file}.tmp`, text);
            fs.renameSync(`${file}.tmp`, file);
            response.statusCode = 204;
          } catch (error) {
            response.statusCode = 400;
            response.write(String(error));
          }
          response.end();
        });
      });
    }
  };
}
