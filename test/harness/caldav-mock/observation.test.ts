import { describe, expect, it } from 'vitest';
import {
	icsEvent,
	multigetBody,
	propfindBody,
	syncCollectionBody,
} from './fixtures';
import { MockCalDavServer } from './server';

const WORK = '/calendars/alice/work/';
const ORGANIZER = 'mailto:alice@davenport.test';
const GUEST = 'mailto:bob@davenport.test';

const SOLO = icsEvent({ uid: 'one', start: '20260310T090000Z' });
const WITH_GUEST = icsEvent({
	uid: 'one',
	start: '20260310T090000Z',
	attendees: [ORGANIZER, GUEST],
});

function server(): MockCalDavServer {
	return new MockCalDavServer({
		accounts: [
			{
				name: 'alice',
				collections: [
					{
						name: 'work',
						resources: [{ name: 'one.ics', ics: SOLO }],
					},
				],
			},
		],
	});
}

describe('request log', () => {
	it('keeps requests in arrival order with the status each received', async () => {
		const mock = server();
		await mock.request({
			url: mock.principalUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['c:calendar-home-set']),
		});
		await mock.request({
			url: mock.homeUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '1' },
			body: propfindBody(['d:displayname']),
		});
		await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'missing.ics'),
			method: 'GET',
		});

		expect(mock.log.methods).toStrictEqual([
			'PROPFIND',
			'PROPFIND',
			'REPORT',
			'GET',
		]);
		expect(mock.log.paths).toStrictEqual([
			'/principals/alice/',
			'/calendars/alice/',
			WORK,
			`${WORK}missing.ics`,
		]);
		expect(mock.log.entries.map((entry) => entry.status)).toStrictEqual([
			207, 207, 207, 404,
		]);
		expect(mock.log.entries.map((entry) => entry.index)).toStrictEqual([
			0, 1, 2, 3,
		]);
		expect(mock.log.count('PROPFIND')).toBe(2);
		expect(mock.log.forPath(WORK)).toHaveLength(1);
	});

	it('records the headers and report the engine sent', async () => {
		const mock = server();
		await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: multigetBody([`${WORK}one.ics`]),
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': '"etag-1"' },
			body: SOLO,
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'new.ics'),
			method: 'PUT',
			headers: { 'if-none-match': '*' },
			body: icsEvent({ uid: 'new' }),
		});

		const [report, update, creation] = mock.log.entries;
		expect(report?.report).toBe('calendar-multiget');
		expect(report?.syncToken).toBeNull();
		expect(update?.ifMatch).toBe('"etag-1"');
		expect(creation?.ifNoneMatch).toBe('*');
	});

	it('records the token a sync presented, empty for an initial sync', async () => {
		const mock = server();
		await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		const token = mock.syncToken('alice', 'work');
		await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(token),
		});
		expect(mock.log.entries.map((entry) => entry.syncToken)).toStrictEqual([
			'',
			token,
		]);
	});

	it('counts nothing for state changed out of band', () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'two.ics', SOLO);
		mock.removeResource('alice', 'work', 'two.ics');
		expect(mock.log.entries).toStrictEqual([]);
	});
});

describe('scheduling record', () => {
	it('records a write that gains attendees', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: WITH_GUEST,
		});
		const [entry] = mock.scheduling.entries;
		expect(entry?.transition).toBe('gains');
		expect(entry?.method).toBe('PUT');
		expect(entry?.href).toBe(`${WORK}one.ics`);
		expect(entry?.attendeesBefore).toStrictEqual([]);
		expect(entry?.attendeesAfter).toStrictEqual([ORGANIZER, GUEST]);
		expect(entry?.requestIndex).toBe(0);
	});

	it('records a write to a resource that already had attendees', async () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'one.ics', WITH_GUEST);
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: icsEvent({
				uid: 'one',
				start: '20260311T090000Z',
				attendees: [ORGANIZER, GUEST],
			}),
		});
		expect(mock.scheduling.entries[0]?.transition).toBe('retains');
	});

	it('records a write that drops the last attendee', async () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'one.ics', WITH_GUEST);
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: SOLO,
		});
		const [entry] = mock.scheduling.entries;
		expect(entry?.transition).toBe('loses');
		expect(entry?.attendeesBefore).toStrictEqual([ORGANIZER, GUEST]);
		expect(entry?.attendeesAfter).toStrictEqual([]);
	});

	it('records deleting a resource that carried attendees', async () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'one.ics', WITH_GUEST);
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'DELETE',
		});
		const [entry] = mock.scheduling.entries;
		expect(entry?.method).toBe('DELETE');
		expect(entry?.transition).toBe('loses');
		expect(entry?.attendeesBefore).toStrictEqual([ORGANIZER, GUEST]);
	});

	it('records nothing for writes that touch no attendee', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: icsEvent({ uid: 'one', summary: 'moved' }),
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'DELETE',
		});
		expect(mock.scheduling.entries).toStrictEqual([]);
	});

	it('records nothing for a write the server refused', async () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'one.ics', WITH_GUEST);
		const refused = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': '"etag-stale"' },
			body: SOLO,
		});
		expect(refused.status).toBe(412);
		expect(mock.scheduling.entries).toStrictEqual([]);
	});

	it('records nothing for attendee-bearing state seeded out of band', () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'two.ics', WITH_GUEST);
		mock.removeResource('alice', 'work', 'two.ics');
		expect(mock.scheduling.entries).toStrictEqual([]);
	});

	it('points each entry at the request that caused it', async () => {
		const mock = server();
		await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: WITH_GUEST,
		});
		const [entry] = mock.scheduling.entries;
		expect(entry?.requestIndex).toBe(1);
		expect(mock.log.entries[entry?.requestIndex ?? -1]?.method).toBe('PUT');
		expect(mock.scheduling.forHref(`${WORK}one.ics`)).toHaveLength(1);
	});
});
