/**
 * The server model: accounts, each with a principal, a calendar home, and
 * collections holding resources. Resources are ICS bytes with an ETag;
 * collections carry a CTag and the change history WebDAV-Sync reports
 * from. Every identifier comes from a counter, so a run's ETags, CTags,
 * and sync-tokens are the same on every machine.
 */

import type { EtagStability, MockServerCapabilities } from './capabilities';

const SYNC_TOKEN_PREFIX = 'http://davenport.test/ns/sync';

export interface ResourceSeed {
	/** Basename within the collection, conventionally `{uid}.ics`. */
	readonly name: string;
	readonly ics: string;
}

export interface CollectionSeed {
	readonly name: string;
	readonly displayName?: string;
	/** Defaults to events only, the ecosystem's usual split. */
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

/** A managed attachment, addressed by the identifier that minted it. */
export interface AttachmentState {
	readonly managedId: string;
	readonly href: string;
	readonly filename: string;
	readonly contentType: string;
	body: string;
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
 * A collection's members in name order. Map order would follow write
 * history, so deleting and re-creating a resource would move it, and a
 * listing would then be asserting the order the test wrote in.
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
	 * The account the well-known and principal-root endpoints answer for.
	 * A real server reads it from the credentials; the mock names it.
	 */
	get currentAccount(): AccountState | null {
		return this.accounts.get(this.defaultAccount) ?? null;
	}

	authenticateAs(name: string): void {
		if (!this.accounts.has(name)) {
			throw new Error(`mock server has no account ${name}`);
		}
		this.defaultAccount = name;
	}

	account(name: string): AccountState {
		const found = this.accounts.get(name);
		if (!found) {
			throw new Error(`mock server has no account ${name}`);
		}
		return found;
	}

	collection(account: string, collection: string): CollectionState {
		const found = this.account(account).collections.get(collection);
		if (!found) {
			throw new Error(`mock server has no collection ${collection}`);
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
		// A resource is not a collection, so the trailing-slash spelling of
		// its path names nothing rather than the same resource twice.
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
	 * Creates or replaces a resource and advances the collection's CTag and
	 * change history. Shared by the request path and out-of-band seeding.
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

	/** Stores attachment bytes and hands back the resource that holds them. */
	addAttachment(
		filename: string,
		contentType: string,
		body: string,
	): AttachmentState {
		this.attachmentCounter += 1;
		const managedId = `attachment-${String(this.attachmentCounter)}`;
		const attachment: AttachmentState = {
			managedId,
			href: `${ATTACHMENTS_PATH}${managedId}`,
			filename,
			contentType,
			body,
		};
		this.attachments.set(managedId, attachment);
		return attachment;
	}

	removeAttachment(managedId: string): boolean {
		return this.attachments.delete(managedId);
	}

	remove(collection: CollectionState, name: string): boolean {
		if (!collection.resources.delete(name)) {
			return false;
		}
		this.registerChange(collection, `${collection.href}${name}`, 'removed');
		return true;
	}

	/**
	 * The ETag to report now. A per-fetch server mints a fresh one on every
	 * read, so any read invalidates the ETag every other reader is holding:
	 * a client's own read-then-write still succeeds, and a write behind
	 * somebody else's read does not.
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
	 * Null when the token is not one this collection issued. The candidate
	 * counter is read strictly and the token is then rebuilt and compared
	 * whole, so a truncated token, a padded one, and anything numeric
	 * coercion would have accepted are all refused.
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
