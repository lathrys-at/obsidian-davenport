import { describe, expect, it } from 'vitest';
import type { HttpTransport } from '../../../src/core/ports/transport';
import type { FeedEventSpec } from './events';
import { applyFeedDeltas, decadeSpanningCorpus, timedAt } from './events';
import type { FeedFixture, FeedScript } from './server';
import { FeedScriptError, createFeedFixture, scriptedPolls } from './server';
import type { FeedVariant } from './variants';
import { emptyCalendar, events, loginWall, raw, truncated } from './variants';

const REFERENCE_TIME = Date.UTC(2026, 7, 10, 12, 0, 0);
const HOUR_MS = 3_600_000;
const FEED_URL = 'https://feeds.example.test/team.ics';

const meeting: FeedEventSpec = {
	id: 'meeting',
	uid: 'meeting@feed.test',
	summary: 'Meeting',
	start: timedAt(REFERENCE_TIME),
	end: timedAt(REFERENCE_TIME + HOUR_MS),
};

const standup: FeedEventSpec = {
	id: 'standup',
	uid: 'standup@feed.test',
	summary: 'Standup',
	start: timedAt(REFERENCE_TIME + HOUR_MS),
};

function fixtureFor(script: FeedScript): FeedFixture {
	return createFeedFixture({
		referenceTime: REFERENCE_TIME,
		feeds: { [FEED_URL]: script },
	});
}

async function poll(fixture: FeedFixture): Promise<string> {
	const response = await fixture.request({ url: FEED_URL });
	return response.text;
}

async function pollBytes(fixture: FeedFixture): Promise<number[]> {
	const response = await fixture.request({ url: FEED_URL });
	return [...new Uint8Array(response.arrayBuffer)];
}

describe('scripted polls', () => {
	it('serves the variant that the script names for each poll, in order', async () => {
		const fixture = fixtureFor({
			polls: [
				events([meeting, standup]),
				truncated(events([meeting, standup])),
				loginWall(),
				emptyCalendar(),
			],
		});
		expect(await poll(fixture)).toContain('END:VCALENDAR');
		expect(await poll(fixture)).not.toContain('END:VCALENDAR');
		expect(await poll(fixture)).toContain('Sign in required');
		const fourth = await poll(fixture);
		expect(fourth).toContain('END:VCALENDAR');
		expect(fourth).not.toContain('BEGIN:VEVENT');
		expect(fixture.pollsServed(FEED_URL)).toBe(4);
	});

	it('serves a different variant at one named poll of a base run', async () => {
		const fixture = fixtureFor({
			polls: scriptedPolls({
				base: events([meeting]),
				count: 4,
				at: { 3: truncated(events([meeting])) },
			}),
		});
		const served = [
			await poll(fixture),
			await poll(fixture),
			await poll(fixture),
			await poll(fixture),
		];
		expect(served.map((text) => text.includes('END:VCALENDAR'))).toEqual([
			true,
			true,
			false,
			true,
		]);
	});

	it('refuses a named poll outside the run, and a run with no polls', () => {
		expect(() =>
			scriptedPolls({
				base: emptyCalendar(),
				count: 2,
				at: { 5: loginWall() },
			}),
		).toThrow(/outside the scripted run 1\.\.2/);
		expect(() =>
			scriptedPolls({ base: emptyCalendar(), count: 0 }),
		).toThrow(/at least one poll/);
	});

	it('serves the last variant again after the script runs out', async () => {
		const fixture = fixtureFor({
			polls: [loginWall(), events([meeting])],
		});
		await poll(fixture);
		const second = await poll(fixture);
		expect(await poll(fixture)).toBe(second);
		expect(await poll(fixture)).toBe(second);
	});

	it('serves the variant that the beyond option declares, after the script runs out', async () => {
		const fixture = fixtureFor({
			polls: [events([meeting])],
			beyond: loginWall(),
		});
		expect(await poll(fixture)).toContain('BEGIN:VEVENT');
		expect(await poll(fixture)).toContain('Sign in required');
	});

	it('rejects with a script error when a script set to exhausted runs out', async () => {
		const fixture = fixtureFor({
			polls: [events([meeting])],
			beyond: 'exhausted',
		});
		await poll(fixture);
		const rejection = fixture.request({ url: FEED_URL });
		await expect(rejection).rejects.toBeInstanceOf(FeedScriptError);
		await expect(rejection).rejects.toThrow(/nothing to serve/);
		expect(fixture.pollsServed(FEED_URL)).toBe(1);
		expect(fixture.log).toHaveLength(1);
	});

	it('carries the script error through a transport that wraps the fixture', async () => {
		const fixture = fixtureFor({
			polls: [events([meeting])],
			beyond: 'exhausted',
		});
		const retrying: HttpTransport = {
			async request(req) {
				return fixture.request(req);
			},
		};
		expect((await retrying.request({ url: FEED_URL })).status).toBe(200);
		await expect(
			retrying.request({ url: FEED_URL }),
		).rejects.toBeInstanceOf(FeedScriptError);
	});

	it('refuses a script with a gap in its run', () => {
		const polls: FeedVariant[] = [];
		polls[2] = events([meeting]);
		expect(() => fixtureFor({ polls })).toThrow(FeedScriptError);
		expect(() => fixtureFor({ polls })).toThrow(
			/no variant for poll 1 of 3/,
		);
	});

	it('refuses a feed that declares no polls', () => {
		expect(() => fixtureFor({ polls: [] })).toThrow(/declares no polls/);
		expect(() => fixtureFor({ polls: [], beyond: 'exhausted' })).toThrow(
			/declares no polls/,
		);
	});
});

describe('determinism', () => {
	const script = (): FeedScript => ({
		polls: [
			events([meeting, standup], {
				dtstampChurn: true,
				uidReminting: true,
			}),
			events([meeting, standup], {
				dtstampChurn: true,
				uidReminting: true,
			}),
			truncated(events([meeting, standup], { dtstampChurn: true })),
		],
	});

	it('serves the same octets from two identical scripts', async () => {
		const one = fixtureFor(script());
		const other = fixtureFor(script());
		for (let index = 0; index < 5; index++) {
			expect(await pollBytes(one)).toEqual(await pollBytes(other));
		}
	});

	it('replays the script from its first poll after a reset', async () => {
		const fixture = fixtureFor(script());
		const first = await pollBytes(fixture);
		await poll(fixture);
		fixture.reset();
		expect(fixture.pollsServed(FEED_URL)).toBe(0);
		expect(await pollBytes(fixture)).toEqual(first);
		expect(fixture.log).toHaveLength(1);
	});

	it('churns DTSTAMP and re-mints UIDs from the poll counter, and not from elapsed time', async () => {
		const fixture = fixtureFor(script());
		const first = await poll(fixture);
		fixture.reset();
		expect(await poll(fixture)).toBe(first);
	});
});

describe('content that changes between polls', () => {
	it('adds, removes, modifies, and reschedules an event between polls', async () => {
		const first = [meeting, standup];
		const second = applyFeedDeltas(first, [
			{ kind: 'remove', id: 'standup' },
			{
				kind: 'add',
				event: {
					id: 'review',
					uid: 'review@feed.test',
					summary: 'Review',
					start: timedAt(REFERENCE_TIME + 2 * HOUR_MS),
				},
			},
		]);
		const third = applyFeedDeltas(second, [
			{
				kind: 'modify',
				id: 'meeting',
				changes: { summary: 'Meeting v2' },
			},
			{
				kind: 'reschedule',
				id: 'review',
				start: timedAt(REFERENCE_TIME + 48 * HOUR_MS),
			},
		]);
		const fixture = fixtureFor({
			polls: [events(first), events(second), events(third)],
		});
		const one = await poll(fixture);
		expect(one).toContain('UID:standup@feed.test');
		const two = await poll(fixture);
		expect(two).not.toContain('UID:standup@feed.test');
		expect(two).toContain('UID:review@feed.test');
		const three = await poll(fixture);
		expect(three).toContain('SUMMARY:Meeting v2');
		expect(three).toContain('DTSTART:20260812T120000Z');
	});

	it('serves a corpus that spans a decade, and serves it whole on every poll', async () => {
		const corpus = decadeSpanningCorpus({
			referenceTime: REFERENCE_TIME,
			perYear: 2,
		});
		const fixture = fixtureFor({ polls: [events(corpus)] });
		const text = await poll(fixture);
		expect(text.split('BEGIN:VEVENT').length - 1).toBe(corpus.length);
		expect(text).toContain('DTSTART;VALUE=DATE:20210115');
		expect(text).toContain('DTSTART;VALUE=DATE:20310715');
	});
});

describe('behavior at the transport port', () => {
	const script: FeedScript = { polls: [events([meeting])] };

	it('answers 404 for a URL with no script, and serves no poll', async () => {
		const fixture = fixtureFor(script);
		const response = await fixture.request({
			url: 'https://feeds.example.test/other.ics',
		});
		expect(response.status).toBe(404);
		expect(fixture.pollsServed(FEED_URL)).toBe(0);
	});

	it('answers 405 for a method other than GET, and serves no poll', async () => {
		const fixture = fixtureFor(script);
		const response = await fixture.request({
			url: FEED_URL,
			method: 'PUT',
		});
		expect(response.status).toBe(405);
		expect(fixture.pollsServed(FEED_URL)).toBe(0);
	});

	it('serves the same octets through text and arrayBuffer', async () => {
		const fixture = fixtureFor(script);
		const response = await fixture.request({ url: FEED_URL });
		expect(new TextDecoder().decode(response.arrayBuffer)).toBe(
			response.text,
		);
		expect(response.headers['content-type']).toBe(
			'text/calendar; charset=utf-8',
		);
	});

	it('hands out a new buffer on each poll', async () => {
		const fixture = fixtureFor({
			polls: [raw(Uint8Array.from([1, 2, 3]))],
		});
		const first = await fixture.request({ url: FEED_URL });
		new Uint8Array(first.arrayBuffer)[0] = 9;
		const second = await fixture.request({ url: FEED_URL });
		expect([...new Uint8Array(second.arrayBuffer)]).toEqual([1, 2, 3]);
	});

	it('logs every request with the number of the poll that it served', async () => {
		const fixture = fixtureFor(script);
		await fixture.request({ url: FEED_URL });
		await fixture.request({ url: FEED_URL, method: 'DELETE' });
		await fixture.request({ url: FEED_URL });
		expect(fixture.log).toEqual([
			{ url: FEED_URL, method: 'GET', status: 200, poll: 1 },
			{ url: FEED_URL, method: 'DELETE', status: 405, poll: 0 },
			{ url: FEED_URL, method: 'GET', status: 200, poll: 2 },
		]);
	});

	it('keeps one poll counter for each feed', async () => {
		const other = 'https://feeds.example.test/holidays.ics';
		const fixture = createFeedFixture({
			referenceTime: REFERENCE_TIME,
			feeds: {
				[FEED_URL]: script,
				[other]: { polls: [emptyCalendar()] },
			},
		});
		await fixture.request({ url: FEED_URL });
		await fixture.request({ url: FEED_URL });
		await fixture.request({ url: other });
		expect(fixture.pollsServed(FEED_URL)).toBe(2);
		expect(fixture.pollsServed(other)).toBe(1);
	});
});

describe('variant reuse', () => {
	it('renders one shared variant the same way at each place it appears', async () => {
		const shared: FeedVariant = events([meeting]);
		const fixture = fixtureFor({ polls: [shared, loginWall(), shared] });
		const first = await poll(fixture);
		await poll(fixture);
		expect(await poll(fixture)).toBe(first);
	});
});
