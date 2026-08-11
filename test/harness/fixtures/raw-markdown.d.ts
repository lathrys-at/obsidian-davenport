/**
 * Fixture notes are imported as raw text so the corpus stays readable
 * Markdown on disk, usable as it is by anything that reads the files
 * directly.
 */
declare module '*.md?raw' {
	const content: string;
	export default content;
}
