/**
 * WebDAV property emission, shared by PROPFIND and the REPORTs. A request
 * names properties; each target answers the ones it has in a 200 propstat
 * and lists the rest as 404, which is how a client tells an unsupported
 * property from an empty one.
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
 * The three shapes a request for properties takes: the ones it names, the
 * names of everything the target carries, or everything with its value.
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

/** Appends one `<response>` for a target, in the shape the request asked for. */
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
	// A request for everything returns what exists; only a request that
	// named a property gets told the property is not there.
	if (requested.kind === 'named' && missing.length > 0) {
		const propstat = out.child(response, DAV_NS, 'propstat');
		const prop = out.child(propstat, DAV_NS, 'prop');
		for (const name of missing) {
			out.child(prop, name.ns, name.local);
		}
		out.child(propstat, DAV_NS, 'status', 'HTTP/1.1 404 Not Found');
	}
}
