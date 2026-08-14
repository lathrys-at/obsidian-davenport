/**
 * The feed fixture. The fixture is an ICS feed server that runs in the test
 * process. ICS is the file format that the iCalendar standard defines. A
 * poll is one fetch of a feed.
 *
 * The fixture sits behind the transport port. The plugin makes every network
 * call through that port. A test can therefore put the fixture in the place
 * of the network.
 *
 * This file is the entry point of the fixture. The file collects four parts:
 *
 * 1. The server, and the script that states what the feed serves for each
 *    poll.
 * 2. The variants. A variant states what one poll of a feed serves.
 * 3. The event specifications that the fixture builds a feed body from, and
 *    the edits that a script applies to those events between two polls.
 * 4. The functions that write iCalendar text, and the functions that measure
 *    and encode that text in octets. An octet is one byte.
 */

export type {
	DecadeCorpusOptions,
	FeedDelta,
	FeedEventChanges,
	FeedEventSpec,
	FeedInstant,
} from './events';
export {
	allDayOn,
	applyFeedDeltas,
	decadeSpanningCorpus,
	instantLine,
	timedAt,
} from './events';
export {
	ICS_LINE_OCTET_LIMIT,
	encodeIcsBytes,
	octetLength,
} from '../ics-octets';
export {
	escapeIcsText,
	foldIcsLine,
	icsDateStamp,
	icsText,
	icsUtcStamp,
} from './ics-text';
export type {
	BeyondScript,
	FeedFixture,
	FeedFixtureOptions,
	FeedRequestRecord,
	FeedScript,
	ScriptedPollsOptions,
} from './server';
export { FeedScriptError, createFeedFixture, scriptedPolls } from './server';
export type {
	EventsVariantOptions,
	FeedVariant,
	FeedVariantContext,
	ServedBody,
	TruncationPoint,
} from './variants';
export {
	LOGIN_WALL_HTML,
	emptyCalendar,
	events,
	keepFraction,
	keepOctets,
	loginWall,
	raw,
	renderVariant,
	truncated,
} from './variants';
