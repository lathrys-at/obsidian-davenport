// Fails when the bundled plugin contains a direct global fetch call —
// bare, or through window/globalThis/self/global, dotted or bracketed.
// All network I/O must flow through the transport port, which the Obsidian
// adapter backs with requestUrl; a stray fetch breaks on mobile, where
// CalDAV servers send no CORS headers. This is a heuristic backstop over
// bundled output; the lint guards are the primary enforcement.
import { readFileSync } from 'node:fs';

const bundlePath = new URL('../main.js', import.meta.url);
const bundle = readFileSync(bundlePath, 'utf8');
const directFetch =
	/(?<![.\w$])fetch\s*\(|(?:window|globalThis|self|global)\s*(?:\.\s*fetch|\[\s*['"]fetch['"]\s*\])\s*\(/g;
const matches = [...bundle.matchAll(directFetch)];

if (matches.length > 0) {
	for (const match of matches) {
		const start = Math.max(0, (match.index ?? 0) - 60);
		const context = bundle.slice(start, (match.index ?? 0) + 60);
		console.error(
			`bundle scan: direct fetch at index ${String(match.index)}:`,
		);
		console.error(`  …${context.replace(/\n/g, '\\n')}…`);
	}
	console.error(
		`bundle scan: ${String(matches.length)} direct fetch call(s) found in main.js`,
	);
	process.exit(1);
}
console.log('bundle scan: no direct fetch usage');
