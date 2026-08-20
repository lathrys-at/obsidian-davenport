import { describe, expect, it } from 'vitest';
import {
	FILENAME_RULES,
	illegalCharacters,
	nameRefusals,
} from './illegal-names';

function rulesFor(platform: string) {
	const rules = FILENAME_RULES.find((each) => each.platform === platform);
	if (rules === undefined) {
		throw new Error(`no rules for ${platform}`);
	}
	return rules;
}

describe('the rules of every platform', () => {
	it('names each platform one time', () => {
		const names = FILENAME_RULES.map((rules) => rules.platform);
		expect(new Set(names).size).toBe(names.length);
	});

	it('refuses the separator of a path everywhere', () => {
		for (const rules of FILENAME_RULES) {
			expect(rules.refusal('a/b')).not.toBeNull();
		}
	});

	it('accepts a plain name everywhere', () => {
		expect(nameRefusals('plain-name')).toEqual([]);
	});
});

describe('the rules of Windows', () => {
	const windows = rulesFor('Windows');

	it.each(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])(
		'refuses the character %s',
		(character) => {
			expect(windows.refusal(`a${character}b`)).not.toBeNull();
		},
	);

	it('refuses a character below a space', () => {
		expect(windows.refusal(`a${String.fromCharCode(1)}b`)).not.toBeNull();
	});

	it('refuses a name that ends with a dot', () => {
		expect(windows.refusal('report.')).toContain('ends with a dot');
	});

	it('refuses a name that ends with a space', () => {
		expect(windows.refusal('report ')).toContain('ends with a space');
	});

	it('refuses a name that Windows reserves for a device', () => {
		expect(windows.refusal('nul.md')).toContain('reserves');
	});
});

describe('the rules of the other platforms', () => {
	it('refuses the colon on the platforms of Apple', () => {
		expect(rulesFor('macOS and iOS').refusal('a:b')).not.toBeNull();
	});

	it('accepts the colon on Linux', () => {
		expect(rulesFor('Linux and Android').refusal('a:b')).toBeNull();
	});

	it('accepts a name that ends with a dot on Linux', () => {
		expect(rulesFor('Linux and Android').refusal('report.')).toBeNull();
	});

	it('refuses the nine characters of Windows inside Obsidian', () => {
		expect(rulesFor('Obsidian').refusal('a*b')).not.toBeNull();
	});
});

describe('the reasons that a name collects', () => {
	it('names every platform that refuses the name', () => {
		expect(nameRefusals('a/b')).toHaveLength(FILENAME_RULES.length);
	});

	it('names only the platforms that refuse the name', () => {
		const refusals = nameRefusals('a:b');
		expect(refusals.some((reason) => reason.startsWith('Windows'))).toBe(
			true,
		);
		expect(
			refusals.some((reason) => reason.startsWith('Linux and Android')),
		).toBe(false);
	});

	it('collects the characters of every platform', () => {
		const characters = illegalCharacters();
		expect(characters).toContain('/');
		expect(characters).toContain(':');
		expect(characters).toContain('*');
		expect(characters).toContain(String.fromCharCode(0));
	});
});
