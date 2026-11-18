import { unzip } from 'fflate';

// fflate decodes names without the UTF-8 flag (general purpose bit 11) as
// Latin-1, so packs zipped on Chinese Windows (GBK names, no flag) arrive as
// "textures/³¤ÃÅ.png". Read the flags from the central directory and decode
// unflagged names as UTF-8 when valid, otherwise as GBK.
const utf8 = new TextDecoder('utf-8', { fatal: true });
const gbk = new TextDecoder('gbk', { fatal: true });
function decodeLegacyName(bytes) {
  for (const decoder of [utf8, gbk]) {
    try { return decoder.decode(bytes); } catch { /* try the next encoding */ }
  }
  return null;
}
// Maps fflate's Latin-1 name of each unflagged non-ASCII entry to its decoded name.
function legacyNames(data) {
  const names = new Map(), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  while (end >= Math.max(0, data.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50) return names;
  let count = view.getUint16(end + 10, true), offset = view.getUint32(end + 16, true);
  if ((count === 0xffff || offset === 0xffffffff) && end >= 20 && view.getUint32(end - 20, true) === 0x07064b50) {
    const zip64 = Number(view.getBigUint64(end - 12, true));
    if (view.getUint32(zip64, true) === 0x06064b50) { count = Number(view.getBigUint64(zip64 + 32, true)); offset = Number(view.getBigUint64(zip64 + 48, true)); }
  }
  for (let i = 0; i < count && offset + 46 <= data.length && view.getUint32(offset, true) === 0x02014b50; i++) {
    const flags = view.getUint16(offset + 8, true), nameLength = view.getUint16(offset + 28, true);
    const bytes = data.subarray(offset + 46, offset + 46 + nameLength);
    if (!(flags & 0x800) && bytes.some(byte => byte > 0x7f)) {
      const decoded = decodeLegacyName(bytes);
      if (decoded) names.set(String.fromCharCode(...bytes), decoded);
    }
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
  }
  return names;
}

self.onmessage = ({ data }) => {
  const bytes = new Uint8Array(data), names = legacyNames(bytes);
  unzip(bytes, (error, files) => {
    if (error) {
      self.postMessage({ error: error.message || String(error) });
      return;
    }
    const entries = Object.entries(files).filter(([path]) => !path.endsWith('/')).map(([path, file]) => [names.get(path) ?? path, file]);
    const transfer = entries.map(([, file]) => file.buffer);
    self.postMessage({ entries }, transfer);
  });
};
