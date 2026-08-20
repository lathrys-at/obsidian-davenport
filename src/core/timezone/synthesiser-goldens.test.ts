import { describe, expect, it } from 'vitest';
import type { TimezoneGoldenSet } from '../../../test/harness/fixtures/timezone-synthesiser';
import {
	TIMEZONE_GOLDEN_ZONES,
	timezoneGoldenSet,
	timezoneGoldenSetPath,
	timezoneGoldenSets,
	timezoneGoldenText,
	timezoneGoldenWriteRequested,
	writeTimezoneGoldenSet,
} from '../../../test/harness/fixtures/timezone-synthesiser';
import { parseIcs } from '../ics/parse';
import { serializeCalendar } from '../ics/serializer';
import { TIMEZONE_NORMALIZATION_VERSION } from '../ics/stamp';
import { synthesiseTimezone } from './synthesiser';

const CURRENT = TIMEZONE_NORMALIZATION_VERSION;
const NEXT = CURRENT + 1;

const WRITE_COMMAND =
	'DAVENPORT_WRITE_TIMEZONE_GOLDENS=1 npm test -- synthesiser-goldens';

/**
 * The instruction that a byte difference of this file ends with. Three
 * causes give one difference, and each cause takes a different action.
 */
const HOW_TO_MOVE =
	'Three causes give this difference. ' +
	'First, the synthesiser or the bundled table changed. ' +
	`Raise TIMEZONE_NORMALIZATION_VERSION in src/core/ics/stamp.ts to ${String(NEXT)}. ` +
	`Then write the new set with ${WRITE_COMMAND}. ` +
	`The set of the timezone component ${String(CURRENT)} stays in the tree, and the closure test reads it. ` +
	'Second, a committed golden file changed and the synthesiser did not. ' +
	'Read git status on the set. ' +
	'Then restore the file. ' +
	'Third, the canonical serializer changed how a definition renders. ' +
	'That change moves the core component of the stamp, and it does not move the timezone component. ' +
	`Write the set of the timezone component ${String(CURRENT)} again in place with ${WRITE_COMMAND}.`;

function definitionText(name: string): string {
	const result = synthesiseTimezone(name);
	if (!result.ok) {
		throw new Error(`the bundled table holds no zone named ${name}`);
	}
	return serializeCalendar(result.component);
}

function currentEntries(): { id: string; text: string }[] {
	return TIMEZONE_GOLDEN_ZONES.map((zone) => ({
		id: zone.id,
		text: definitionText(zone.name),
	}));
}

function requireCurrentSet(): TimezoneGoldenSet {
	const set = timezoneGoldenSet(CURRENT);
	if (set === undefined) {
		throw new Error(
			`the timezone component of the normalization stamp is ${String(CURRENT)}, and the repository holds no golden set for it. ` +
				`Write the set to ${timezoneGoldenSetPath(CURRENT)} with ${WRITE_COMMAND}.`,
		);
	}
	return set;
}

/** The definition that one text holds, read back through the boundary. */
function readBack(text: string): string {
	const parsed = parseIcs(
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Davenport//timezone golden//EN',
			text.trimEnd(),
			'END:VCALENDAR',
			'',
		].join('\r\n'),
	);
	if (!parsed.ok) {
		throw new Error(
			`the boundary refused a golden definition: ${parsed.failure.message}`,
		);
	}
	const definition = parsed.calendar[2].find(
		(component) => component[0].toLowerCase() === 'vtimezone',
	);
	if (definition === undefined) {
		throw new Error('a golden file holds no timezone definition');
	}
	return serializeCalendar(definition);
}

if (timezoneGoldenWriteRequested()) {
	describe('the golden corpus of the timezone synthesiser', () => {
		it('writes the set of the current timezone component, and then fails', () => {
			const path = writeTimezoneGoldenSet(CURRENT, currentEntries());
			expect.fail(
				`the run wrote the golden set of the timezone component ${String(CURRENT)} to ${path}. ` +
					'Read the difference. Then run the tests again with the variable unset.',
			);
		});
	});
} else {
	describe('the golden corpus of the timezone synthesiser', () => {
		it('holds a set for the timezone component of this build', () => {
			expect(timezoneGoldenSet(CURRENT)).toBeDefined();
		});

		it('holds one golden file for each zone of the gate', () => {
			expect(requireCurrentSet().ids).toEqual(
				TIMEZONE_GOLDEN_ZONES.map((zone) => zone.id).sort(),
			);
		});

		it('gives each zone of the gate its own file name', () => {
			const ids = TIMEZONE_GOLDEN_ZONES.map((zone) => zone.id);
			expect(new Set(ids).size).toBe(ids.length);
		});

		it.each(TIMEZONE_GOLDEN_ZONES)(
			'writes the committed bytes for $name',
			(zone) => {
				const set = requireCurrentSet();
				expect(
					definitionText(zone.name),
					`the synthesiser writes different bytes for ${zone.name}, and the timezone component of the normalization stamp is still ${String(CURRENT)}. ${HOW_TO_MOVE}`,
				).toBe(timezoneGoldenText(set, zone.id));
			},
		);
	});

	describe('the canonical form of every committed definition', () => {
		it('holds at least the set of this build', () => {
			expect(timezoneGoldenSets().map((set) => set.timezone)).toContain(
				CURRENT,
			);
		});

		for (const set of timezoneGoldenSets()) {
			it.each(set.ids)(
				`keeps the bytes of %s of the set that the timezone component ${String(set.timezone)} wrote`,
				(id) => {
					const text = timezoneGoldenText(set, id);
					expect(
						readBack(text),
						`the definition that the build of the timezone component ${String(set.timezone)} wrote for ${id} is not canonical under the serializer of this build. ` +
							'Every committed definition must stand in the canonical order of this build, and this test holds each one to that. ' +
							'The synthesiser writes such a component by construction, so a change to the order rules of the serializer changes the synthesiser in the same change. ' +
							'A failure here states that one of the two moved and the other stayed. ' +
							'The two then give different bytes for one definition, and a device cannot tell a byte-only difference from a real one. ' +
							'This test has one limit: a wrong value inside an old set passes it. ' +
							'Two sets of this gate hold different content, because the release of the table moves between them, so no comparison of an old set against this set can exist.',
					).toBe(text);
				},
			);
		}
	});
}
