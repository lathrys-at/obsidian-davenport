/**
 * Loads the engine and the modules of the fuzzing lane.
 *
 * The engine and the test harness name a module without the extension of
 * the file. Node resolves no such name, because the resolver of Node needs
 * the extension. The bundler and the test runner both resolve it. This
 * module therefore loads that code through jiti, which resolves a name the
 * way the bundler does. jiti already stands in the dependencies for the
 * lint configuration.
 *
 * The command of the lane is a file that Node runs directly, and such a
 * file carries no types. This module holds the load, so the command
 * receives one object whose parts all carry their types.
 */

import { createJiti } from 'jiti';
import type { JCalComponent } from '../src/core/ics/jcal.ts';
import type { IcsParseResult } from '../src/core/ics/parse.ts';
import type * as Campaign from './fuzz-ics-campaign.ts';
import type * as Core from './fuzz-ics-core.ts';
import type * as Text from './fuzz-ics-text.ts';

/** Everything that the command of the lane needs. */
export interface FuzzLane {
	readonly engine: Core.IcsEngine;
	readonly core: typeof Core;
	readonly campaign: typeof Campaign;
	readonly text: typeof Text;
	/** The seed that the property tests use when nobody names another. */
	readonly defaultSeed: number;
}

export async function loadFuzzLane(): Promise<FuzzLane> {
	const jiti = createJiti(import.meta.url);
	const parse = await jiti.import<{
		parseIcs: (text: string) => IcsParseResult;
	}>('../src/core/ics/parse.ts');
	const serializer = await jiti.import<{
		serializeCalendar: (calendar: JCalComponent) => string;
	}>('../src/core/ics/serializer.ts');
	const seed = await jiti.import<{ propertySeed: () => number }>(
		'../test/harness/arbitraries/seed.ts',
	);
	return {
		engine: {
			parseIcs: parse.parseIcs,
			serializeCalendar: serializer.serializeCalendar,
		},
		core: await jiti.import<typeof Core>('./fuzz-ics-core.ts'),
		campaign: await jiti.import<typeof Campaign>('./fuzz-ics-campaign.ts'),
		text: await jiti.import<typeof Text>('./fuzz-ics-text.ts'),
		defaultSeed: seed.propertySeed(),
	};
}
