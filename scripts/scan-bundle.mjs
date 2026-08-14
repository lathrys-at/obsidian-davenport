// The plugin must not call the global fetch function. Three guards hold
// this rule. The lint selectors are the first guard, and they read the
// source files. This script is the second guard, and it reads the built
// bundle. The fetch poison is the third guard, and it works while the code
// runs.
//
// Every network request must go through the transport port, which the
// Obsidian adapter backs with requestUrl. A call to fetch that gets past
// the guards breaks on mobile, because CalDAV servers send no CORS headers.
//
// The script fails when the bundle uses the global fetch function directly.
// The script finds these forms:
//
//   - a bare call;
//   - a call through window, globalThis, self, or global, with a dotted key
//     or a bracketed key;
//   - a read of the fetch property with Reflect.get.
//
// This script matches patterns over text, and it does not parse the code.
// Therefore the lint selectors are the primary guard, and this script is
// only a backup.
//
// Two forms get past this script, and the fetch poison covers both. The
// poison replaces the fetch property itself, and therefore the poison covers
// every form. The first form that gets past is a key that a variable holds,
// because esbuild does not replace that variable with its value. The second
// form that gets past is a holder that is itself a call, because the pattern
// for the holder stops at the first comma or parenthesis.
//
// The script reads main.js. If you give a path as the first argument, the
// script reads that file instead. Then the same patterns can run over a
// bundle in any location.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const spellings = [
	// This pattern matches a call to fetch. The call is bare, or the call
	// goes through a global object. The lookbehind is necessary. Without the
	// lookbehind, this pattern also matches a property that is named fetch
	// and a longer name that ends in fetch.
	/(?<![.\w$])fetch\s*\(|(?:window|globalThis|self|global)\s*(?:\.\s*fetch|\[\s*['"]fetch['"]\s*\])\s*\(/g,
	// Reflect.get reads the fetch property without naming it, so the first
	// pattern cannot find a Reflect.get read. This pattern accepts the key
	// in single quotes, in double quotes, or in a template string. The part
	// that matches the holder stops at the first comma or parenthesis, and
	// therefore each match stays inside one argument list.
	/Reflect\s*\.\s*get\s*\(\s*[^,()]*,\s*(?:'fetch'|"fetch"|`fetch`)\s*[,)]/g,
];

const target =
	process.argv[2] ?? fileURLToPath(new URL('../main.js', import.meta.url));
const bundle = readFileSync(target, 'utf8');
const matches = spellings
	.flatMap((pattern) => [...bundle.matchAll(pattern)])
	.sort((left, right) => (left.index ?? 0) - (right.index ?? 0));

if (matches.length > 0) {
	for (const match of matches) {
		const start = Math.max(0, (match.index ?? 0) - 60);
		const context = bundle.slice(start, (match.index ?? 0) + 60);
		console.error(
			`bundle scan: direct fetch usage at index ${String(match.index)}:`,
		);
		console.error(`  …${context.replace(/\n/g, '\\n')}…`);
	}
	console.error(
		`bundle scan: the count of places with direct fetch usage is ${String(matches.length)}. The file ${target} does not pass. Send each network request through the transport port.`,
	);
	process.exit(1);
}
console.log('bundle scan: no direct fetch usage');
