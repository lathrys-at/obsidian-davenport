/**
 * A filesystem profile tells the fake vault two things: which names the
 * filesystem refuses, and which names the filesystem cannot tell apart.
 * The permissive profile is the default. It refuses no name, and it tells
 * every name apart. Each other profile models one hostile behavior of a
 * real filesystem, and only that behavior. Therefore a suite can run one
 * scenario against a hostile filesystem and against a permissive
 * filesystem, and compare the two runs.
 */

export interface FilesystemProfile {
	/** The name of this profile. A test report shows this name. */
	readonly name: string;
	/**
	 * Gives the identity of the path on this filesystem. Two paths with
	 * the same identity name one file. The vault keeps the spelling that
	 * made the file, and the events of the vault carry that spelling.
	 */
	readonly identity: (path: string) => string;
	/**
	 * Gives the reason that this filesystem refuses the path. The function
	 * gives back null when this filesystem accepts the path. The vault
	 * puts the reason into the error that the operation throws.
	 */
	readonly refusal: (path: string) => string | null;
}

/**
 * The filesystem that accepts everything. The vault keeps each spelling
 * apart, and each path names its own file.
 */
export const PERMISSIVE_FILESYSTEM: FilesystemProfile = {
	name: 'permissive',
	identity: (path) => path,
	refusal: () => null,
};

/**
 * The filesystem where two paths that differ only in case name one file.
 * Windows with NTFS and macOS with APFS work this way in their default
 * setup. This profile changes nothing else. It refuses no name, and it
 * keeps two Unicode spellings of one name apart.
 */
export const CASE_INSENSITIVE_FILESYSTEM: FilesystemProfile = {
	name: 'case-insensitive',
	identity: (path) => path.toLowerCase(),
	refusal: () => null,
};

/**
 * The filesystem that refuses the names that Windows keeps for devices.
 * This filesystem also refuses a name that ends with a dot, and a name
 * that ends with a space. The check reads each part of the path, and the
 * check ignores an extension. This profile changes nothing else. Two
 * paths that differ in any way still name two files.
 */
export const RESERVED_NAME_FILESYSTEM: FilesystemProfile = {
	name: 'reserved names',
	identity: (path) => path,
	refusal: refuseReservedName,
};

/**
 * The filesystem where the NFC spelling and the NFD spelling of one name
 * land on one file. macOS with APFS works this way. The vault keeps the
 * spelling that made the file. This profile changes nothing else. It
 * refuses no name, and it keeps two names that differ in case apart.
 */
export const NORMALIZING_FILESYSTEM: FilesystemProfile = {
	name: 'unicode normalization',
	identity: (path) => path.normalize('NFC'),
	refusal: () => null,
};

const NUMBERED_DEVICE_NAMES = ['COM', 'LPT'].flatMap((stem) =>
	Array.from({ length: 9 }, (_, index) => `${stem}${String(index + 1)}`),
);

const DEVICE_NAMES: ReadonlySet<string> = new Set([
	'CON',
	'PRN',
	'AUX',
	'NUL',
	...NUMBERED_DEVICE_NAMES,
]);

function refuseReservedName(path: string): string | null {
	for (const part of path.split('/')) {
		if (part.endsWith('.')) {
			return 'the name ends with a dot';
		}
		if (part.endsWith(' ')) {
			return 'the name ends with a space';
		}
		if (DEVICE_NAMES.has(deviceName(part))) {
			return 'the system keeps this name for a device';
		}
	}
	return null;
}

/**
 * Gives the part of the name that Windows compares against its device
 * names. Windows reads the name up to the first dot, and Windows ignores
 * the case of the letters.
 */
function deviceName(part: string): string {
	const dot = part.indexOf('.');
	const base = dot === -1 ? part : part.slice(0, dot);
	return base.toUpperCase();
}
