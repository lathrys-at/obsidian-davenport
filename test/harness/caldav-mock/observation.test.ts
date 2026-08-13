import { describe, expect, it } from 'vitest';
import {
	icsEvent,
	multigetBody,
	propfindBody,
	syncCollectionBody,
} from './fixtures';
import { REQUEST_BODY_CAP } from './observation';
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
	it('keeps the requests in arrival order, with the status of each request', async () => {
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

	it('records the headers and the kind of REPORT that the engine sent', async () => {
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

	it('records the sync token that a request presented, and empty text for an initial sync', async () => {
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

	it('records nothing when a test changes the state without a request', () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'two.ics', SOLO);
		mock.removeResource('alice', 'work', 'two.ics');
		expect(mock.log.entries).toStrictEqual([]);
	});

	it('keeps the body that a write carried', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: WITH_GUEST,
		});
		const [entry] = mock.log.entries;
		expect(entry?.body).toBe(WITH_GUEST);
		expect(entry?.bodyTruncated).toBe(false);
	});

	it('records an empty body for a request that carried no body', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'GET',
		});
		expect(mock.log.entries[0]?.body).toBe('');
	});

	it('cuts a body at the limit and records that the cut occurred', async () => {
		const mock = server();
		const long = icsEvent({
			uid: 'one',
			summary: 'x'.repeat(REQUEST_BODY_CAP),
		});
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: long,
		});
		const [entry] = mock.log.entries;
		expect(entry?.body).toBe(long.slice(0, REQUEST_BODY_CAP));
		expect(entry?.bodyTruncated).toBe(true);
	});

	it('keeps every header that the request carried, credentials included', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: {
				Authorization: 'Basic YWxpY2U6aHVudGVyMg==',
				'If-Match': '"etag-1"',
				'X-Vendor-Token': 'vendor-token',
			},
			body: SOLO,
		});
		expect(mock.log.entries[0]?.headers).toStrictEqual({
			authorization: 'Basic YWxpY2U6aHVudGVyMg==',
			'if-match': '"etag-1"',
			'x-vendor-token': 'vendor-token',
		});
	});

	it('records the content type that the port gives outside the headers', async () => {
		const mock = server();
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			contentType: 'text/calendar; charset=utf-8',
			body: SOLO,
		});
		expect(mock.log.entries[0]?.headers['content-type']).toBe(
			'text/calendar; charset=utf-8',
		);
	});
});

describe('scheduling record', () => {
	it('records a write that adds the first attendees to a resource', async () => {
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

	it('records a write that removes the last attendee', async () => {
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

	it('records a DELETE of a resource that carried attendees', async () => {
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

	it('records an attachment write to a resource that has attendees', async () => {
		const mock = new MockCalDavServer({
			capabilities: { managedAttachments: true },
			accounts: [
				{
					name: 'alice',
					collections: [
						{
							name: 'work',
							resources: [{ name: 'one.ics', ics: WITH_GUEST }],
						},
					],
				},
			],
		});
		const added = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-add`,
			method: 'POST',
			headers: { 'Content-Type': 'text/plain' },
			body: 'agenda text',
		});
		expect(added.status).toBe(201);
		const [entry] = mock.scheduling.entries;
		expect(entry?.method).toBe('POST');
		expect(entry?.transition).toBe('retains');
		expect(entry?.attendeesAfter).toStrictEqual([ORGANIZER, GUEST]);
		expect(entry?.requestIndex).toBe(0);
	});

	it('reads the attendees from a body that uses LF line endings', async () => {
		const mock = server();
		const lineFed = WITH_GUEST.replace(/\r\n/g, '\n');
		await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: lineFed,
		});
		const [entry] = mock.scheduling.entries;
		expect(entry?.transition).toBe('gains');
		expect(entry?.attendeesAfter).toStrictEqual([ORGANIZER, GUEST]);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).toBe(lineFed);
	});

	it('records nothing for a write that touches no attendee', async () => {
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

	it('records nothing for a write that the server refused', async () => {
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

	it('records nothing when a test seeds and removes attendees without a request', () => {
		const mock = server();
		mock.seedResource('alice', 'work', 'two.ics', WITH_GUEST);
		mock.removeResource('alice', 'work', 'two.ics');
		expect(mock.scheduling.entries).toStrictEqual([]);
	});

	it('points each entry at the request that caused the entry', async () => {
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
