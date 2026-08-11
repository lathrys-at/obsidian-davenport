// Fails when the bundled plugin contains a direct global fetch call. All
// network I/O must flow through the transport port, which the Obsidian
// adapter backs with requestUrl; a stray fetch breaks on mobile, where
// CalDAV servers send no CORS headers.
import { readFileSync } from 'node:fs';

const bundle = readFileSync('main.js', 'utf8');
const directFetch = /(?<![.\w$])fetch\s*\(/g;
const matches = [...bundle.matchAll(directFetch)];

if (matches.length > 0) {
	console.error(
		`bundle scan: ${String(matches.length)} direct fetch call(s) found in main.js`,
	);
	process.exit(1);
}
console.log('bundle scan: no direct fetch usage');
