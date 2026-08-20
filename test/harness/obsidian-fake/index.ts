/**
 * This module holds the fake for the API of Obsidian. The fake is a vault
 * that keeps the files in memory and implements the vault port. The module
 * also exports the frontmatter reader and the frontmatter writer that the
 * fake is built on. The writer is deterministic, which means that it makes
 * the same bytes from the same data every time. The module also holds a
 * double of the frontmatter writer of the platform, which the adapter of
 * the notes writes through.
 */

export { FakeVault } from './vault';
export { FakeFileManager } from './file-manager';
export type { FrontmatterCall } from './file-manager';
export {
	CASE_INSENSITIVE_FILESYSTEM,
	NORMALIZING_FILESYSTEM,
	PERMISSIVE_FILESYSTEM,
	RESERVED_NAME_FILESYSTEM,
} from './filesystem-profile';
export type { FilesystemProfile } from './filesystem-profile';
export {
	FrontmatterError,
	readFrontmatter,
	splitNote,
	writeFrontmatter,
} from './frontmatter';
export type { BlockRead, FrontmatterRead, SplitNote } from './frontmatter';
