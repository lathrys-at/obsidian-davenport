/**
 * PROPFIND: the discovery walk and collection listing. Depth 0 answers for
 * the target alone, Depth 1 adds its children, and infinite depth is
 * refused as most servers refuse it.
 */

import { appendResponse, type PropContext, type PropTarget } from './props';
import { multistatus, plain, preconditionError } from './response';
import type { MockResponse } from './response';
import { PRINCIPAL_ROOT_PATH } from './state';
import type { AccountState, Route } from './state';
import {
	childElements,
	childNamed,
	DAV_NS,
	nameOf,
	type PropName,
	type XmlDocument,
} from './xml';

export function handlePropfind(
	route: Route,
	depth: string | null,
	document: XmlDocument | null,
	context: PropContext,
	currentAccount: AccountState | null,
): MockResponse {
	if (depth === 'infinity') {
		return preconditionError(403, DAV_NS, 'propfind-finite-depth');
	}
	const target = targetOf(route, currentAccount);
	if (!target) {
		return plain(404);
	}
	const requested = requestedProps(document);
	const children = depth === '1' ? childTargets(target) : [];

	return multistatus((out, root) => {
		for (const each of [target, ...children]) {
			appendResponse(out, root, hrefOf(each), each, requested, context);
		}
	});
}

/** Null for allprop, which asks for everything the target carries. */
export function requestedProps(
	document: XmlDocument | null,
): readonly PropName[] | null {
	const root = document?.documentElement;
	if (!root) {
		return null;
	}
	const prop = childNamed(root, DAV_NS, 'prop');
	return prop ? childElements(prop).map(nameOf) : null;
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
		return Array.from(target.collection.resources.values()).map(
			(resource) => ({
				kind: 'resource' as const,
				account: target.account,
				collection: target.collection,
				resource,
			}),
		);
	}
	return [];
}
