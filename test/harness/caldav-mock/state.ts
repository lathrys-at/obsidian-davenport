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

export type Route =
	| { readonly kind: 'well-known' }
	| { readonly kind: 'principal-root' }
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

export class ServerState {
	readonly accounts = new Map<string, AccountState>();
	private defaultAccount = '';
	private etagCounter = 0;

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
		if (segments.length > 4) {
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

	remove(collection: CollectionState, name: string): boolean {
		if (!collection.resources.delete(name)) {
			return false;
		}
		this.registerChange(collection, `${collection.href}${name}`, 'removed');
		return true;
	}

	/**
	 * The ETag to report now. A per-fetch server mints a fresh one on every
	 * read, which is what makes its If-Match backstop worthless.
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

	/** Null when the token was not issued by this collection. */
	parseSyncToken(collection: CollectionState, token: string): number | null {
		const prefix = `${SYNC_TOKEN_PREFIX}${collection.href}`;
		if (!token.startsWith(prefix)) {
			return null;
		}
		const counter = Number(token.slice(prefix.length));
		if (!Number.isInteger(counter) || counter < 0) {
			return null;
		}
		return counter <= collection.syncCounter ? counter : null;
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
