// YSMParser's browser build uses Emscripten MEMFS. Both the encrypted input
// and the parser's exported files stay in the worker's memory.
importScripts('./YSMParser.js');

function collectFiles(fs, directory, prefix = '') {
  const entries = [];
  for (const name of fs.readdir(directory)) {
    if (name === '.' || name === '..') continue;
    const absolute = `${directory}/${name}`;
    const relative = `${prefix}${name}`;
    if (fs.isDir(fs.stat(absolute).mode)) {
      entries.push(...collectFiles(fs, absolute, `${relative}/`));
    } else {
      entries.push([relative, fs.readFile(absolute)]);
    }
  }
  return entries;
}

self.onmessage = async ({ data }) => {
  try {
    const module = await YSMParserModule({
      noInitialRun: true,
      print: () => {},
      printErr: () => {},
      locateFile: file => new URL(file, self.location.href).href,
    });
    const fs = module.FS;
    fs.mkdir('/input');
    fs.mkdir('/output');
    const bytes = data?.bytes || data;
    fs.writeFile('/input/model.ysm', new Uint8Array(bytes));
    module.callMain(['-i', '/input', '-o', '/output', ...(data?.rawGeometry ? ['--raw-geometry'] : [])]);
    const entries = collectFiles(fs, '/output/model');
    if (!entries.length) throw new Error('YSMParser 没有生成可预览的模型文件');
    self.postMessage({ entries }, entries.map(([, bytes]) => bytes.buffer));
  } catch (error) {
    self.postMessage({ error: error?.message || String(error) });
  }
};
