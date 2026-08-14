import { describe, expect, it } from 'vitest';
import type { MockServerCapabilities } from './capabilities';
import {
	calendarQueryBody,
	errorConditionIn,
	hrefsIn,
	icsEvent,
	propfindBody,
	readMultistatus,
	syncCollectionBody,
	syncTokenIn,
} from './fixtures';
import { icsLogicalLines, icsPhysicalLines } from '../ics-lines';
import { ICS_LINE_OCTET_LIMIT, octetLength } from '../ics-octets';
import { MockCalDavServer } from './server';
import { CALDAV_NS, descendantsNamed, parseXml } from './xml';

const EVENT = icsEvent({
	uid: 'one',
	start: '20260310T090000Z',
	end: '20260310T100000Z',
});

function server(
	capabilities: Partial<MockServerCapabilities> = {},
): MockCalDavServer {
	return new MockCalDavServer({
		capabilities,
		accounts: [
			{
				name: 'alice',
				collections: [
					{
						name: 'work',
						resources: [{ name: 'one.ics', ics: EVENT }],
					},
				],
			},
		],
	});
}

function collectionProps(
	mock: MockCalDavServer,
	properties: readonly string[],
): Promise<{ status: number; text: string }> {
	return mock.request({
		url: mock.collectionUrl('alice', 'work'),
		method: 'PROPFIND',
		headers: { Depth: '0' },
		body: propfindBody(properties),
	});
}

function get(mock: MockCalDavServer) {
	return mock.request({
		url: mock.resourceUrl('alice', 'work', 'one.ics'),
		method: 'GET',
	});
}

function addAttachment(
	mock: MockCalDavServer,
	body: string,
): Promise<{
	status: number;
	headers: Readonly<Record<string, string>>;
	text: string;
}> {
	return mock.request({
		url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-add`,
		method: 'POST',
		headers: {
			'Content-Type': 'text/plain',
			'Content-Disposition': 'attachment; filename="agenda.txt"',
		},
		body,
	});
}

describe('capability: WebDAV-Sync support', () => {
	it('serves the report and the token when supported', async () => {
		const mock = server();
		const props = await collectionProps(mock, ['d:sync-token']);
		expect(readMultistatus(props.text)[0]?.found.get('d:sync-token')).toBe(
			mock.syncToken('alice', 'work'),
		);
		const report = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		expect(report.status).toBe(207);
	});

	it('omits the token and refuses the report when unsupported', async () => {
		const mock = server({ syncCollection: 'unsupported' });
		const props = await collectionProps(mock, ['d:sync-token']);
		expect(readMultistatus(props.text)[0]?.missing).toContain(
			'd:sync-token',
		);
		const report = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		expect(report.status).toBe(403);
		expect(errorConditionIn(report.text)).toBe('d:supported-report');
	});

	it('refuses a token that it issued after the test turns on rejectSyncToken', async () => {
		const mock = server();
		const initial = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		const token = syncTokenIn(initial.text) ?? '';

		mock.configure({ rejectSyncToken: true });
		const rejected = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(token),
		});
		expect(rejected.status).toBe(403);
		expect(errorConditionIn(rejected.text)).toBe('d:valid-sync-token');

		// The first sync carries no token, so the server can still answer
		// the request. A client falls back to a sync without a token.
		const restart = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: syncCollectionBody(''),
		});
		expect(restart.status).toBe(207);
	});
});

describe('capability: CTag behavior', () => {
	it('advertises a CTag that changes with every write', async () => {
		const mock = server();
		const before = mock.collectionCtag('alice', 'work');
		mock.seedResource('alice', 'work', 'two.ics', icsEvent({ uid: 'two' }));
		const props = await collectionProps(mock, ['cs:getctag']);
		const after = readMultistatus(props.text)[0]?.found.get('cs:getctag');
		expect(after).toBe(mock.collectionCtag('alice', 'work'));
		expect(after).not.toBe(before);
	});

	it('omits the CTag when the ctag capability is absent', async () => {
		const mock = server({ ctag: 'absent' });
		expect(mock.collectionCtag('alice', 'work')).toBeNull();
		const props = await collectionProps(mock, ['cs:getctag']);
		expect(readMultistatus(props.text)[0]?.missing).toContain('cs:getctag');
	});

	it('keeps the CTag the same across a write when the ctag capability is frozen', async () => {
		const mock = server({ ctag: 'frozen' });
		const before = readMultistatus(
			(await collectionProps(mock, ['cs:getctag'])).text,
		)[0]?.found.get('cs:getctag');
		mock.seedResource('alice', 'work', 'two.ics', icsEvent({ uid: 'two' }));
		const after = readMultistatus(
			(await collectionProps(mock, ['cs:getctag'])).text,
		)[0]?.found.get('cs:getctag');
		expect(before).toBeDefined();
		expect(after).toBe(before);
	});
});

describe('capability: precondition enforcement', () => {
	it('refuses an If-Match that names an old ETag when the server enforces it', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': '"etag-stale"' },
			body: EVENT,
		});
		expect(response.status).toBe(412);
	});

	it('accepts an If-Match that names an old ETag when the server does not enforce it', async () => {
		const mock = server({ enforceIfMatch: false });
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': '"etag-stale"' },
			body: icsEvent({ uid: 'one', summary: 'overwritten' }),
		});
		expect(response.status).toBe(204);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).toContain(
			'overwritten',
		);
	});

	it('refuses If-None-Match on a resource that exists when the server enforces it', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-None-Match': '*' },
			body: EVENT,
		});
		expect(response.status).toBe(412);
	});

	it('accepts If-None-Match on a resource that exists when the server does not enforce it', async () => {
		const mock = server({ enforceIfNoneMatch: false });
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-None-Match': '*' },
			body: EVENT,
		});
		expect(response.status).toBe(204);
	});

	it('never matches a weak ETag against If-Match', async () => {
		const mock = server();
		const current = mock.resourceEtag('alice', 'work', 'one.ics') ?? '';
		const weak = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': `W/${current}` },
			body: EVENT,
		});
		expect(weak.status).toBe(412);

		const strong = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-Match': `"etag-zzz", ${current}` },
			body: EVENT,
		});
		expect(strong.status).toBe(204);
	});

	it('applies an If-None-Match that names entity tags', async () => {
		const mock = server();
		const current = mock.resourceEtag('alice', 'work', 'one.ics') ?? '';
		const refused = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-None-Match': `W/${current}` },
			body: EVENT,
		});
		expect(refused.status).toBe(412);

		const allowed = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			headers: { 'If-None-Match': '"etag-zzz"' },
			body: EVENT,
		});
		expect(allowed.status).toBe(204);
	});

	it('refuses a DELETE whose If-Match names an old ETag', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'DELETE',
			headers: { 'If-Match': '"etag-stale"' },
		});
		expect(response.status).toBe(412);
		expect(mock.resourceNames('alice', 'work')).toStrictEqual(['one.ics']);
	});
});

describe('capability: ETag stability', () => {
	it('reports the same ETag for each read when the etags capability is stable', async () => {
		const mock = server();
		const first = await get(mock);
		const second = await get(mock);
		expect(first.headers.ETag).toBe(second.headers.ETag);
	});

	it('makes a new ETag for each read when the etags capability is per-fetch', async () => {
		const mock = server({ etags: 'per-fetch' });
		const first = await get(mock);
		const second = await get(mock);
		expect(first.headers.ETag).not.toBe(second.headers.ETag);
	});
});

describe('capability: response body stability', () => {
	it('returns the stored octets when the getBodies capability is byte-stable', async () => {
		const mock = server();
		expect((await get(mock)).text).toBe(EVENT);
	});

	it('formats the body again when the getBodies capability is re-serialized', async () => {
		const mock = server({ getBodies: 're-serialized' });
		const lowercased = EVENT.replace('SUMMARY:', 'summary:');
		mock.seedResource('alice', 'work', 'one.ics', lowercased);
		const fetched = await get(mock);
		expect(fetched.text).not.toBe(lowercased);
		expect(fetched.text).toBe(EVENT);
	});

	it('folds a long line again and keeps the content of the line', async () => {
		const mock = server({ getBodies: 're-serialized' });
		const summary = 'é'.repeat(60);
		mock.seedResource(
			'alice',
			'work',
			'one.ics',
			icsEvent({ uid: 'one', summary }),
		);
		const fetched = await get(mock);
		const physical = icsPhysicalLines(fetched.text);
		expect(Math.max(...physical.map(octetLength))).toBeLessThanOrEqual(
			ICS_LINE_OCTET_LIMIT,
		);
		expect(icsLogicalLines(physical)).toContain(`SUMMARY:${summary}`);
	});
});

describe('determinism', () => {
	it('answers one request sequence with the same bytes on each new server', async () => {
		const play = async (mock: MockCalDavServer): Promise<string[]> => {
			const out: string[] = [];
			out.push(
				(
					await mock.request({
						url: mock.resourceUrl('alice', 'work', 'new.ics'),
						method: 'PUT',
						headers: { 'If-None-Match': '*' },
						body: icsEvent({ uid: 'new' }),
					})
				).headers.ETag ?? '',
			);
			out.push((await collectionProps(mock, ['cs:getctag'])).text);
			out.push(
				(
					await mock.request({
						url: mock.collectionUrl('alice', 'work'),
						method: 'REPORT',
						body: syncCollectionBody(''),
					})
				).text,
			);
			return out;
		};
		expect(await play(server())).toStrictEqual(await play(server()));
	});
});

describe('capability: calendar-query UID filter', () => {
	it('filters by UID when supported', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({ uid: 'one' }),
		});
		expect(hrefsIn(response.text)).toStrictEqual([
			'/calendars/alice/work/one.ics',
		]);
	});

	it('says that it does not support the filter, and does not return an empty answer', async () => {
		const mock = server({ calendarQueryUidFilter: false });
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({ uid: 'one' }),
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe('c:supported-filter');
	});

	it('still answers a query that names no UID', async () => {
		const mock = server({ calendarQueryUidFilter: false });
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({}),
		});
		expect(response.status).toBe(207);
	});
});

describe('calendar-query: the filters that the mock does not implement', () => {
	const query = async (
		filters: readonly string[],
	): Promise<{ status: number; condition: string | null }> => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({ filters }),
		});
		return {
			status: response.status,
			condition: errorConditionIn(response.text),
		};
	};

	it('refuses each filter by name instead of ignoring it and matching every resource', async () => {
		expect(
			await query([
				'<C:prop-filter name="SUMMARY"><C:text-match>nope</C:text-match></C:prop-filter>',
			]),
		).toStrictEqual({ status: 403, condition: 'c:supported-filter' });
		expect(await query(['<C:is-not-defined/>'])).toStrictEqual({
			status: 403,
			condition: 'c:supported-filter',
		});
		expect(
			await query(['<C:param-filter name="PARTSTAT"/>']),
		).toStrictEqual({
			status: 403,
			condition: 'c:supported-filter',
		});
		expect(await query(['<C:comp-filter name="VALARM"/>'])).toStrictEqual({
			status: 403,
			condition: 'c:supported-filter',
		});
	});

	it('names the element that it could not apply', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				filters: ['<C:prop-filter name="SUMMARY"/>'],
			}),
		});
		const refused = parseXml(response.text)?.documentElement;
		const named = refused
			? descendantsNamed(refused, CALDAV_NS, 'prop-filter')[0]
			: undefined;
		expect(named?.getAttribute('name')).toBe('SUMMARY');
	});

	it('refuses a UID filter when it cannot use the collation that the request names', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				uid: 'one',
				collation: 'i;unicode-casemap',
			}),
		});
		expect(response.status).toBe(403);
		expect(errorConditionIn(response.text)).toBe('c:supported-collation');
	});

	it('ignores the case of a UID when the request asks for the ascii-casemap collation', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.collectionUrl('alice', 'work'),
			method: 'REPORT',
			body: calendarQueryBody({
				uid: 'ONE',
				collation: 'i;ascii-casemap',
			}),
		});
		expect(hrefsIn(response.text)).toStrictEqual([
			'/calendars/alice/work/one.ics',
		]);
	});
});

describe('capability: managed attachments', () => {
	it('does not advertise the property or the compliance class when the capability is off', async () => {
		const mock = server();
		const props = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['c:managed-attachments-server-URL']),
		});
		expect(readMultistatus(props.text)[0]?.missing).toContain(
			'c:managed-attachments-server-URL',
		);
		const options = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'OPTIONS',
		});
		expect(options.headers.DAV).not.toContain(
			'calendar-managed-attachments',
		);
	});

	it('advertises the property and the compliance class when the capability is on', async () => {
		const mock = server({ managedAttachments: true });
		const props = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'PROPFIND',
			headers: { Depth: '0' },
			body: propfindBody(['c:managed-attachments-server-URL']),
		});
		expect(
			readMultistatus(props.text)[0]?.found.get(
				'c:managed-attachments-server-URL',
			),
		).toBe('/attachments/');
		const options = await mock.request({
			url: mock.homeUrl('alice'),
			method: 'OPTIONS',
		});
		expect(options.headers.DAV).toContain('calendar-managed-attachments');
	});

	it('adds an attachment, rewrites the event, and serves the bytes', async () => {
		const mock = server({ managedAttachments: true });
		const added = await addAttachment(mock, 'agenda text');
		expect(added.status).toBe(201);
		const managedId = added.headers['Cal-Managed-ID'];
		expect(managedId).toBe('attachment-1');

		const stored = mock.resourceIcs('alice', 'work', 'one.ics') ?? '';
		expect(stored).toContain(`ATTACH;MANAGED-ID=${managedId ?? ''};`);
		expect(stored).toContain('FILENAME="agenda.txt"');
		expect(stored).toContain(mock.url('/attachments/attachment-1'));
		expect(added.headers.ETag).toBe(
			mock.resourceEtag('alice', 'work', 'one.ics'),
		);

		const fetched = await mock.request({
			url: mock.url('/attachments/attachment-1'),
			method: 'GET',
		});
		expect(fetched.status).toBe(200);
		expect(fetched.text).toBe('agenda text');
		expect(fetched.headers['Content-Type']).toBe('text/plain');
	});

	it('removes an attachment that it made and refuses an attachment that it did not make', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');

		const forged = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-remove&managed-id=attachment-99`,
			method: 'POST',
		});
		expect(forged.status).toBe(409);
		expect(errorConditionIn(forged.text)).toBe('c:valid-managed-id');

		const removed = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-remove&managed-id=attachment-1`,
			method: 'POST',
		});
		expect(removed.status).toBe(204);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).not.toContain(
			'ATTACH',
		);
		expect(
			(await mock.request({ url: mock.url('/attachments/attachment-1') }))
				.status,
		).toBe(404);
	});

	it('serves no attachment operation at all when the capability is off', async () => {
		const mock = server();
		const response = await addAttachment(mock, 'agenda text');
		expect(response.status).toBe(405);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).toBe(EVENT);
	});

	it('refuses a POST whose If-Match names an old ETag', async () => {
		const mock = server({ managedAttachments: true });
		const stored = mock.resourceIcs('alice', 'work', 'one.ics');
		const refused = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-add`,
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				'If-Match': '"etag-stale"',
			},
			body: 'agenda text',
		});
		expect(refused.status).toBe(412);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).toBe(stored);
		expect(mock.scheduling.entries).toStrictEqual([]);
		expect(
			(await mock.request({ url: mock.url('/attachments/attachment-1') }))
				.status,
		).toBe(404);
	});

	it('accepts a POST whose If-Match names the current ETag', async () => {
		const mock = server({ managedAttachments: true });
		const accepted = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-add`,
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				'If-Match': mock.resourceEtag('alice', 'work', 'one.ics') ?? '',
			},
			body: 'agenda text',
		});
		expect(accepted.status).toBe(201);
	});

	it('ignores an old ETag in If-Match on a server that enforces no precondition', async () => {
		const mock = server({
			managedAttachments: true,
			enforceIfMatch: false,
		});
		const accepted = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-add`,
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain',
				'If-Match': '"etag-stale"',
			},
			body: 'agenda text',
		});
		expect(accepted.status).toBe(201);
	});

	it('removes the attachments of a resource together with the resource', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');
		const deleted = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'DELETE',
		});
		expect(deleted.status).toBe(204);
		expect(
			(await mock.request({ url: mock.url('/attachments/attachment-1') }))
				.status,
		).toBe(404);
	});

	it('removes the attachments when a test removes the resource without a request', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');
		expect(mock.removeResource('alice', 'work', 'one.ics')).toBe(true);
		expect(
			(await mock.request({ url: mock.url('/attachments/attachment-1') }))
				.status,
		).toBe(404);
	});

	it('drops the continuation lines of a folded ATTACH property', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');
		mock.seedResource(
			'alice',
			'work',
			'one.ics',
			EVENT.replace(
				'END:VEVENT',
				'ATTACH;MANAGED-ID=attachment-1;FMTTYPE=text/plain\r\n ;FILENAME="agenda.txt":https://caldav.davenport.test/attachments/attachment-1\r\nEND:VEVENT',
			),
		);
		const removed = await mock.request({
			url: `${mock.resourceUrl('alice', 'work', 'one.ics')}?action=attachment-remove&managed-id=attachment-1`,
			method: 'POST',
		});
		expect(removed.status).toBe(204);
		const stored = mock.resourceIcs('alice', 'work', 'one.ics') ?? '';
		expect(stored).not.toContain('ATTACH');
		expect(stored).not.toContain('FILENAME');
	});

	it('keeps the attachment bytes when a write only drops the ATTACH property', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');
		const rewritten = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'PUT',
			body: EVENT,
		});
		expect(rewritten.status).toBe(204);
		expect(mock.resourceIcs('alice', 'work', 'one.ics')).not.toContain(
			'ATTACH',
		);
		expect(
			(await mock.request({ url: mock.url('/attachments/attachment-1') }))
				.status,
		).toBe(200);
	});

	it('serves no stored attachment while the capability is off', async () => {
		const mock = server({ managedAttachments: true });
		await addAttachment(mock, 'agenda text');
		mock.configure({ managedAttachments: false });
		const gone = await mock.request({
			url: mock.url('/attachments/attachment-1'),
		});
		expect(gone.status).toBe(404);

		mock.configure({ managedAttachments: true });
		const back = await mock.request({
			url: mock.url('/attachments/attachment-1'),
		});
		expect(back.status).toBe(200);
		expect(back.text).toBe('agenda text');
	});
});

describe('capability: fault injection', () => {
	it('answers a matching request with the given status for the given number of times', async () => {
		const mock = server({
			faults: [{ kind: 'status', method: 'PUT', status: 503, times: 2 }],
		});
		const attempts = [];
		for (let attempt = 0; attempt < 3; attempt += 1) {
			attempts.push(
				(
					await mock.request({
						url: mock.resourceUrl('alice', 'work', 'one.ics'),
						method: 'PUT',
						body: EVENT,
					})
				).status,
			);
		}
		expect(attempts).toStrictEqual([503, 503, 204]);
	});

	it('answers a request that matches no fault in the usual way', async () => {
		const mock = server({
			faults: [{ kind: 'status', pathContains: '/chores/', status: 500 }],
		});
		expect((await get(mock)).text).toBe(EVENT);
	});

	it('counts a request against the fault only when the server would have answered it', async () => {
		const mock = server({
			redirects: { '/.well-known/caldav': { location: '/principals/' } },
			faults: [{ kind: 'status', status: 503, times: 1 }],
		});
		const redirected = await mock.request({
			url: mock.wellKnownUrl,
			method: 'PROPFIND',
		});
		expect(redirected.status).toBe(301);
		const elsewhere = await mock.request({
			url: 'https://elsewhere.example/calendars/alice/work/one.ics',
			method: 'GET',
		});
		expect(elsewhere.status).toBe(404);
		expect((await get(mock)).status).toBe(503);
		expect((await get(mock)).status).toBe(200);
	});

	it('cuts a response short without changing its status', async () => {
		const mock = server({
			faults: [{ kind: 'truncate', method: 'GET', truncateAfter: 20 }],
		});
		const response = await mock.request({
			url: mock.resourceUrl('alice', 'work', 'one.ics'),
			method: 'GET',
		});
		expect(response.status).toBe(200);
		expect(response.text).toBe(EVENT.slice(0, 20));
		expect(response.arrayBuffer.byteLength).toBe(20);
	});
});

describe('capability: discovery redirects', () => {
	it('answers a configured path with a redirect that the client must follow', async () => {
		const mock = server({
			redirects: {
				'/.well-known/caldav': {
					location: '/principals/alice/',
					status: 302,
				},
			},
		});
		const response = await mock.request({
			url: mock.wellKnownUrl,
			method: 'PROPFIND',
			body: propfindBody(['d:current-user-principal']),
		});
		expect(response.status).toBe(302);
		expect(response.headers.Location).toBe(mock.principalUrl('alice'));
	});

	it('serves nothing at the well-known path when no redirect is configured', async () => {
		const mock = server();
		const response = await mock.request({
			url: mock.wellKnownUrl,
			method: 'PROPFIND',
			body: propfindBody(['d:current-user-principal']),
		});
		expect(response.status).toBe(404);
	});
});
