import { describe, expect, it } from 'vitest';
import type { JCalComponent } from '../../src/core/ics/jcal';
import { contentOf, stableJson } from './ics-content';

const VERSION: JCalComponent[1][number] = ['version', {}, 'text', '2.0'];

describe('the text of a value', () => {
	it('gives one text to two objects that hold the entries in two orders', () => {
		expect(stableJson({ a: 1, b: 2 })).toBe(stableJson({ b: 2, a: 1 }));
	});

	it('keeps the order of the items of a list', () => {
		expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
	});

	it('reads the objects inside a list', () => {
		expect(stableJson([{ a: 1, b: 2 }])).toBe(stableJson([{ b: 2, a: 1 }]));
	});

	it('gives two texts to a number and to the text of that number', () => {
		expect(stableJson(1)).not.toBe(stableJson('1'));
	});
});

describe('the content of a component', () => {
	it('passes over the order of the properties', () => {
		const left: JCalComponent = [
			'vcalendar',
			[VERSION, ['x-a', {}, 'text', 'a']],
			[],
		];
		const right: JCalComponent = [
			'vcalendar',
			[['x-a', {}, 'text', 'a'], VERSION],
			[],
		];
		expect(contentOf(left)).toBe(contentOf(right));
	});

	it('passes over the order of the components inside a component', () => {
		const event: JCalComponent = ['vevent', [], []];
		const todo: JCalComponent = ['vtodo', [], []];
		expect(contentOf(['vcalendar', [], [event, todo]])).toBe(
			contentOf(['vcalendar', [], [todo, event]]),
		);
	});

	it('passes over the case of the name of a component', () => {
		expect(contentOf(['VCALENDAR', [], []])).toBe(
			contentOf(['vcalendar', [], []]),
		);
	});

	it('reads a value that one component holds and the other does not', () => {
		expect(contentOf(['vcalendar', [VERSION], []])).not.toBe(
			contentOf(['vcalendar', [], []]),
		);
	});

	it('reads the components that stand inside a component', () => {
		expect(
			contentOf(['vcalendar', [], [['vevent', [VERSION], []]]]),
		).not.toBe(contentOf(['vcalendar', [], [['vevent', [], []]]]));
	});
});
