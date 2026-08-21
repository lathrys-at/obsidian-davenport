/**
 * The file names that each platform refuses.
 *
 * The plugin writes files into a vault, and a vault sits on a real
 * filesystem. Each platform refuses its own set of names. A name that one
 * platform accepts and another refuses makes a vault that travels badly:
 * the file arrives on the second device and the write fails there.
 *
 * This module states the set of each platform that the plugin supports,
 * so that a test can hold a name that the plugin builds against every set
 * at one time. The module states the sets, and it applies none of them.
 * The code under test decides what to do with a name.
 *
 * The sets, and where each one comes from:
 *
 * - Windows refuses nine characters, and it refuses every character below
 *   a space. It also refuses a name that ends with a dot or with a space,
 *   and it reserves a set of names for devices. The profile
 *   `RESERVED_NAME_FILESYSTEM` of the vault fake holds the device names
 *   and the two endings, and this module reads that profile. The nine
 *   characters come from the naming rules of the Win32 file API.
 * - macOS and iOS refuse two characters at the level of the filesystem:
 *   the separator of a path and the character with the value zero. The
 *   file manager of Apple also refuses the colon, which was the separator
 *   of a path in the older systems of Apple, and which the file manager
 *   still shows in the place of a slash.
 * - Linux and Android refuse the same two characters, and nothing else.
 * - Obsidian refuses a set of its own on every platform, so that one
 *   vault opens everywhere. The set is the nine characters of Windows.
 *
 * A test that adds a platform adds an entry here, with the source of the
 * set beside it.
 */

import { RESERVED_NAME_FILESYSTEM } from './obsidian-fake/filesystem-profile';

/** The characters that the Win32 file API refuses inside a name. */
const WINDOWS_CHARACTERS = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/** The characters that a POSIX filesystem refuses inside a name. */
const POSIX_CHARACTERS = ['/', '\u0000'];

/** The characters that the file manager of Apple refuses. */
const APPLE_CHARACTERS = [...POSIX_CHARACTERS, ':'];

/** Every character below a space, which Windows refuses. */
const CONTROL_CHARACTERS = Array.from({ length: 32 }, (_, code) =>
	String.fromCharCode(code),
);

/** What one platform refuses inside a file name. */
export interface FilenameRules {
	/** The platform, as a message names it. */
	readonly platform: string;
	/** Every character that this platform refuses inside a name. */
	readonly illegal: readonly string[];
	/** The reason that this platform refuses the name, or null. */
	readonly refusal: (name: string) => string | null;
}

/** The rules of every platform that the plugin supports. */
export const FILENAME_RULES: readonly FilenameRules[] = [
	{
		platform: 'Windows',
		illegal: [...WINDOWS_CHARACTERS, ...CONTROL_CHARACTERS],
		refusal: (name) =>
			characterRefusal(name, [
				...WINDOWS_CHARACTERS,
				...CONTROL_CHARACTERS,
			]) ?? RESERVED_NAME_FILESYSTEM.refusal(name),
	},
	{
		platform: 'macOS and iOS',
		illegal: APPLE_CHARACTERS,
		refusal: (name) => characterRefusal(name, APPLE_CHARACTERS),
	},
	{
		platform: 'Linux and Android',
		illegal: POSIX_CHARACTERS,
		refusal: (name) => characterRefusal(name, POSIX_CHARACTERS),
	},
	{
		platform: 'Obsidian',
		illegal: WINDOWS_CHARACTERS,
		refusal: (name) => characterRefusal(name, WINDOWS_CHARACTERS),
	},
];

/**
 * The reason of each platform that refuses the name. An empty list says
 * that every platform accepts the name.
 */
export function nameRefusals(name: string): readonly string[] {
	const refusals: string[] = [];
	for (const rules of FILENAME_RULES) {
		const reason = rules.refusal(name);
		if (reason !== null) {
			refusals.push(`${rules.platform}: ${reason}`);
		}
	}
	return refusals;
}

/** Every character that at least one platform refuses. */
export function illegalCharacters(): readonly string[] {
	const characters = new Set<string>();
	for (const rules of FILENAME_RULES) {
		for (const character of rules.illegal) {
			characters.add(character);
		}
	}
	return [...characters];
}

function characterRefusal(
	name: string,
	illegal: readonly string[],
): string | null {
	for (const character of illegal) {
		if (name.includes(character)) {
			return `the name holds the character U+${character
				.charCodeAt(0)
				.toString(16)
				.toUpperCase()
				.padStart(4, '0')}`;
		}
	}
	return null;
}
