/**
 * This module writes WebDAV properties into a response. The PROPFIND
 * handler and the REPORT handlers both use this module. A request names
 * the properties that the client wants. For each target, the mock puts
 * the properties that the target has into a `propstat` block with status
 * 200. The mock puts the names of the other properties into a second
 * `propstat` block with status 404. The two blocks let a client see the
 * difference between a property that the server does not support and a
 * property that is empty.
 */

import type { MockServerCapabilities } from './capabilities';
import { resolveProp } from './prop-values';
import type {
	AccountState,
	CollectionState,
	ResourceState,
	ServerState,
} from './state';
import {
	CALDAV_NS,
	CALENDARSERVER_NS,
	DAV_NS,
	type PropName,
	type XmlElement,
	type XmlOutput,
} from './xml';

export type PropTarget =
	| { readonly kind: 'principal-root'; readonly account: AccountState }
	| { readonly kind: 'principal'; readonly account: AccountState }
	| { readonly kind: 'home'; readonly account: AccountState }
	| {
			readonly kind: 'collection';
			readonly account: AccountState;
			readonly collection: CollectionState;
	  }
	| {
			readonly kind: 'resource';
			readonly account: AccountState;
			readonly collection: CollectionState;
			readonly resource: ResourceState;
	  };

export interface PropContext {
	readonly state: ServerState;
	readonly caps: MockServerCapabilities;
}

/**
 * A request for properties has three possible shapes. First, the request
 * names the properties that the client wants. Second, the request asks
 * for the names of all the properties that the target carries, and not
 * for the values. Third, the request asks for all the properties with
 * their values.
 */
export type PropRequest =
	| { readonly kind: 'allprop' }
	| { readonly kind: 'propname' }
	| { readonly kind: 'named'; readonly names: readonly PropName[] };

const dav = (local: string): PropName => ({ ns: DAV_NS, local });
const caldav = (local: string): PropName => ({ ns: CALDAV_NS, local });

const COMMON_PROPS: readonly PropName[] = [
	dav('resourcetype'),
	dav('displayname'),
	dav('current-user-principal'),
];

const SUPPORTED_PROPS: Readonly<
	Record<PropTarget['kind'], readonly PropName[]>
> = {
	'principal-root': [dav('resourcetype'), dav('current-user-principal')],
	principal: [
		...COMMON_PROPS,
		dav('principal-URL'),
		caldav('calendar-home-set'),
		caldav('calendar-user-address-set'),
		dav('supported-report-set'),
	],
	home: [
		...COMMON_PROPS,
		dav('owner'),
		caldav('managed-attachments-server-URL'),
	],
	collection: [
		...COMMON_PROPS,
		dav('owner'),
		dav('sync-token'),
		dav('supported-report-set'),
		caldav('supported-calendar-component-set'),
		{ ns: CALENDARSERVER_NS, local: 'getctag' },
	],
	resource: [
		dav('resourcetype'),
		dav('getetag'),
		dav('getcontenttype'),
		dav('getcontentlength'),
		caldav('calendar-data'),
	],
};

export function supportedProps(target: PropTarget): readonly PropName[] {
	return SUPPORTED_PROPS[target.kind];
}

/**
 * Appends one `<response>` element for one target. The contents of the
 * element follow what the request asks for.
 */
export function appendResponse(
	out: XmlOutput,
	parent: XmlElement,
	href: string,
	target: PropTarget,
	requested: PropRequest,
	context: PropContext,
): void {
	const response = out.child(parent, DAV_NS, 'response');
	out.child(response, DAV_NS, 'href', href);
	const wanted =
		requested.kind === 'named' ? requested.names : supportedProps(target);

	const found: ((prop: XmlElement) => void)[] = [];
	const missing: PropName[] = [];
	for (const name of wanted) {
		const emit = resolveProp(out, target, name, context);
		if (!emit) {
			missing.push(name);
		} else if (requested.kind === 'propname') {
			found.push((prop) => {
				out.child(prop, name.ns, name.local);
			});
		} else {
			found.push(emit);
		}
	}

	if (found.length > 0 || missing.length === 0) {
		const propstat = out.child(response, DAV_NS, 'propstat');
		const prop = out.child(propstat, DAV_NS, 'prop');
		for (const emit of found) {
			emit(prop);
		}
		out.child(propstat, DAV_NS, 'status', 'HTTP/1.1 200 OK');
	}
	// A request for all the properties gets only the properties that
	// exist. The mock reports a missing property only when the request
	// names that property.
	if (requested.kind === 'named' && missing.length > 0) {
		const propstat = out.child(response, DAV_NS, 'propstat');
		const prop = out.child(propstat, DAV_NS, 'prop');
		for (const name of missing) {
			out.child(prop, name.ns, name.local);
		}
		out.child(propstat, DAV_NS, 'status', 'HTTP/1.1 404 Not Found');
	}
}
