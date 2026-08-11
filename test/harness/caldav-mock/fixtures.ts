/**
 * Request bodies and event text for driving the mock. Requests are written
 * as the XML a client sends, deliberately with prefixes that vary between
 * fixtures, since prefix choice is the client's and the server may not
 * depend on it.
 */

import {
	CALDAV_NS,
	CALENDARSERVER_NS,
	childElements,
	childNamed,
	DAV_NS,
	descendantsNamed,
	parseXml,
	textOf,
	type XmlElement,
} from './xml';

const PREFIX_BY_NAMESPACE: ReadonlyMap<string, string> = new Map([
	[DAV_NS, 'd'],
	[CALDAV_NS, 'c'],
	[CALENDARSERVER_NS, 'cs'],
]);

export interface EventOptions {
	readonly uid: string;
	readonly start?: string;
	readonly end?: string;
	readonly summary?: string;
	readonly attendees?: readonly string[];
	readonly component?: string;
	readonly extra?: readonly string[];
}

export function icsEvent(options: EventOptions): string {
	const component = options.component ?? 'VEVENT';
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Davenport//mock//EN',
		`BEGIN:${component}`,
		`UID:${options.uid}`,
		`DTSTAMP:20260101T000000Z`,
	];
	if (options.start !== undefined) {
		lines.push(`DTSTART:${options.start}`);
	}
	if (options.end !== undefined) {
		lines.push(
			component === 'VTODO'
				? `DUE:${options.end}`
				: `DTEND:${options.end}`,
		);
	}
	lines.push(`SUMMARY:${options.summary ?? options.uid}`);
	for (const attendee of options.attendees ?? []) {
		lines.push(`ATTENDEE;PARTSTAT=NEEDS-ACTION:${attendee}`);
	}
	lines.push(...(options.extra ?? []), `END:${component}`, 'END:VCALENDAR');
	return `${lines.join('\r\n')}\r\n`;
}

export function propfindBody(properties: readonly string[]): string {
	const children = properties
		.map((qualified) => `<${qualified}/>`)
		.join('\n\t\t');
	return `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">
	<d:prop>
		${children}
	</d:prop>
</d:propfind>`;
}

export function syncCollectionBody(token: string): string {
	return `<?xml version="1.0" encoding="utf-8" ?>
<sync-collection xmlns="DAV:">
	<sync-token>${token}</sync-token>
	<sync-level>1</sync-level>
	<prop><getetag/></prop>
</sync-collection>`;
}

export interface QueryOptions {
	readonly component?: string;
	readonly start?: string;
	readonly end?: string;
	readonly uid?: string;
	readonly withData?: boolean;
}

export function calendarQueryBody(options: QueryOptions = {}): string {
	const inner: string[] = [];
	if (options.start !== undefined || options.end !== undefined) {
		const start =
			options.start === undefined ? '' : ` start="${options.start}"`;
		const end = options.end === undefined ? '' : ` end="${options.end}"`;
		inner.push(`<C:time-range${start}${end}/>`);
	}
	if (options.uid !== undefined) {
		inner.push(
			`<C:prop-filter name="UID"><C:text-match collation="i;octet">${options.uid}</C:text-match></C:prop-filter>`,
		);
	}
	const data = options.withData === true ? '<C:calendar-data/>' : '';
	return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
	<D:prop><D:getetag/>${data}</D:prop>
	<C:filter>
		<C:comp-filter name="VCALENDAR">
			<C:comp-filter name="${options.component ?? 'VEVENT'}">
				${inner.join('\n\t\t\t\t')}
			</C:comp-filter>
		</C:comp-filter>
	</C:filter>
</C:calendar-query>`;
}

export function multigetBody(hrefs: readonly string[]): string {
	const items = hrefs.map((href) => `<D:href>${href}</D:href>`).join('\n\t');
	return `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
	<D:prop><D:getetag/><C:calendar-data/></D:prop>
	${items}
</C:calendar-multiget>`;
}

// Reading responses. Everything below looks up by namespace and local
// name, so a change of prefix in the response cannot make an assertion
// pass or fail.

export interface MultistatusResponse {
	readonly href: string;
	readonly status: string | null;
	readonly found: ReadonlyMap<string, string>;
	readonly missing: readonly string[];
}

export function readMultistatus(body: string): readonly MultistatusResponse[] {
	const document = parseXml(body);
	const root = document?.documentElement;
	if (!root) {
		return [];
	}
	return descendantsNamed(root, DAV_NS, 'response').map((response) => {
		const found = new Map<string, string>();
		const missing: string[] = [];
		for (const propstat of descendantsNamed(response, DAV_NS, 'propstat')) {
			const status = childNamed(propstat, DAV_NS, 'status');
			const failed = status !== null && textOf(status).includes('404');
			const prop = childNamed(propstat, DAV_NS, 'prop');
			for (const property of prop ? childElements(prop) : []) {
				const key = keyOf(property);
				if (failed) {
					missing.push(key);
				} else {
					found.set(key, textOf(property).trim());
				}
			}
		}
		const href = childNamed(response, DAV_NS, 'href');
		const own = childNamed(response, DAV_NS, 'status');
		return {
			href: href ? textOf(href) : '',
			status: own ? textOf(own) : null,
			found,
			missing,
		};
	});
}

export function syncTokenIn(body: string): string | null {
	const document = parseXml(body);
	const root = document?.documentElement;
	if (!root) {
		return null;
	}
	const token = childNamed(root, DAV_NS, 'sync-token');
	return token ? textOf(token) : null;
}

/** The local name of the precondition element in an error body. */
export function errorConditionIn(body: string): string | null {
	const document = parseXml(body);
	const root = document?.documentElement;
	if (!root) {
		return null;
	}
	const first = childElements(root)[0];
	return first ? keyOf(first) : null;
}

/** The component names a supported-calendar-component-set advertises. */
export function componentSetIn(body: string): readonly string[] {
	const document = parseXml(body);
	const root = document?.documentElement;
	if (!root) {
		return [];
	}
	return descendantsNamed(root, CALDAV_NS, 'comp').map(
		(element) => element.getAttribute('name') ?? '',
	);
}

export function hrefsIn(body: string): readonly string[] {
	return readMultistatus(body).map((response) => response.href);
}

/** Namespace-qualified key, so `getetag` and a caldav prop never collide. */
export function keyOf(element: XmlElement): string {
	const namespace = element.namespaceURI ?? '';
	const prefix = PREFIX_BY_NAMESPACE.get(namespace) ?? namespace;
	return `${prefix}:${element.localName ?? ''}`;
}
