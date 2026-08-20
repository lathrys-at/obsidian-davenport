import { beforeEach, describe, expect, it } from 'vitest';
import type { EventIdentity } from '../model/identity';
import { LedgerIndex } from './ledger-index';

const WORK = 'https://dav.example.com/calendars/ren/work/';
const HOME = 'https://dav.example.com/calendars/ren/home/';

function identity(collectionHref: string, uid: string): EventIdentity {
	return { collectionHref, uid };
}

let index: LedgerIndex;

beforeEach(() => {
	index = new LedgerIndex();
});

describe('the index from an identity to a path', () => {
	it('holds nothing at the start', () => {
		expect(index.size).toBe(0);
		expect(index.entries()).toEqual([]);
	});

	it('answers the path of an identity that it holds', () => {
		expect(index.add(identity(WORK, 'one'), 'records/a.md')).toBe('added');
		expect(index.pathOf(identity(WORK, 'one'))).toBe('records/a.md');
		expect(index.size).toBe(1);
	});

	it('answers nothing for an identity that it does not hold', () => {
		expect(index.pathOf(identity(WORK, 'one'))).toBeUndefined();
	});

	it('reads one identity out of two collections as two records', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		index.add(identity(HOME, 'one'), 'records/b.md');
		expect(index.pathOf(identity(WORK, 'one'))).toBe('records/a.md');
		expect(index.pathOf(identity(HOME, 'one'))).toBe('records/b.md');
	});

	it('tells two pairs apart that a plain join would run together', () => {
		index.add(identity('ab', 'c'), 'records/a.md');
		expect(index.pathOf(identity('a', 'bc'))).toBeUndefined();
	});
});

describe('the index from a path to an identity', () => {
	it('answers the identity that a path holds', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		expect(index.identityOf('records/a.md')).toEqual(identity(WORK, 'one'));
	});

	it('answers nothing for a path that it does not hold', () => {
		expect(index.identityOf('records/a.md')).toBeUndefined();
	});
});

describe('a second file that claims a record that the index holds', () => {
	it('says that the identity already stands at another path', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		expect(index.add(identity(WORK, 'one'), 'records/b.md')).toBe(
			'duplicate-identity',
		);
	});

	it('leaves the path of the first file in place', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		index.add(identity(WORK, 'one'), 'records/b.md');
		expect(index.pathOf(identity(WORK, 'one'))).toBe('records/a.md');
		expect(index.identityOf('records/b.md')).toBeUndefined();
	});

	it('says that the path already holds another identity', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		expect(index.add(identity(WORK, 'two'), 'records/a.md')).toBe(
			'duplicate-path',
		);
	});

	it('says that it already holds this identity at this path', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		expect(index.add(identity(WORK, 'one'), 'records/a.md')).toBe('known');
		expect(index.size).toBe(1);
	});
});

describe('the removal of one record from the index', () => {
	it('takes both directions out', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		expect(index.remove('records/a.md')).toBe(true);
		expect(index.pathOf(identity(WORK, 'one'))).toBeUndefined();
		expect(index.identityOf('records/a.md')).toBeUndefined();
		expect(index.size).toBe(0);
	});

	it('says that it held no such path', () => {
		expect(index.remove('records/a.md')).toBe(false);
	});

	it('takes the identity of a second file that it did not hold', () => {
		index.add(identity(WORK, 'one'), 'records/a.md');
		index.add(identity(WORK, 'one'), 'records/b.md');
		index.remove('records/a.md');
		expect(index.add(identity(WORK, 'one'), 'records/b.md')).toBe('added');
	});
});

describe('the entries of the index', () => {
	it('stand in the order in which they arrived', () => {
		index.add(identity(WORK, 'b'), 'records/b.md');
		index.add(identity(WORK, 'a'), 'records/a.md');
		expect(index.entries()).toEqual([
			{ identity: identity(WORK, 'b'), path: 'records/b.md' },
			{ identity: identity(WORK, 'a'), path: 'records/a.md' },
		]);
	});
});
