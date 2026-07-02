import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

/**
 * Warm every file the app loads by reading it from disk once. On a dev Mac
 * this repo lives on iCloud Drive, where a cold first read can stall for many
 * seconds — long enough to flake the first navigation of the suite. (This
 * runs before Playwright starts the webServer, so it must touch the
 * filesystem directly rather than fetch over HTTP.)
 */
export default async function globalSetup() {
  const files = [
    path.join(root, 'index.html'),
    path.join(root, 'css', 'styles.css'),
    path.join(root, 'js', 'vendor', 'd3.v7.min.js'),
  ];
  for (const name of fs.readdirSync(path.join(root, 'js'))) {
    if (name.endsWith('.js')) files.push(path.join(root, 'js', name));
  }
  for (const name of fs.readdirSync(path.join(root, 'test', 'fixtures'))) {
    files.push(path.join(root, 'test', 'fixtures', name));
  }
  for (const file of files) {
    try {
      fs.readFileSync(file);
    } catch {
      // best-effort warmup only
    }
  }
}
