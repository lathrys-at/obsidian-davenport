/**
 * A filesystem profile answers two questions about a path. The first
 * question: does this filesystem refuse the name? The second question:
 * which other paths land on the same file as this path?
 *
 * The permissive profile is the default. It accepts every name, and it
 * tells every name apart. Each other profile models one hostile behavior
 * of a real filesystem, and only that behavior. A suite therefore runs
 * one scenario two times. The first run uses a hostile filesystem, and
 * the second run uses the permissive filesystem. The suite then compares
 * the two runs.
 */

export interface FilesystemProfile {
	/**
	 * The name of this profile. A test that runs against more than one
	 * profile puts this name into the message of a failed assertion.
	 */
	readonly name: string;
	/**
	 * Gives the identity of the path on this filesystem. Two paths with
	 * one identity land on one file. The vault keeps the spelling that
	 * created the file, and the vault reports that spelling.
	 */
	readonly identity: (path: string) => string;
	/**
	 * Gives the reason that this filesystem refuses the path. The result
	 * is null when this filesystem accepts the path. The vault puts the
	 * reason into the error that the operation throws.
	 */
	readonly refusal: (path: string) => string | null;
}

/**
 * The filesystem that accepts every name and tells every name apart.
 * Each path lands on its own file.
 */
export const PERMISSIVE_FILESYSTEM: FilesystemProfile = {
	name: 'permissive',
	identity: (path) => path,
	refusal: () => null,
};

/**
 * The filesystem where two paths that differ only in case land on one
 * file. Windows with NTFS and macOS with APFS work this way in their
 * default setup. This profile changes nothing else. It accepts every
 * name, and it tells the two Unicode spellings of one name apart.
 */
export const CASE_INSENSITIVE_FILESYSTEM: FilesystemProfile = {
	name: 'case-insensitive',
	identity: (path) => path.toLowerCase(),
	refusal: () => null,
};

/**
 * The filesystem that refuses the names that Windows reserves for
 * devices. This filesystem also refuses a part of a path that ends with
 * a dot, and a part that ends with a space. The parts "." and ".." are
 * the exceptions, because Windows accepts both of them. This profile
 * changes nothing else. Two paths that differ in any way land on two
 * files.
 */
export const RESERVED_NAME_FILESYSTEM: FilesystemProfile = {
	name: 'reserved names',
	identity: (path) => path,
	refusal: refuseReservedName,
};

/**
 * The filesystem where the NFC spelling and the NFD spelling of one name
 * land on one file. macOS with APFS works this way. The vault keeps the
 * spelling that created the file. This profile changes nothing else. It
 * accepts every name, and it tells two names that differ in case apart.
 */
export const NORMALIZING_FILESYSTEM: FilesystemProfile = {
	name: 'unicode normalization',
	identity: (path) => path.normalize('NFC'),
	refusal: () => null,
};

/**
 * The device names with a number. Windows reads the superscript digits
 * as digits, so each stem has twelve forms.
 */
const NUMBERED_DEVICE_NAMES = ['COM', 'LPT'].flatMap((stem) => [
	...Array.from({ length: 9 }, (_, index) => `${stem}${String(index + 1)}`),
	`${stem}\u00b9`,
	`${stem}\u00b2`,
	`${stem}\u00b3`,
]);

const DEVICE_NAMES: ReadonlySet<string> = new Set([
	'CON',
	'PRN',
	'AUX',
	'NUL',
	...NUMBERED_DEVICE_NAMES,
]);

/** The parts that point to a directory, and that Windows accepts. */
const RELATIVE_PARTS: ReadonlySet<string> = new Set(['.', '..']);

/**
 * Gives the reason that Windows refuses this path. The function reads
 * the parts of the path from left to right, and the first part with a
 * problem gives the reason. Inside one part the order is the trailing
 * dot, then the trailing space, then the device name.
 */
function refuseReservedName(path: string): string | null {
	for (const part of path.split('/')) {
		if (RELATIVE_PARTS.has(part)) {
			continue;
		}
		if (part.endsWith('.')) {
			return `the part "${part}" ends with a dot`;
		}
		if (part.endsWith(' ')) {
			return `the part "${part}" ends with a space`;
		}
		const device = deviceName(part);
		if (DEVICE_NAMES.has(device)) {
			return `Windows reserves the name "${device}" for a device`;
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
