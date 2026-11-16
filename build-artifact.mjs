/* Inline app.css and app.js into one HTML file, for publishing as a Claude
 * artifact (which serves a single document). The source of truth stays the
 * separate files in this folder.
 *
 *   node build-artifact.mjs  ->  dist/artifact.html
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = f => readFileSync(join(here, f), 'utf8');

const html = read('index.html');
const css = read('app.css');
const js = read('app.js');

const out = html
  .replace('<link rel="stylesheet" href="./app.css">', '<style>\n' + css + '\n</style>')
  .replace('<script src="./app.js"></script>', '<script>\n' + js + '\n</script>')
  // the artifact sandbox serves one document: no manifest, icons or service worker
  .replace(/^.*rel="manifest".*\n/m, '')
  .replace(/^.*rel="icon".*\n/m, '')
  .replace(/^.*rel="apple-touch-icon".*\n/m, '')
  // analytics only exists on Vercel; the sandbox would just block the request
  .replace(/<!-- vercel-analytics:start[\s\S]*?vercel-analytics:end -->\n?/, '')
  .replace(/<!-- google-analytics:start[\s\S]*?google-analytics:end -->\n?/, '');

mkdirSync(join(here, 'dist'), { recursive: true });
writeFileSync(join(here, 'dist', 'artifact.html'), out);
console.log('dist/artifact.html', out.length, 'bytes');
