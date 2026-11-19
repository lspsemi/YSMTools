// Kept for older notes: same as `node tools/ysmtools.mjs changelog ["msg"]`.
process.argv.splice(2, 0, 'changelog');
await import('./ysmtools.mjs');
