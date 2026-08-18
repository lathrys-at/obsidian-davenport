/**
 * The titles that a file of source declares. A title is the first argument of
 * a call to describe, to it, to test, to suite, or to bench. The reader takes
 * the plain calls and the modifier forms: each, skip, only, and the chains
 * that mix them. The reader also takes a curried call, which is the shape
 * that a table of rows produces, with the rows in parentheses or in a tagged
 * template.
 *
 * The reader parses the file with the TypeScript parser, and it matches no
 * pattern over the text. Therefore a quote character inside a regular
 * expression, a comment, or a title cannot move the reader out of step with
 * the file.
 *
 * A title that is not a plain string is unreadable. A title that a program
 * builds from parts is one example, and a template with an expression in it
 * is another example. The reader keeps the line and the text of each
 * unreadable title, so that the check can name it. The reader never takes a
 * part of such a title for the whole of it.
 */

import ts from 'typescript';

/** The names that carry a title. */
const CALLERS = new Set(['describe', 'it', 'test', 'suite', 'bench']);

/** The longest excerpt that the reader keeps for an unreadable title. */
const EXCERPT_LIMIT = 60;

/** One title, and the line of the file that the call starts on. */
export interface TitleSite {
	readonly line: number;
	readonly title: string;
}

/** One title that is not a plain string, and the text that stands there. */
export interface UnreadableSite {
	readonly line: number;
	readonly text: string;
}

/** The titles of one file, and the titles that the reader cannot read. */
export interface TitleScan {
	readonly titles: readonly TitleSite[];
	readonly unreadable: readonly UnreadableSite[];
}

/** The titles that a file declares. */
export function readTitles(source: string, path = 'suite.test.ts'): TitleScan {
	const file = ts.createSourceFile(
		path,
		source,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const titles: TitleSite[] = [];
	const unreadable: UnreadableSite[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isCallExpression(node) && carriesTitle(node)) {
			const line = lineOf(file, node);
			const argument = node.arguments[0];
			const title = plainString(argument);
			if (title === undefined) {
				unreadable.push({ line, text: excerpt(file, argument) });
			} else {
				titles.push({ line, title });
			}
		}
		ts.forEachChild(node, visit);
	};
	ts.forEachChild(file, visit);
	return { titles, unreadable };
}

/**
 * Whether this call takes a title. The name in front of the call decides
 * this. A call that another call or a template stands on is a step toward
 * the title, and the call that stands on top of that step carries the title.
 */
function carriesTitle(node: ts.CallExpression): boolean {
	const name = rootName(node.expression);
	if (name === undefined || !CALLERS.has(name)) {
		return false;
	}
	const parent = node.parent;
	if (ts.isCallExpression(parent) && parent.expression === node) {
		return false;
	}
	if (ts.isTaggedTemplateExpression(parent) && parent.tag === node) {
		return false;
	}
	return !(
		ts.isPropertyAccessExpression(parent) && parent.expression === node
	);
}

/** The name at the start of a call, under the modifiers and the rows. */
function rootName(expression: ts.Expression): string | undefined {
	let node: ts.Expression = expression;
	for (;;) {
		if (ts.isIdentifier(node)) {
			return node.text;
		}
		if (ts.isPropertyAccessExpression(node)) {
			node = node.expression;
		} else if (ts.isCallExpression(node)) {
			node = node.expression;
		} else if (ts.isTaggedTemplateExpression(node)) {
			node = node.tag;
		} else if (ts.isParenthesizedExpression(node)) {
			node = node.expression;
		} else if (ts.isNonNullExpression(node)) {
			node = node.expression;
		} else {
			return undefined;
		}
	}
}

/** The text of a plain string. A title of any other shape has no text. */
function plainString(argument: ts.Expression | undefined): string | undefined {
	if (argument === undefined) {
		return undefined;
	}
	if (ts.isStringLiteral(argument)) {
		return argument.text;
	}
	if (ts.isNoSubstitutionTemplateLiteral(argument)) {
		return argument.text;
	}
	return undefined;
}

/** The text that stands where a plain string was expected. */
function excerpt(
	file: ts.SourceFile,
	argument: ts.Expression | undefined,
): string {
	if (argument === undefined) {
		return 'the call gives no title';
	}
	const text = argument.getText(file).replace(/\s+/g, ' ').trim();
	return text.length > EXCERPT_LIMIT
		? `${text.slice(0, EXCERPT_LIMIT)}…`
		: text;
}

/** The line that the call starts on. The first line is line one. */
function lineOf(file: ts.SourceFile, node: ts.Node): number {
	return file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
}
