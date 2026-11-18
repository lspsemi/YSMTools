// Model files passed on the command line (第 54 节): double-clicking a .ysm
// file, or starting the app again while it runs (single instance).
//
// The backend keeps a queue of paths; on start and whenever it signals
// "open-files" the page takes the queue, reads the newest file and opens it.
// "already-running" means the app was started again without a file.
//   desktop:    src-tauri/src/open_file.rs (Tauri commands + events)
//   dev server: tools/open-file-dev-api.js (HTTP + Vite HMR events);
//               simulate a start with POST /__open-file/launch {"args":[…]}
//   web build:  nothing (no command line)
const isDesktop = '__TAURI_INTERNALS__' in window;

async function desktopBackend() {
  const [{ invoke }, { listen }] = await Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]);
  const call = (name, args) => invoke(name, args).catch(error => { throw new Error(String(error)); });
  return {
    take: () => call('open_file_take'),
    read: path => call('open_file_read', { path }),
    on: (event, handler) => listen(event, handler),
  };
}

function devBackend() {
  const hot = import.meta.hot;
  return {
    take: () => fetch('/__open-file/take').then(response => response.json()),
    read: async path => {
      const response = await fetch(`/__open-file/read?path=${encodeURIComponent(path)}`);
      if (!response.ok) throw new Error(await response.text());
      return response.arrayBuffer();
    },
    on: (event, handler) => hot.on(`ysm:${event}`, handler),
  };
}

/**
 * @param {{openFile:(file:File)=>Promise<void>, alreadyRunning:()=>void, onError:(error:Error)=>void}} handlers
 */
export async function setupOpenFiles({ openFile, alreadyRunning, onError }) {
  const backend = isDesktop ? await desktopBackend() : import.meta.hot ? devBackend() : null;
  if (!backend) return;
  let draining = false, again = false;
  async function drain() {
    if (draining) { again = true; return; }
    draining = true;
    try {
      do {
        again = false;
        // Several files at once (multi-select → Enter): only the last stays open anyway.
        const path = (await backend.take()).at(-1);
        if (!path) continue;
        try {
          const bytes = await backend.read(path);
          await openFile(new File([bytes], path.split(/[\\/]/).pop()));
        } catch (error) { onError(error); }
      } while (again);
    } catch (error) { onError(error); }
    finally { draining = false; }
  }
  await backend.on('open-files', drain);
  await backend.on('already-running', alreadyRunning);
  drain();
}
