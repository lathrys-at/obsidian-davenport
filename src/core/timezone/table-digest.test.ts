import { describe, expect, it } from 'vitest';
import {
	timezoneTableDigest,
	timezoneTableDigestPath,
	timezoneTableDigestWriteRequested,
	timezoneTableDigests,
	writeTimezoneTableDigest,
} from '../../../test/harness/fixtures/timezone-table';
import { WebCryptoDigest } from '../../adapters/digest';
import { serializeCalendar } from '../ics/serializer';
import { TIMEZONE_NORMALIZATION_VERSION } from '../ics/stamp';
import { synthesiseTimezone } from './synthesiser';
import { TIMEZONE_TABLE_RELEASE, timezoneNames } from './table';

const CURRENT = TIMEZONE_NORMALIZATION_VERSION;
const NEXT = CURRENT + 1;
const digest = new WebCryptoDigest();

const WRITE_COMMAND =
	'DAVENPORT_WRITE_TIMEZONE_DIGEST=1 npm test -- table-digest';

/**
 * The instruction that a difference of the digest ends with. Three causes
 * give one difference, and each cause takes a different action.
 */
const HOW_TO_MOVE =
	'Three causes give this difference. ' +
	'First, the bundled table or the synthesiser changed. ' +
	`Raise TIMEZONE_NORMALIZATION_VERSION in src/core/ics/stamp.ts to ${String(NEXT)}. ` +
	`Then write the digest of the new value with ${WRITE_COMMAND}. ` +
	'Do these two steps in the change that moves the bytes. ' +
	'The comparison of two records reads the two base snapshots whole where the two records carry one value of that component. ' +
	'Two builds can write different definitions under one value of the component. ' +
	'Those two builds then rewrite one record in turn, and neither build stops. ' +
	`The digest of the timezone component ${String(CURRENT)} stays in the tree, and it records what that build wrote. ` +
	'Second, the committed digest changed and the code did not. ' +
	'Read git status on the file. ' +
	'Then restore the file. ' +
	'Third, the canonical serializer changed how a definition renders. ' +
	'That change moves the core component of the stamp, and it does not move the timezone component. ' +
	`Write the digest of the timezone component ${String(CURRENT)} again in place with ${WRITE_COMMAND}.`;

/**
 * The message that a component with no committed digest gives. Two tests
 * give this message: the test that reads the file, and the comparison.
 */
const NO_DIGEST =
	`the timezone component of the normalization stamp is ${String(CURRENT)}, and the repository holds no digest for it. ` +
	`Write the digest to ${timezoneTableDigestPath(CURRENT)} with ${WRITE_COMMAND}.`;

/**
 * The committed digest of the current timezone component. The comparison
 * reads the digest through this function. A raise of the component
 * therefore gives the message of a file that no build wrote, and it does
 * not give the message of a difference of the bytes.
 */
function requireCurrentDigest(): string {
	const committed = timezoneTableDigest(CURRENT);
	if (committed === undefined) {
		throw new Error(NO_DIGEST);
	}
	return committed;
}

function definitionText(name: string): string {
	const result = synthesiseTimezone(name);
	if (!result.ok) {
		throw new Error(`the bundled table holds no zone named ${name}`);
	}
	return serializeCalendar(result.component);
}

/** The name and the definition of each zone, in the order of the table. */
const ENTRIES: readonly (readonly [string, string])[] = timezoneNames().map(
	(name) => [name, definitionText(name)] as const,
);

/**
 * The text that the digest covers. The text states the release of the
 * bundled table, then the name and the definition of each zone.
 */
function tableText(): string {
	const parts: string[] = [TIMEZONE_TABLE_RELEASE];
	for (const [name, definition] of ENTRIES) {
		parts.push(name, definition);
	}
	return parts.join('\n');
}

if (timezoneTableDigestWriteRequested()) {
	describe('the digest of the whole synthesised table', () => {
		it('writes the digest of the current timezone component, and then fails', async () => {
			const path = writeTimezoneTableDigest(
				CURRENT,
				await digest.sha256Hex(tableText()),
			);
			expect.fail(
				`the run wrote the digest of the timezone component ${String(CURRENT)} to ${path}. ` +
					'Read the difference. Then run the tests again with the variable unset.',
			);
		});
	});
} else {
	describe('the digest of the whole synthesised table', () => {
		it('holds a digest for the timezone component of this build', () => {
			expect(timezoneTableDigest(CURRENT), NO_DIGEST).toBeDefined();
		});

		it('reads a definition for every name that the bundled table holds', () => {
			expect(ENTRIES.length).toBe(timezoneNames().length);
			expect(ENTRIES.length).toBeGreaterThan(0);
		});

		it('writes the committed digest over every zone of the table', async () => {
			const committed = requireCurrentDigest();
			expect(
				await digest.sha256Hex(tableText()),
				`the definition of one zone of the table holds different bytes, and the timezone component of the normalization stamp is still ${String(CURRENT)}. ${HOW_TO_MOVE}`,
			).toBe(committed);
		});

		it('holds one digest of sixty-four hexadecimal characters in each committed file', () => {
			for (const entry of timezoneTableDigests()) {
				expect(
					entry.digest,
					`${entry.path} holds no digest of the shape that this gate writes`,
				).toMatch(/^[0-9a-f]{64}$/);
			}
		});
	});
}
