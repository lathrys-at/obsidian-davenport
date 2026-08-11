// Fails when the bundled plugin contains a direct global fetch call —
// bare, or through window/globalThis/self/global, dotted or bracketed, or
// read off a holder with Reflect.get. All network I/O must flow through the
// transport port, which the Obsidian adapter backs with requestUrl; a stray
// fetch breaks on mobile, where CalDAV servers send no CORS headers. This is
// a heuristic backstop over bundled output; the lint guards are the primary
// enforcement.
//
// Scans main.js unless a path is given, so the same patterns can be run
// against a bundle written anywhere.
import { readFileSync } from 'node:fs';

const spellings = [
	// A call to fetch, bare or through a global object.
	/(?<![.\w$])fetch\s*\(|(?:window|globalThis|self|global)\s*(?:\.\s*fetch|\[\s*['"]fetch['"]\s*\])\s*\(/g,
	// Reflect.get(holder, 'fetch'), which names no property and so appears
	// in none of the spellings above. The holder is anything but a further
	// call, which keeps the match on one argument list.
	/Reflect\s*\.\s*get\s*\(\s*[^,()]*,\s*['"]fetch['"]\s*[,)]/g,
];

const target =
	process.argv[2] === undefined
		? new URL('../main.js', import.meta.url)
		: process.argv[2];
const bundle = readFileSync(target, 'utf8');
const matches = spellings
	.flatMap((pattern) => [...bundle.matchAll(pattern)])
	.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

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
		`bundle scan: ${String(matches.length)} direct fetch call(s) found in ${String(target)}`,
	);
	process.exit(1);
}
console.log('bundle scan: no direct fetch usage');
