import { describe, expect, it } from 'vitest';
import { RECORD_GOLDEN_CASES } from '../../../test/harness/fixtures/record-goldens';
import { FakeVault } from '../../../test/harness/obsidian-fake';
import { RecordingVault } from '../../../test/harness/recording-vault';
import { WebCryptoDigest } from '../../adapters/digest';
import { parseIcs } from '../ics/parse';
import { NORMALIZATION_VERSIONS } from '../ics/stamp';
import type { NormalizationVersions } from '../model/normalization';
import type { RecordData } from '../model/record';
import { buildRecord } from './build';
import { sealRecord } from './checksum';
import type { RecordWriterPorts } from './writer';
import { writeRecord } from './writer';

const digest = new WebCryptoDigest();
const PATH = 'davenport/records/one.md';

function state(id: string) {
	const entry = RECORD_GOLDEN_CASES.find((each) => each.id === id);
	if (entry === undefined) {
		throw new Error(`the gate holds no case named ${id}`);
	}
	return entry;
}

function record(
	id: string,
	versions: NormalizationVersions = NORMALIZATION_VERSIONS,
	change: (data: RecordData) => RecordData = (data) => data,
): RecordData {
	const entry = state(id);
	const parsed = parseIcs(entry.ics);
	if (!parsed.ok) {
		throw new Error(parsed.failure.message);
	}
	return change(
		buildRecord(versions, { ...entry.state, calendar: parsed.calendar })
			.data,
	);
}

function ports(
	files: Readonly<Record<string, string>> = {},
	versions: NormalizationVersions = NORMALIZATION_VERSIONS,
): RecordWriterPorts & { vault: RecordingVault } {
	return {
		vault: new RecordingVault(new FakeVault(files)),
		digest,
		versions,
	};
}

describe('the write of a record that no file holds yet', () => {
	it('writes the file and says so', async () => {
		const home = ports();
		const result = await writeRecord(home, PATH, record('minimal'));
		expect(result.outcome).toBe('created');
		expect(home.vault.writtenPaths).toEqual([PATH]);
		expect(await home.vault.read(PATH)).toBe(result.text);
	});

	it('writes the bytes that the seal computed', async () => {
		const home = ports();
		const data = record('minimal');
		const result = await writeRecord(home, PATH, data);
		expect(result.text).toBe(await sealRecord(digest, data));
	});
});

describe('the write of a record that a file already holds', () => {
	it('writes nothing when the bytes are the same', async () => {
		const data = record('minimal');
		const text = await sealRecord(digest, data);
		const home = ports({ [PATH]: text });
		const result = await writeRecord(home, PATH, data);
		expect(result.outcome).toBe('unchanged');
		expect(home.vault.written).toEqual([]);
	});

	it('writes nothing over a second run of the same state', async () => {
		const home = ports();
		await writeRecord(home, PATH, record('every-field'));
		home.vault.forget();
		const result = await writeRecord(home, PATH, record('every-field'));
		expect(result.outcome).toBe('unchanged');
		expect(home.vault.written).toEqual([]);
	});

	it('writes the new bytes when the state changed', async () => {
		const home = ports();
		await writeRecord(home, PATH, record('minimal'));
		home.vault.forget();
		const result = await writeRecord(
			home,
			PATH,
			record('minimal', NORMALIZATION_VERSIONS, (data) => ({
				...data,
				etag: '"2"',
			})),
		);
		expect(result.outcome).toBe('rewritten');
		expect(home.vault.writtenPaths).toEqual([PATH]);
	});

	it('writes the new bytes when the base snapshot changed', async () => {
		const home = ports();
		await writeRecord(home, PATH, record('minimal'));
		home.vault.forget();
		const result = await writeRecord(
			home,
			PATH,
			record('minimal', NORMALIZATION_VERSIONS, (data) => ({
				...data,
				baseIcs: data.baseIcs.replace('UID:minimal', 'UID:other'),
			})),
		);
		expect(result.outcome).toBe('rewritten');
	});
});

describe('the write of a record whose file the reader refuses', () => {
	it('writes nothing and names the refusal', async () => {
		const home = ports({ [PATH]: 'a note that a person wrote\n' });
		const result = await writeRecord(home, PATH, record('minimal'));
		expect(result.outcome).toBe('unreadable');
		expect(result.failure?.problem).toBe('layout');
		expect(home.vault.written).toEqual([]);
	});

	it('leaves the file as it stands', async () => {
		const home = ports({ [PATH]: 'a note that a person wrote\n' });
		await writeRecord(home, PATH, record('minimal'));
		expect(await home.vault.read(PATH)).toBe(
			'a note that a person wrote\n',
		);
	});
});

describe('the write of a record that another build wrote', () => {
	const OLDER: NormalizationVersions = { core: 1, timezone: 1 };
	const NEWER: NormalizationVersions = { core: 2, timezone: 1 };

	async function fileOf(versions: NormalizationVersions): Promise<string> {
		return sealRecord(digest, record('minimal', versions));
	}

	it('rewrites one time where the device is newer', async () => {
		const home = ports({ [PATH]: await fileOf(OLDER) }, NEWER);
		const result = await writeRecord(home, PATH, record('minimal', NEWER));
		expect(result.outcome).toBe('restamped');
		expect(home.vault.writtenPaths).toEqual([PATH]);
	});

	it('writes nothing on the next run after that rewrite', async () => {
		const home = ports({ [PATH]: await fileOf(OLDER) }, NEWER);
		await writeRecord(home, PATH, record('minimal', NEWER));
		home.vault.forget();
		const result = await writeRecord(home, PATH, record('minimal', NEWER));
		expect(result.outcome).toBe('unchanged');
		expect(home.vault.written).toEqual([]);
	});

	it('writes nothing where the device is older', async () => {
		const home = ports({ [PATH]: await fileOf(NEWER) }, OLDER);
		const result = await writeRecord(home, PATH, record('minimal', OLDER));
		expect(result.outcome).toBe('suppressed');
		expect(home.vault.written).toEqual([]);
	});

	it('writes the new bytes where the state changed and the stamps differ', async () => {
		const home = ports({ [PATH]: await fileOf(NEWER) }, OLDER);
		const result = await writeRecord(
			home,
			PATH,
			record('minimal', OLDER, (data) => ({ ...data, etag: '"9"' })),
		);
		expect(result.outcome).toBe('rewritten');
		expect(home.vault.writtenPaths).toEqual([PATH]);
	});

	it('writes the new bytes where a change of the snapshot reaches the state', async () => {
		const data = record('minimal');
		const changed = (await sealRecord(digest, data)).replace(
			'PRODID:-//Davenport//record golden//EN\n',
			'PRODID:-//Davenport//record golden//EN\nX-EXTRA:1\n',
		);
		const home = ports({ [PATH]: changed });
		const result = await writeRecord(home, PATH, data);
		expect(result.outcome).toBe('rewritten');
	});

	it('writes nothing where the state agrees, the stamps agree, and the bytes do not', async () => {
		// The file holds the properties of the event in another order. The
		// reader gives the canonical order back, so the state agrees and the
		// bytes do not. The skew rule finds no component that is newer, and
		// the device therefore leaves the file alone. The recompute check of
		// the quarantine reads such a file.
		const data = record('minimal');
		const sealed = await sealRecord(digest, data);
		const moved = sealed.replace(
			'DTSTART:20260302T140000Z\nUID:minimal',
			'UID:minimal\nDTSTART:20260302T140000Z',
		);
		expect(moved).not.toBe(sealed);
		const home = ports({ [PATH]: moved });
		const result = await writeRecord(home, PATH, data);
		expect(result.outcome).toBe('suppressed');
		expect(home.vault.written).toEqual([]);
	});
});

describe('the file that arrives while the device computes its own', () => {
	it('keeps a record that stands at the path already, and never asks whether the path is free', async () => {
		// A vault that answers the question "does this path hold a file"
		// leaves a window between the answer and the write. A record that
		// arrives in that window would lose its content, and the skew rule
		// would never read its stamp. The writer asks for a create instead.
		const arriving = await sealRecord(
			digest,
			record('minimal', { core: 9, timezone: 9 }),
		);
		const home = ports({ [PATH]: arriving });
		let asked = 0;
		const watched: RecordWriterPorts = {
			...home,
			vault: {
				read: (path) => home.vault.read(path),
				write: (path, content) => home.vault.write(path, content),
				create: (path, content) => home.vault.create(path, content),
				exists: (path) => {
					asked += 1;
					return home.vault.exists(path);
				},
				rename: (path, newPath) => home.vault.rename(path, newPath),
				trash: (path) => home.vault.trash(path),
				frontmatter: (path) => home.vault.frontmatter(path),
				updateFrontmatter: (path, update) =>
					home.vault.updateFrontmatter(path, update),
				onFileEvent: (handler) => home.vault.onFileEvent(handler),
			},
		};
		const result = await writeRecord(watched, PATH, record('minimal'));
		expect(asked).toBe(0);
		expect(result.outcome).toBe('suppressed');
		expect(await home.vault.read(PATH)).toBe(arriving);
	});

	it('reports a file that stood at the path and that the read did not find', async () => {
		const home = ports({ [PATH]: 'anything' });
		const vanishing: RecordWriterPorts = {
			...home,
			vault: {
				read: () => Promise.reject(new Error('no file at that path')),
				write: (path, content) => home.vault.write(path, content),
				create: () => Promise.resolve(false),
				exists: (path) => home.vault.exists(path),
				rename: (path, newPath) => home.vault.rename(path, newPath),
				trash: (path) => home.vault.trash(path),
				frontmatter: (path) => home.vault.frontmatter(path),
				updateFrontmatter: (path, update) =>
					home.vault.updateFrontmatter(path, update),
				onFileEvent: (handler) => home.vault.onFileEvent(handler),
			},
		};
		const result = await writeRecord(vanishing, PATH, record('minimal'));
		expect(result.outcome).toBe('vanished');
		expect(home.vault.written).toEqual([]);
	});
});
