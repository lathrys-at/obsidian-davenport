import { describe, expect, it } from 'vitest';
import type { IcsGoldenSet } from '../../../test/harness/fixtures/ics-serializer';
import {
	icsGoldenInputs,
	icsGoldenSet,
	icsGoldenSetPath,
	icsGoldenSets,
	icsGoldenText,
	icsGoldenWriteRequested,
	writeIcsGoldenSet,
} from '../../../test/harness/fixtures/ics-serializer';
import { serializeIcs } from './serializer';
import { CORE_NORMALIZATION_VERSION } from './stamp';

const CURRENT = CORE_NORMALIZATION_VERSION;
const NEXT = CURRENT + 1;

/**
 * The instruction that every failure of this file ends with. A change to
 * the bytes of the serializer and a change to the core component of the
 * stamp are one change, and this text says how to make it.
 */
const HOW_TO_MOVE =
	`Raise CORE_NORMALIZATION_VERSION in src/core/ics/stamp.ts to ${String(NEXT)}. ` +
	'Then write the new golden set with ' +
	'DAVENPORT_WRITE_ICS_GOLDENS=1 npm test -- serializer-goldens. ' +
	`The set of ${String(CURRENT)} stays in the tree, and the closure test reads it.`;

function serialize(text: string): string {
	const result = serializeIcs(text);
	if (!result.ok) {
		throw new Error(
			`the serializer refused the text: ${result.failure.message}`,
		);
	}
	return result.text;
}

function currentEntries(): { id: string; text: string }[] {
	return icsGoldenInputs().map((input) => ({
		id: input.id,
		text: serialize(input.text),
	}));
}

function requireCurrentSet(): IcsGoldenSet {
	const set = icsGoldenSet(CURRENT);
	if (set === undefined) {
		throw new Error(
			`the core component of the normalization stamp is ${String(CURRENT)}, and the repository holds no golden set for it. ` +
				`Write the set to ${icsGoldenSetPath(CURRENT)} with DAVENPORT_WRITE_ICS_GOLDENS=1 npm test -- serializer-goldens.`,
		);
	}
	return set;
}

if (icsGoldenWriteRequested()) {
	describe('the golden corpus of the serializer', () => {
		it('writes the set of the current core component, and then fails', () => {
			const path = writeIcsGoldenSet(CURRENT, currentEntries());
			expect.fail(
				`the run wrote the golden set of the core component ${String(CURRENT)} to ${path}. ` +
					'Read the difference. Then run the tests again with the variable unset.',
			);
		});
	});
} else {
	describe('the golden corpus of the serializer', () => {
		it('holds a set for the core component of this build', () => {
			expect(icsGoldenSet(CURRENT)).toBeDefined();
		});

		it('holds one golden file for each input of the gate', () => {
			expect(requireCurrentSet().ids).toEqual(
				icsGoldenInputs()
					.map((input) => input.id)
					.sort(),
			);
		});

		it.each(icsGoldenInputs())(
			'writes the committed bytes for $id',
			(input) => {
				const set = requireCurrentSet();
				expect(
					serialize(input.text),
					`the serializer writes different bytes for ${input.id}, and the core component of the normalization stamp is still ${String(CURRENT)}. ` +
						`A change to the bytes of the serializer moves that component in the same change. ${HOW_TO_MOVE}`,
				).toBe(icsGoldenText(set, input.id));
			},
		);
	});

	describe('the closure of the serializer over its earlier bytes', () => {
		it('holds at least the set of this build', () => {
			expect(icsGoldenSets().map((set) => set.core)).toContain(CURRENT);
		});

		for (const set of icsGoldenSets()) {
			const current = requireCurrentSet();
			const shared = set.ids.filter((id) => current.ids.includes(id));

			it(`shares files with the set that the build of the core component ${String(set.core)} wrote`, () => {
				expect(shared.length).toBeGreaterThan(0);
			});

			it.each(shared)(
				`gives the bytes of this build for %s from the set that the build of the core component ${String(set.core)} wrote`,
				(id) => {
					expect(
						serialize(icsGoldenText(set, id)),
						`the serializer of this build does not absorb the bytes that the build of the core component ${String(set.core)} wrote for ${id}. ` +
							'The serializer must map every earlier serialization of the same content onto the bytes of this build. ' +
							'Without that property a device that runs an older build cannot tell a byte-only difference from a real one.',
					).toBe(icsGoldenText(current, id));
				},
			);
		}
	});
}
