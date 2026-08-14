/**
 * The value that each WebDAV property takes for one target. A different
 * module decides which properties a target carries. This module knows
 * only what each property says when a request asks for that property.
 * This includes the properties whose presence and value the capability
 * settings decide.
 */

import type { MockServerCapabilities } from './capabilities';
import { octetLength } from '../ics-octets';
import { reserialize } from './ics';
import type { PropContext, PropTarget } from './props';
import type { ServerState } from './state';
import {
	CALDAV_NS,
	CALENDARSERVER_NS,
	DAV_NS,
	type PropName,
	type XmlElement,
	type XmlOutput,
} from './xml';

/** Returns null when this target does not carry the property. */
export function resolveProp(
	out: XmlOutput,
	target: PropTarget,
	name: PropName,
	context: PropContext,
): ((prop: XmlElement) => void) | null {
	const { state, caps } = context;
	const is = (ns: string, local: string): boolean =>
		name.ns === ns && name.local === local;

	if (is(DAV_NS, 'resourcetype')) {
		return (prop) => {
			const el = out.child(prop, DAV_NS, 'resourcetype');
			if (target.kind === 'resource') {
				return;
			}
			out.child(el, DAV_NS, 'collection');
			if (target.kind === 'principal') {
				out.child(el, DAV_NS, 'principal');
			}
			if (target.kind === 'collection') {
				out.child(el, CALDAV_NS, 'calendar');
			}
		};
	}
	if (is(DAV_NS, 'displayname') && target.kind !== 'resource') {
		const text =
			target.kind === 'collection'
				? target.collection.displayName
				: target.account.displayName;
		return (prop) => {
			out.child(prop, DAV_NS, 'displayname', text);
		};
	}
	if (is(DAV_NS, 'current-user-principal') || is(DAV_NS, 'principal-URL')) {
		return (prop) => {
			const el = out.child(prop, DAV_NS, name.local);
			out.child(el, DAV_NS, 'href', target.account.principalHref);
		};
	}
	if (is(DAV_NS, 'owner')) {
		return (prop) => {
			const el = out.child(prop, DAV_NS, 'owner');
			out.child(el, DAV_NS, 'href', target.account.principalHref);
		};
	}
	if (is(CALDAV_NS, 'calendar-home-set') && target.kind === 'principal') {
		return (prop) => {
			const el = out.child(prop, CALDAV_NS, 'calendar-home-set');
			out.child(el, DAV_NS, 'href', target.account.homeHref);
		};
	}
	if (
		is(CALDAV_NS, 'calendar-user-address-set') &&
		target.kind === 'principal'
	) {
		return (prop) => {
			const el = out.child(prop, CALDAV_NS, 'calendar-user-address-set');
			for (const address of target.account.userAddresses) {
				out.child(el, DAV_NS, 'href', address);
			}
		};
	}
	if (
		is(CALDAV_NS, 'managed-attachments-server-URL') &&
		target.kind === 'home' &&
		caps.managedAttachments
	) {
		return (prop) => {
			const el = out.child(
				prop,
				CALDAV_NS,
				'managed-attachments-server-URL',
			);
			out.child(el, DAV_NS, 'href', '/attachments/');
		};
	}
	if (target.kind === 'collection') {
		const collectionProp = resolveCollectionProp(
			out,
			target,
			name,
			context,
		);
		if (collectionProp) {
			return collectionProp;
		}
	}
	if (target.kind === 'resource') {
		return resolveResourceProp(out, target, name, state, caps);
	}
	if (is(DAV_NS, 'supported-report-set') && target.kind === 'principal') {
		return (prop) => {
			out.child(prop, DAV_NS, 'supported-report-set');
		};
	}
	return null;
}

function resolveCollectionProp(
	out: XmlOutput,
	target: Extract<PropTarget, { kind: 'collection' }>,
	name: PropName,
	context: PropContext,
): ((prop: XmlElement) => void) | null {
	const { state, caps } = context;
	if (name.ns === CALENDARSERVER_NS && name.local === 'getctag') {
		const ctag = state.ctagOf(target.collection, caps);
		return ctag === null
			? null
			: (prop) => {
					out.child(prop, CALENDARSERVER_NS, 'getctag', ctag);
				};
	}
	if (name.ns === DAV_NS && name.local === 'sync-token') {
		if (caps.syncCollection === 'unsupported') {
			return null;
		}
		const token = state.syncTokenOf(target.collection);
		return (prop) => {
			out.child(prop, DAV_NS, 'sync-token', token);
		};
	}
	if (
		name.ns === CALDAV_NS &&
		name.local === 'supported-calendar-component-set'
	) {
		return (prop) => {
			const el = out.child(
				prop,
				CALDAV_NS,
				'supported-calendar-component-set',
			);
			for (const component of target.collection.components) {
				out.child(el, CALDAV_NS, 'comp').setAttribute(
					'name',
					component,
				);
			}
		};
	}
	if (name.ns === DAV_NS && name.local === 'supported-report-set') {
		const reports = ['calendar-query', 'calendar-multiget'];
		if (caps.syncCollection === 'supported') {
			reports.unshift('sync-collection');
		}
		return (prop) => {
			const el = out.child(prop, DAV_NS, 'supported-report-set');
			for (const report of reports) {
				const wrapper = out.child(el, DAV_NS, 'supported-report');
				const holder = out.child(wrapper, DAV_NS, 'report');
				const ns = report === 'sync-collection' ? DAV_NS : CALDAV_NS;
				out.child(holder, ns, report);
			}
		};
	}
	return null;
}

function resolveResourceProp(
	out: XmlOutput,
	target: Extract<PropTarget, { kind: 'resource' }>,
	name: PropName,
	state: ServerState,
	caps: MockServerCapabilities,
): ((prop: XmlElement) => void) | null {
	if (name.ns === DAV_NS && name.local === 'getetag') {
		const etag = state.reportedEtag(target.resource, caps.etags);
		return (prop) => {
			out.child(prop, DAV_NS, 'getetag', etag);
		};
	}
	if (name.ns === DAV_NS && name.local === 'getcontenttype') {
		return (prop) => {
			out.child(
				prop,
				DAV_NS,
				'getcontenttype',
				'text/calendar; charset=utf-8',
			);
		};
	}
	if (name.ns === DAV_NS && name.local === 'getcontentlength') {
		const length = octetLength(target.resource.ics);
		return (prop) => {
			out.child(prop, DAV_NS, 'getcontentlength', String(length));
		};
	}
	if (name.ns === CALDAV_NS && name.local === 'calendar-data') {
		const body = servedBody(target.resource.ics, caps);
		return (prop) => {
			out.child(prop, CALDAV_NS, 'calendar-data', body);
		};
	}
	return null;
}

/**
 * Returns the bytes that a GET request or a calendar-data property returns
 * with this configuration.
 */
export function servedBody(ics: string, caps: MockServerCapabilities): string {
	return caps.getBodies === 're-serialized' ? reserialize(ics) : ics;
}
