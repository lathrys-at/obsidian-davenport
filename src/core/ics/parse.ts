/**
 * The parse boundary of the engine.
 *
 * The parse library reads iCalendar text. The library also accepts text
 * that iCalendar does not permit. When the text is damaged, the library
 * gives the text a meaning of its own and reports no problem. The output
 * of this engine becomes the copy of the server state that the vault
 * holds. A meaning that the library invents thus becomes the truth that
 * the vault keeps. This boundary therefore refuses damaged text. The
 * boundary never repairs the text.
 *
 * The library throws more than one class of error. The library gives a
 * list back when the text holds more than one calendar. This boundary
 * reports every one of those outcomes as one failure type.
 *
 * The gate reads the text a second time and compares it with what the
 * library reports. The file jcal.ts holds the types and the narrowing.
 * The file lines.ts reads the lines. The file values.ts holds the lexical
 * rules of the value types. The file parameters.ts holds the changes that
 * the library makes to the text of a parameter value.
 *
 * What the gate checks:
 *
 * - The parse gives one calendar in the shape that jCal states. A list of
 *   calendars is a failure. A structure that jCal does not use is a
 *   failure. A root component with a name other than VCALENDAR is a
 *   failure.
 * - The structure agrees with the text. Every component and every property
 *   that the parser reports stands in the text. The names and the order
 *   are the same. The text holds nothing that the parser dropped. An END
 *   line names the component that its BEGIN line opened.
 * - Each property keeps its parameters. The count of parameters in the
 *   text equals the count that the parser reports. VALUE is not counted,
 *   because the parser turns VALUE into the value type of the property.
 * - Each parameter keeps its bytes. The value that the parser reports for
 *   a parameter equals the text of that parameter after the changes that
 *   keep the meaning. The file parameters.ts states those changes.
 * - The text of a value obeys the lexical rules of the value type that the
 *   parser gave to that value. These types are the boolean, the date, the
 *   date-time, the duration, the float, the integer, the period, the time,
 *   and the offset from universal time.
 * - A number that the parser read equals the number that the text writes.
 *   The parser holds a number in a form that carries fewer digits than
 *   iCalendar permits, and a text past that width comes back changed.
 * - A repeat rule keeps its parts, and each part obeys the rules of the
 *   format: the frequency and the start of the week take their names, the
 *   end takes a date or a date-time, the count and the interval take a
 *   whole number, and each selection part takes its list of days or
 *   numbers. A part whose name no standard states keeps its text in the
 *   parser, so the gate gives it no rule.
 * - No line holds a control character. The format permits the horizontal
 *   tab only. The parser keeps every other control character in the value.
 *
 * The gate removes one byte-order mark from the head of the text before
 * the parse. A byte-order mark is common on a file that a calendar
 * application exported, and the library cannot read a text that starts
 * with one.
 *
 * What the gate deliberately does not check:
 *
 * - The rules of iCalendar that go past the lexical form. The gate does
 *   not ask whether a component holds the properties that its kind needs.
 *   The gate does not ask whether a property can stand in the component
 *   that holds it. The gate does not count the times that a property
 *   occurs.
 * - The meaning of a value that obeys its lexical rules. A date that names
 *   a day which does not exist passes the gate. An identifier that names
 *   no time zone passes the gate. A repeat rule that selects no day passes
 *   the gate.
 * - The changes that the round trip makes and that keep the meaning. The
 *   list names every such change that the tests of this module observe. It
 *   is not a proof that the round trip makes no other change. The tests
 *   hold one text for each item:
 *     - the parser raises the case of a property name and of a parameter
 *       name;
 *     - the parser drops a value type that is the default one;
 *     - the parser removes quotation marks that nothing needs, and the
 *       serializer adds quotation marks that the format requires;
 *     - the parser decodes a parameter escape, and the serializer writes
 *       the same escape again;
 *     - the serializer encodes a caret and a quotation mark inside a
 *       parameter value as the format states;
 *     - the parser reads a backslash and the letter n, in either case, as
 *       a line break inside a parameter value, and the serializer writes
 *       that line break as a parameter escape;
 *     - the serializer writes a backslash before a character that a text
 *       value must escape, and it writes two backslashes for one;
 *     - the serializer writes a number in its plain form, so a leading
 *       plus sign, a leading zero, a trailing zero after a decimal point,
 *       and the sign of a zero are gone;
 *     - the serializer moves VALUE to the end of the parameter list;
 *     - a property that stands after a component moves in front of that
 *       component, because jCal holds the properties of a component in one
 *       list and the components inside it in another list;
 *     - a property that stands between two components moves in front of
 *       both, for the same reason;
 *     - the serializer folds a long line again, and it can fold at another
 *       place than the text does;
 *     - the serializer joins a fold that the text makes where no fold is
 *       necessary;
 *     - the serializer ends every line with a carriage return and a line
 *       feed, so a text that ends its lines with a line feed alone gets
 *       the carriage return back.
 *
 *   The last five changes are the work of the canonical serializer, and
 *   that serializer owns the order of properties and the width of a fold.
 * - The one change of meaning that this project accepts: a vendor
 *   parameter that carries more than one value becomes one value that
 *   holds the commas.
 */

import ICAL from 'ical.js';
import type { JCalComponent } from './jcal';
import { jcalListLength, jcalValues, readJCalComponent } from './jcal';
import type { ContentLine, ContentParameter } from './lines';
import { hasControlCharacter, logicalLines, readContentLine } from './lines';
import { parameterTextProblem } from './parameters';
import { valueTextProblem } from './values';

/** Why the boundary refused the text. */
export type IcsParseProblem =
	/** The library refused the text and threw. */
	| 'unreadable'
	/** The parse gave back no calendar, or a root that is not a calendar. */
	| 'no-calendar'
	/** The text holds more than one calendar. */
	| 'many-calendars'
	/** The parse gave back a structure that jCal does not use. */
	| 'not-jcal'
	/**
	 * The text is not well formed, or the structure that the parser
	 * reports disagrees with the text.
	 */
	| 'structure'
	/**
	 * A value does not come through the parse whole. The value disobeys
	 * the lexical rules of its type, or the parser read a different number,
	 * or the value of a parameter lost bytes.
	 */
	| 'value';

/** One failure of the boundary. Every refused text gives this shape. */
export interface IcsParseFailure {
	readonly problem: IcsParseProblem;
	readonly message: string;
	/** The error that the library threw, when the library threw one. */
	readonly cause?: unknown;
}

/** What a parse gives back. */
export type IcsParseResult =
	| { readonly ok: true; readonly calendar: JCalComponent }
	| { readonly ok: false; readonly failure: IcsParseFailure };

/**
 * Reads iCalendar text into one typed calendar, or refuses the text. The
 * comment at the head of this file states what the refusal covers.
 */
export function parseIcs(text: string): IcsParseResult {
	const source = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
	let parsed: unknown;
	try {
		parsed = ICAL.parse(source);
	} catch (error) {
		return refuse({
			problem: 'unreadable',
			message: 'ics parse: the library cannot read the text',
			cause: error,
		});
	}

	const listLength = jcalListLength(parsed);
	if (listLength !== null) {
		return refuse(
			listLength === 0
				? {
						problem: 'no-calendar',
						message: 'ics parse: the text holds no calendar',
					}
				: {
						problem: 'many-calendars',
						message: `ics parse: the text holds ${String(listLength)} calendars; one resource holds one calendar`,
					},
		);
	}

	const reading = readJCalComponent(parsed);
	if (!reading.ok) {
		return refuse({
			problem: 'not-jcal',
			message: `ics parse: the parse gave a structure that jCal does not use; ${reading.problem}`,
		});
	}
	const calendar = reading.component;
	if (calendar[0].toUpperCase() !== 'VCALENDAR') {
		return refuse({
			problem: 'no-calendar',
			message: `ics parse: the root component is ${calendar[0]} and not VCALENDAR`,
		});
	}

	const failure = gate(calendar, source);
	if (failure !== null) {
		return refuse(failure);
	}
	return { ok: true, calendar };
}

const BYTE_ORDER_MARK = '\uFEFF';

function refuse(failure: IcsParseFailure): IcsParseResult {
	return { ok: false, failure };
}

function structureFailure(message: string): IcsParseFailure {
	return { problem: 'structure', message: `ics parse: ${message}` };
}

function valueFailure(message: string): IcsParseFailure {
	return { problem: 'value', message: `ics parse: ${message}` };
}

/** One component that a BEGIN opened, and how far the walk has read it. */
interface OpenComponent {
	readonly component: JCalComponent;
	readonly openedAs: string;
	propertyIndex: number;
	componentIndex: number;
}

/** The state of the walk over the lines of the text. */
interface Walk {
	readonly calendar: JCalComponent;
	readonly open: OpenComponent[];
	rootClosed: boolean;
}

function gate(calendar: JCalComponent, text: string): IcsParseFailure | null {
	const lines = logicalLines(text);
	if (lines === null) {
		return structureFailure(
			'the text starts with a line that continues a line before it',
		);
	}
	const walk: Walk = { calendar, open: [], rootClosed: false };
	for (const line of lines) {
		if (hasControlCharacter(line)) {
			return structureFailure(
				`the line ${quote(line)} holds a character that iCalendar does not permit`,
			);
		}
		const reading = readContentLine(line);
		if (!reading.ok) {
			return structureFailure(
				`the line ${quote(line)} ${reading.problem}`,
			);
		}
		const content = reading.line;
		if (walk.rootClosed) {
			return structureFailure(
				`the line ${quote(line)} stands after the calendar ends`,
			);
		}
		const keyword = content.name.toUpperCase();
		if (keyword === 'BEGIN' || keyword === 'END') {
			if (content.parameters.length > 0) {
				return structureFailure(
					`the line ${quote(line)} opens or closes a component and carries parameters`,
				);
			}
			const failure =
				keyword === 'BEGIN'
					? openComponent(walk, content.value)
					: closeComponent(walk, content.value);
			if (failure !== null) {
				return failure;
			}
			continue;
		}
		const failure = takeProperty(walk, content);
		if (failure !== null) {
			return failure;
		}
	}
	const last = walk.open[walk.open.length - 1];
	if (last !== undefined) {
		return structureFailure(
			`the text ends while the component ${last.openedAs} stays open`,
		);
	}
	if (!walk.rootClosed) {
		return structureFailure('the text opens no calendar');
	}
	return null;
}

function openComponent(walk: Walk, name: string): IcsParseFailure | null {
	const parent = walk.open[walk.open.length - 1];
	if (parent === undefined) {
		if (!sameName(walk.calendar[0], name)) {
			return structureFailure(
				`the text opens ${name}, and the parser reports ${walk.calendar[0]}`,
			);
		}
		walk.open.push(frame(walk.calendar, name));
		return null;
	}
	const child = parent.component[2][parent.componentIndex];
	if (child === undefined) {
		return structureFailure(
			`the text opens ${name}, and the parser reports no component there`,
		);
	}
	if (!sameName(child[0], name)) {
		return structureFailure(
			`the text opens ${name}, and the parser reports ${child[0]}`,
		);
	}
	parent.componentIndex += 1;
	walk.open.push(frame(child, name));
	return null;
}

function closeComponent(walk: Walk, name: string): IcsParseFailure | null {
	const current = walk.open.pop();
	if (current === undefined) {
		return structureFailure(`END ${name} closes no component`);
	}
	if (!sameName(current.openedAs, name)) {
		return structureFailure(
			`END ${name} does not agree with BEGIN ${current.openedAs}`,
		);
	}
	if (current.propertyIndex !== current.component[1].length) {
		return structureFailure(
			`the parser reports properties in ${name} that the text does not hold`,
		);
	}
	if (current.componentIndex !== current.component[2].length) {
		return structureFailure(
			`the parser reports components in ${name} that the text does not hold`,
		);
	}
	if (walk.open.length === 0) {
		walk.rootClosed = true;
	}
	return null;
}

function takeProperty(
	walk: Walk,
	content: ContentLine,
): IcsParseFailure | null {
	const current = walk.open[walk.open.length - 1];
	if (current === undefined) {
		return structureFailure(
			`the property ${content.name} stands outside every component`,
		);
	}
	const property = current.component[1][current.propertyIndex];
	if (property === undefined) {
		return structureFailure(
			`the text holds the property ${content.name}, and the parser reports no property there`,
		);
	}
	if (!sameName(property[0], content.name)) {
		return structureFailure(
			`the text holds the property ${content.name}, and the parser reports ${property[0]}`,
		);
	}
	current.propertyIndex += 1;
	const written = countedParameters(content.parameters);
	const reported = Object.keys(property[1]).length;
	if (written.length !== reported) {
		return structureFailure(
			`the property ${content.name} carries ${String(written.length)} parameters, and the parser reports ${String(reported)}`,
		);
	}
	for (const parameter of written) {
		const problem = parameterTextProblem(
			parameter,
			property[1][parameter.name.toLowerCase()],
		);
		if (problem !== null) {
			return valueFailure(
				`the property ${content.name} holds ${problem}`,
			);
		}
	}
	const problem = valueTextProblem(
		property[2],
		content.value,
		jcalValues(property),
	);
	return problem === null
		? null
		: valueFailure(`the property ${content.name} ${problem}`);
}

function frame(component: JCalComponent, openedAs: string): OpenComponent {
	return { component, openedAs, propertyIndex: 0, componentIndex: 0 };
}

function sameName(left: string, right: string): boolean {
	return left.toUpperCase() === right.toUpperCase();
}

// The parser turns VALUE into the value type of the property, and it keeps
// no parameter of that name. The count of parameters therefore leaves
// VALUE out.
function countedParameters(
	parameters: readonly ContentParameter[],
): readonly ContentParameter[] {
	return parameters.filter(
		(parameter) => parameter.name.toUpperCase() !== 'VALUE',
	);
}

function quote(text: string): string {
	return JSON.stringify(text);
}
