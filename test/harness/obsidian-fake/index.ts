/**
 * The Obsidian API fake: an in-memory vault behind the vault port, with
 * the frontmatter reader and deterministic writer it is built on.
 */

export { FakeVault } from './vault';
export {
	FrontmatterError,
	readFrontmatter,
	splitNote,
	writeFrontmatter,
} from './frontmatter';
export type { BlockRead, FrontmatterRead, SplitNote } from './frontmatter';
