/**
 * PROPFIND: the discovery walk and collection listing. Depth 0 answers for
 * the target alone, Depth 1 adds its children, and infinite depth is
 * refused as most servers refuse it.
 */

import {
	appendResponse,
	type PropContext,
	type PropRequest,
	type PropTarget,
} from './props';
import { multistatus, plain, preconditionError } from './response';
import type { MockResponse } from './response';
import { membersOf, PRINCIPAL_ROOT_PATH } from './state';
import type { AccountState, Route } from './state';
import {
	childElements,
	childNamed,
	DAV_NS,
	documentOf,
	nameOf,
	type XmlBody,
	type XmlDocument,
} from './xml';

export function handlePropfind(
	route: Route,
	depth: string | null,
	body: XmlBody,
	context: PropContext,
	currentAccount: AccountState | null,
): MockResponse {
	// A request with no body asks for everything a target carries; one
	// whose bytes will not parse asked for something else, and answering
	// it as an allprop is how a corrupt request passes for a working one.
	if (body.kind === 'malformed') {
		return plain(400);
	}
	if (depth === 'infinity') {
		return preconditionError(403, DAV_NS, 'propfind-finite-depth');
	}
	const target = targetOf(route, currentAccount);
	if (!target) {
		return plain(404);
	}
	const requested = requestedProps(documentOf(body));
	const children = depth === '1' ? childTargets(target) : [];

	return multistatus((out, root) => {
		for (const each of [target, ...children]) {
			appendResponse(out, root, hrefOf(each), each, requested, context);
		}
	});
}

/**
 * What the body asked for: named properties, the names alone, or — with
 * no body and for a body naming neither — everything the target carries.
 */
export function requestedProps(document: XmlDocument | null): PropRequest {
	const root = document?.documentElement;
	if (!root) {
		return { kind: 'allprop' };
	}
	if (childNamed(root, DAV_NS, 'propname')) {
		return { kind: 'propname' };
	}
	const prop = childNamed(root, DAV_NS, 'prop');
	return prop
		? { kind: 'named', names: childElements(prop).map(nameOf) }
		: { kind: 'allprop' };
}

export function targetOf(
	route: Route,
	currentAccount: AccountState | null,
): PropTarget | null {
	switch (route.kind) {
		case 'principal-root':
			return currentAccount
				? { kind: 'principal-root', account: currentAccount }
				: null;
		case 'principal':
		case 'home':
			return { kind: route.kind, account: route.account };
		case 'collection':
			return {
				kind: 'collection',
				account: route.account,
				collection: route.collection,
			};
		case 'resource':
			return {
				kind: 'resource',
				account: route.account,
				collection: route.collection,
				resource: route.resource,
			};
		default:
			return null;
	}
}

export function hrefOf(target: PropTarget): string {
	switch (target.kind) {
		case 'principal-root':
			return PRINCIPAL_ROOT_PATH;
		case 'principal':
			return target.account.principalHref;
		case 'home':
			return target.account.homeHref;
		case 'collection':
			return target.collection.href;
		case 'resource':
			return target.resource.href;
	}
}

function childTargets(target: PropTarget): PropTarget[] {
	if (target.kind === 'home') {
		return Array.from(target.account.collections.values()).map(
			(collection) => ({
				kind: 'collection' as const,
				account: target.account,
				collection,
			}),
		);
	}
	if (target.kind === 'collection') {
		return membersOf(target.collection).map((resource) => ({
			kind: 'resource' as const,
			account: target.account,
			collection: target.collection,
			resource,
		}));
	}
	return [];
}
