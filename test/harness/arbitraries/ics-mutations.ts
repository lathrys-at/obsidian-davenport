/**
 * Changes to an iCalendar text that keep the meaning of the text.
 *
 * A calendar server can write the same event in more than one way. It can
 * fold a long line at another place, it can write a name in another case,
 * and it can put the properties of a component in another order. Two
 * devices that hold the same event must still hold record files with the
 * same bytes. The canonical serializer is what makes that true: it reads
 * any of these texts and writes one text.
 *
 * This module holds the changes that a server can make. A property test
 * applies one of them to a generated calendar and then asks the serializer
 * for the canonical text. The rule is that the canonical text does not
 * move.
 *
 * Every change here keeps the meaning. A change that alters the meaning
 * belongs to a test of the parse boundary, and not here.
 */

import fc from 'fast-check';
import { ICS_FOLD_OCTET_LIMIT } from '../../../src/core/ics/fold';
import { octetLength } from '../ics-octets';

/** One change, with the name that a failure report shows. */
export interface IcsMutation {
	readonly name: string;
	readonly apply: (text: string) => string;
}

const BYTE_ORDER_MARK = '\uFEFF';

/**
 * The logical lines of a text. The reader joins each continuation to the
 * line above it and drops the one space or tab that the fold added.
 */
export function logicalLinesOf(text: string): string[] {
	const lines: string[] = [];
	for (const physical of text.split(/\r\n|\n/)) {
		if (physical === '') {
			continue;
		}
		const above = lines[lines.length - 1];
		if (
			above !== undefined &&
			(physical.startsWith(' ') || physical.startsWith('\t'))
		) {
			lines[lines.length - 1] = above + physical.slice(1);
		} else {
			lines.push(physical);
		}
	}
	return lines;
}

/** The text that these logical lines make, folded at the given width. */
export function foldedAt(lines: readonly string[], limit: number): string {
	const physical: string[] = [];
	for (const line of lines) {
		let current = '';
		let octets = 0;
		for (const character of line) {
			const size = octetLength(character);
			if (octets + size > limit && current !== '') {
				physical.push(current);
				current = ' ';
				octets = 1;
			}
			current += character;
			octets += size;
		}
		physical.push(current);
	}
	return physical.map((line) => `${line}\r\n`).join('');
}

/** One component of a text, as a tree of lines. */
interface Block {
	readonly name: string;
	readonly properties: string[];
	readonly children: Block[];
}

function readBlocks(lines: readonly string[]): Block {
	const root: Block = { name: '', properties: [], children: [] };
	const open: Block[] = [root];
	for (const line of lines) {
		const current = open[open.length - 1];
		if (current === undefined) {
			throw new Error('the text closes more components than it opens');
		}
		if (line.startsWith('BEGIN:')) {
			const child: Block = {
				name: line.slice('BEGIN:'.length),
				properties: [],
				children: [],
			};
			current.children.push(child);
			open.push(child);
		} else if (line.startsWith('END:')) {
			open.pop();
		} else {
			current.properties.push(line);
		}
	}
	return root;
}

function writeBlocks(block: Block): string[] {
	const inside = [
		...block.properties,
		...block.children.flatMap((child) => writeBlocks(child)),
	];
	return block.name === ''
		? inside
		: [`BEGIN:${block.name}`, ...inside, `END:${block.name}`];
}

function mapBlocks(block: Block, change: (block: Block) => Block): Block {
	return change({
		name: block.name,
		properties: block.properties,
		children: block.children.map((child) => mapBlocks(child, change)),
	});
}

function reversedProperties(block: Block): Block {
	return { ...block, properties: [...block.properties].reverse() };
}

function reversedChildren(block: Block): Block {
	return { ...block, children: [...block.children].reverse() };
}

/** The name of a content line, before its parameters and its value. */
function nameOf(line: string): string {
	const marks = [line.indexOf(';'), line.indexOf(':')].filter(
		(at) => at !== -1,
	);
	return marks.length === 0 ? line : line.slice(0, Math.min(...marks));
}

function overBlocks(text: string, change: (block: Block) => Block): string {
	const lines = writeBlocks(
		mapBlocks(readBlocks(logicalLinesOf(text)), change),
	);
	return foldedAt(lines, ICS_FOLD_OCTET_LIMIT);
}

/**
 * Every change that this module makes. A property test draws one of them,
 * or it applies all of them one after the other.
 */
export const ICS_MUTATIONS: readonly IcsMutation[] = [
	{
		name: 'reverses the properties of every component',
		apply: (text) => overBlocks(text, reversedProperties),
	},
	{
		name: 'reverses the components inside every component',
		apply: (text) => overBlocks(text, reversedChildren),
	},
	{
		name: 'folds every line at a smaller width',
		apply: (text) => foldedAt(logicalLinesOf(text), 42),
	},
	{
		name: 'joins every fold',
		apply: (text) =>
			logicalLinesOf(text)
				.map((line) => `${line}\r\n`)
				.join(''),
	},
	{
		name: 'writes the name of every property in lower case',
		apply: (text) =>
			foldedAt(
				logicalLinesOf(text).map((line) => {
					const name = nameOf(line);
					return name === 'BEGIN' || name === 'END'
						? line
						: name.toLowerCase() + line.slice(name.length);
				}),
				ICS_FOLD_OCTET_LIMIT,
			),
	},
	{
		name: 'ends every line with a line feed alone',
		apply: (text) => text.replace(/\r\n/g, '\n'),
	},
	{
		name: 'puts a byte-order mark at the head',
		apply: (text) => BYTE_ORDER_MARK + text,
	},
];

/** All the changes, one after the other. */
export function composedMutation(text: string): string {
	return ICS_MUTATIONS.reduce(
		(carried, mutation) => mutation.apply(carried),
		text,
	);
}

/** Draws one of the changes. */
export function icsMutation(): fc.Arbitrary<IcsMutation> {
	const [first, ...rest] = ICS_MUTATIONS;
	if (first === undefined) {
		throw new Error('the list of changes holds no change');
	}
	return fc.constantFrom(first, ...rest);
}
