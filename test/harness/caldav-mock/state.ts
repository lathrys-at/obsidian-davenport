/**
 * The model of the server. The model holds accounts. Each account has a
 * principal, a calendar home, and collections. Each collection holds
 * resources. A resource is a set of ICS bytes with an ETag. A collection
 * carries a CTag and a history of changes, and the WebDAV-Sync report
 * reads that history. Every identifier comes from a counter. The ETags,
 * the CTags, and the sync tokens of a run are therefore the same on every
 * machine.
 */

import type { EtagStability, MockServerCapabilities } from './capabilities';

const SYNC_TOKEN_PREFIX = 'http://davenport.test/ns/sync';

export interface ResourceSeed {
	/**
	 * The name of the resource in the collection. The usual form is
	 * `{uid}.ics`.
	 */
	readonly name: string;
	readonly ics: string;
}

export interface CollectionSeed {
	readonly name: string;
	readonly displayName?: string;
	/**
	 * The default is events only. Real servers usually keep each kind of
	 * component in a collection of its own.
	 */
	readonly components?: readonly string[];
	readonly resources?: readonly ResourceSeed[];
}

export interface AccountSeed {
	readonly name: string;
	readonly displayName?: string;
	readonly userAddresses?: readonly string[];
	readonly collections?: readonly CollectionSeed[];
}

export interface ResourceState {
	readonly name: string;
	readonly href: string;
	ics: string;
	etag: string;
}

export interface ChangeEntry {
	readonly token: number;
	readonly href: string;
	readonly kind: 'changed' | 'removed';
}

export interface CollectionState {
	readonly name: string;
	readonly accountName: string;
	readonly href: string;
	readonly displayName: string;
	readonly components: readonly string[];
	readonly resources: Map<string, ResourceState>;
	readonly changes: ChangeEntry[];
	ctagCounter: number;
	syncCounter: number;
}

/**
 * A managed attachment. The server gives each attachment a managed
 * identifier, and the address of the attachment holds that identifier.
 */
export interface AttachmentState {
	readonly managedId: string;
	readonly href: string;
	/**
	 * The href of the resource that the server made this attachment for.
	 * The attachment lives only as long as that resource.
	 */
	readonly owner: string;
	readonly filename: string;
	readonly contentType: string;
	body: string;
}

/**
 * The data that the server makes an attachment from. The server, and not
 * the seed, gives the attachment its identifier.
 */
export interface AttachmentSeed {
	readonly owner: string;
	readonly filename: string;
	readonly contentType: string;
	readonly body: string;
}

export interface AccountState {
	readonly name: string;
	readonly displayName: string;
	readonly principalHref: string;
	readonly homeHref: string;
	readonly userAddresses: readonly string[];
	readonly collections: Map<string, CollectionState>;
}

export const WELL_KNOWN_PATH = '/.well-known/caldav';
export const PRINCIPAL_ROOT_PATH = '/principals/';
export const ATTACHMENTS_PATH = '/attachments/';

export type Route =
	| { readonly kind: 'well-known' }
	| { readonly kind: 'principal-root' }
	| { readonly kind: 'attachment'; readonly attachment: AttachmentState }
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
	  }
	| {
			readonly kind: 'absent-resource';
			readonly account: AccountState;
			readonly collection: CollectionState;
			readonly name: string;
	  }
	| { readonly kind: 'unknown' };

/**
 * The members of a collection, in the order of their names. The order of
 * a `Map` follows the order of the writes. With that order, a delete and
 * a new write of the same resource would move that resource in the list.
 * A test that checked the list would then check the order that the test
 * itself wrote in.
 */
export function membersOf(
	collection: CollectionState,
): readonly ResourceState[] {
	return Array.from(collection.resources.values()).sort(byName);
}

function byName(left: ResourceState, right: ResourceState): number {
	if (left.name === right.name) {
		return 0;
	}
	return left.name < right.name ? -1 : 1;
}

export class ServerState {
	readonly accounts = new Map<string, AccountState>();
	readonly attachments = new Map<string, AttachmentState>();
	private defaultAccount = '';
	private etagCounter = 0;
	private attachmentCounter = 0;

	constructor(seeds: readonly AccountSeed[]) {
		for (const seed of seeds) {
			this.accounts.set(seed.name, this.buildAccount(seed));
			if (this.defaultAccount === '') {
				this.defaultAccount = seed.name;
			}
		}
	}

	/**
	 * The account that the well-known endpoint and the principal-root
	 * endpoint answer for. A real server finds this account from the
	 * credentials of the request. The mock names the account directly.
	 */
	get currentAccount(): AccountState | null {
		return this.accounts.get(this.defaultAccount) ?? null;
	}

	authenticateAs(name: string): void {
		if (!this.accounts.has(name)) {
			throw new Error(
				`mock server has no account "${name}": add the account to the seeds`,
			);
		}
		this.defaultAccount = name;
	}

	account(name: string): AccountState {
		const found = this.accounts.get(name);
		if (!found) {
			throw new Error(
				`mock server has no account "${name}": add the account to the seeds`,
			);
		}
		return found;
	}

	collection(account: string, collection: string): CollectionState {
		const found = this.account(account).collections.get(collection);
		if (!found) {
			throw new Error(
				`mock server has no collection "${collection}": add the collection to the seeds`,
			);
		}
		return found;
	}

	resolve(path: string): Route {
		if (path === WELL_KNOWN_PATH) {
			return { kind: 'well-known' };
		}
		if (path === PRINCIPAL_ROOT_PATH) {
			return { kind: 'principal-root' };
		}
		const segments = path.split('/').filter((part) => part !== '');
		const [root, accountName, collectionName, resourceName] = segments;
		if (accountName === undefined) {
			return { kind: 'unknown' };
		}
		if (root === 'attachments') {
			const attachment =
				segments.length === 2
					? this.attachments.get(accountName)
					: undefined;
			return attachment
				? { kind: 'attachment', attachment }
				: { kind: 'unknown' };
		}
		const account = this.accounts.get(accountName);
		if (!account) {
			return { kind: 'unknown' };
		}
		if (root === 'principals' && segments.length === 2) {
			return { kind: 'principal', account };
		}
		if (root !== 'calendars') {
			return { kind: 'unknown' };
		}
		if (collectionName === undefined) {
			return { kind: 'home', account };
		}
		const collection = account.collections.get(collectionName);
		if (!collection) {
			return { kind: 'unknown' };
		}
		if (resourceName === undefined) {
			return { kind: 'collection', account, collection };
		}
		// A resource is not a collection. Thus the trailing-slash spelling
		// of a resource path names nothing, and one resource does not get
		// two names.
		if (segments.length > 4 || path.endsWith('/')) {
			return { kind: 'unknown' };
		}
		const resource = collection.resources.get(resourceName);
		return resource
			? { kind: 'resource', account, collection, resource }
			: {
					kind: 'absent-resource',
					account,
					collection,
					name: resourceName,
				};
	}

	/**
	 * Creates a resource, or replaces a resource that exists. The method
	 * then advances the CTag of the collection and adds an entry to the
	 * change history. Two callers use this method: the request path, and
	 * the code that seeds state without a request.
	 */
	write(collection: CollectionState, name: string, ics: string): string {
		const existing = collection.resources.get(name);
		const etag = this.mintEtag();
		if (existing) {
			existing.ics = ics;
			existing.etag = etag;
		} else {
			collection.resources.set(name, {
				name,
				href: `${collection.href}${name}`,
				ics,
				etag,
			});
		}
		this.registerChange(collection, `${collection.href}${name}`, 'changed');
		return etag;
	}

	/**
	 * Stores the bytes of an attachment. The result is the record that
	 * holds those bytes.
	 */
	addAttachment(seed: AttachmentSeed): AttachmentState {
		this.attachmentCounter += 1;
		const managedId = `attachment-${String(this.attachmentCounter)}`;
		const attachment: AttachmentState = {
			managedId,
			href: `${ATTACHMENTS_PATH}${managedId}`,
			owner: seed.owner,
			filename: seed.filename,
			contentType: seed.contentType,
			body: seed.body,
		};
		this.attachments.set(managedId, attachment);
		return attachment;
	}

	removeAttachment(managedId: string): boolean {
		return this.attachments.delete(managedId);
	}

	/**
	 * Removes a resource. The method also removes every attachment that
	 * the server made for that resource. The method removes those
	 * attachments here, and not on the request path. A resource that a
	 * test removes without a request therefore also leaves no attachment
	 * behind. An attachment address that outlived its only resource would
	 * answer for a calendar object that no client can reach.
	 */
	remove(collection: CollectionState, name: string): boolean {
		if (!collection.resources.delete(name)) {
			return false;
		}
		const href = `${collection.href}${name}`;
		for (const [managedId, attachment] of [...this.attachments]) {
			if (attachment.owner === href) {
				this.attachments.delete(managedId);
			}
		}
		this.registerChange(collection, href, 'removed');
		return true;
	}

	/**
	 * The ETag to report now. A server with per-fetch ETags makes a new
	 * ETag on every read. Each read therefore invalidates the ETag that
	 * every other reader holds. A client that reads and then writes still
	 * succeeds. A client that writes after another client read the
	 * resource fails.
	 */
	reportedEtag(resource: ResourceState, stability: EtagStability): string {
		if (stability === 'per-fetch') {
			resource.etag = this.mintEtag();
		}
		return resource.etag;
	}

	ctagOf(
		collection: CollectionState,
		caps: MockServerCapabilities,
	): string | null {
		if (caps.ctag === 'absent') {
			return null;
		}
		return caps.ctag === 'frozen'
			? '"ctag-frozen"'
			: `"ctag-${String(collection.ctagCounter)}"`;
	}

	syncTokenOf(collection: CollectionState, counter?: number): string {
		const at = counter ?? collection.syncCounter;
		return `${SYNC_TOKEN_PREFIX}${collection.href}${String(at)}`;
	}

	/**
	 * The counter that a sync token carries. The result is null when this
	 * collection did not issue the token. The method reads the counter
	 * strictly. The method then builds the token again and compares the
	 * two tokens whole. The method therefore refuses a token that is cut
	 * short, a token with extra padding, and every token that a numeric
	 * conversion alone would have accepted.
	 */
	parseSyncToken(collection: CollectionState, token: string): number | null {
		const prefix = `${SYNC_TOKEN_PREFIX}${collection.href}`;
		if (!token.startsWith(prefix)) {
			return null;
		}
		const suffix = token.slice(prefix.length);
		if (!/^\d+$/.test(suffix)) {
			return null;
		}
		const counter = Number(suffix);
		if (counter > collection.syncCounter) {
			return null;
		}
		return this.syncTokenOf(collection, counter) === token ? counter : null;
	}

	private registerChange(
		collection: CollectionState,
		href: string,
		kind: ChangeEntry['kind'],
	): void {
		collection.ctagCounter += 1;
		collection.syncCounter += 1;
		collection.changes.push({
			token: collection.syncCounter,
			href,
			kind,
		});
	}

	private mintEtag(): string {
		this.etagCounter += 1;
		return `"etag-${String(this.etagCounter)}"`;
	}

	private buildAccount(seed: AccountSeed): AccountState {
		const account: AccountState = {
			name: seed.name,
			displayName: seed.displayName ?? seed.name,
			principalHref: `/principals/${seed.name}/`,
			homeHref: `/calendars/${seed.name}/`,
			userAddresses: seed.userAddresses ?? [
				`mailto:${seed.name}@davenport.test`,
			],
			collections: new Map(),
		};
		for (const collectionSeed of seed.collections ?? []) {
			const collection: CollectionState = {
				name: collectionSeed.name,
				accountName: account.name,
				href: `${account.homeHref}${collectionSeed.name}/`,
				displayName: collectionSeed.displayName ?? collectionSeed.name,
				components: collectionSeed.components ?? ['VEVENT'],
				resources: new Map(),
				changes: [],
				ctagCounter: 0,
				syncCounter: 0,
			};
			account.collections.set(collection.name, collection);
			for (const resource of collectionSeed.resources ?? []) {
				this.write(collection, resource.name, resource.ics);
			}
		}
		return account;
	}
}
