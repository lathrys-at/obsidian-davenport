/**
 * The feed fixture: a scripted ICS feed server behind the transport port,
 * with the event specifications and per-poll edits its bodies are built from.
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
	escapeIcsText,
	foldIcsLine,
	icsDateStamp,
	icsText,
	icsUtcStamp,
	octetLength,
} from './ics-text';
export type {
	BeyondScript,
	FeedFixture,
	FeedFixtureOptions,
	FeedRequestRecord,
	FeedScript,
	ScriptedPollsOptions,
} from './server';
export { createFeedFixture, scriptedPolls } from './server';
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
