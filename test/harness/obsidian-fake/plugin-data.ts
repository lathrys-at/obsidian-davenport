/**
 * The data file of a plugin, in memory.
 *
 * Obsidian gives a plugin two methods for that file. `loadData` reads the
 * whole file and parses it, and `saveData` writes the whole file as JSON.
 * This fake holds the text of the file, so a test reads the bytes that the
 * plugin wrote and not the object that the plugin passed. A test of the
 * secrets therefore asks the true question: what stands in the file.
 *
 * `loadData` gives a fresh value back on each call, because the real
 * method parses the file again. A caller that changes the value it read
 * changes nothing in the file.
 *
 * The fake keeps every write. A value that one write put in the file and a
 * later write took out is still evidence: the file held that value.
 */
export class FakePluginData {
	private text: string | null;
	private readonly saves: string[] = [];

	constructor(initial?: unknown) {
		this.text = initial === undefined ? null : text(initial);
	}

	loadData(): Promise<unknown> {
		return Promise.resolve(this.value);
	}

	saveData(data: unknown): Promise<void> {
		const written = text(data);
		this.text = written;
		this.saves.push(written);
		return Promise.resolve();
	}

	/** The text of each write, in the order of the writes. */
	get writes(): readonly string[] {
		return [...this.saves];
	}

	/** The text of the file, or null where the file does not exist. */
	get document(): string | null {
		return this.text;
	}

	/** The value that the text of the file states. */
	get value(): unknown {
		return this.text === null ? null : (JSON.parse(this.text) as unknown);
	}
}

function text(data: unknown): string {
	// The value undefined has no JSON text. A file that a caller wrote
	// from that value therefore states no value.
	return data === undefined ? 'null' : JSON.stringify(data);
}
