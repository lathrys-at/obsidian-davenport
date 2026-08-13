/**
 * Reads and writes the XML of the mock CalDAV server. The functions use a
 * DOM that knows about XML namespaces.
 *
 * A WebDAV client chooses its own namespace prefixes, and a default
 * namespace is legal at every point in a body. A prefix therefore says
 * nothing that the mock can trust. Every lookup in this file uses the
 * namespace URI and the local name instead. The mock builds each response
 * as a tree and then serializes the tree. The mock never puts XML together
 * as strings, and never matches XML as strings.
 */

import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import type {
	Document as XmlDocument,
	Element as XmlElement,
	Node as XmlNode,
} from '@xmldom/xmldom';

export type { XmlDocument, XmlElement };

export const DAV_NS = 'DAV:';
export const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';
export const CALENDARSERVER_NS = 'http://calendarserver.org/ns/';

const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const ELEMENT_NODE = 1;

const PREFIX_BY_NAMESPACE: ReadonlyMap<string, string> = new Map([
	[DAV_NS, 'D'],
	[CALDAV_NS, 'C'],
	[CALENDARSERVER_NS, 'CS'],
]);

/**
 * An element name with its namespace. The mock identifies an element by
 * this pair.
 */
export interface PropName {
	readonly ns: string;
	readonly local: string;
}

/**
 * A request body in one of three states. A request that carries no body at
 * all is a legal request. A body that does not parse is a bad request. A
 * body that parses carries a document.
 */
export type XmlBody =
	| { readonly kind: 'absent' }
	| { readonly kind: 'malformed' }
	| { readonly kind: 'document'; readonly document: XmlDocument };

export const ABSENT_BODY: XmlBody = { kind: 'absent' };

export function parseBody(text: string): XmlBody {
	if (text.trim() === '') {
		return ABSENT_BODY;
	}
	const document = parseXml(text);
	return document === null
		? { kind: 'malformed' }
		: { kind: 'document', document };
}

/**
 * Parses the text and returns the document. Returns null when the text is
 * empty, and null when the text is not well formed.
 */
export function parseXml(text: string): XmlDocument | null {
	if (text.trim() === '') {
		return null;
	}
	try {
		const doc = new DOMParser({
			onError: swallowParseError,
		}).parseFromString(text, 'text/xml');
		return doc.documentElement ? doc : null;
	} catch {
		return null;
	}
}

/**
 * Discards the errors of the parser. The mock answers a body that does
 * not parse with a status code, and prints no message.
 */
function swallowParseError(): void {
	return;
}

/**
 * Returns the document that a parsed body carries. Returns null when the
 * body is absent, and null when the body does not parse.
 */
export function documentOf(body: XmlBody): XmlDocument | null {
	return body.kind === 'document' ? body.document : null;
}

function isElement(node: XmlNode): node is XmlElement {
	return node.nodeType === ELEMENT_NODE;
}

export function childElements(parent: XmlElement): XmlElement[] {
	const found: XmlElement[] = [];
	for (
		let node: XmlNode | null = parent.firstChild;
		node;
		node = node.nextSibling
	) {
		if (isElement(node)) {
			found.push(node);
		}
	}
	return found;
}

export function isNamed(el: XmlElement, ns: string, local: string): boolean {
	return el.namespaceURI === ns && el.localName === local;
}

/**
 * Returns the direct children with the given name. The function looks at
 * the direct children only. A search of all the descendants would cross
 * the nesting of the filter elements.
 */
export function childrenNamed(
	parent: XmlElement,
	ns: string,
	local: string,
): XmlElement[] {
	return childElements(parent).filter((el) => isNamed(el, ns, local));
}

export function childNamed(
	parent: XmlElement,
	ns: string,
	local: string,
): XmlElement | null {
	return childrenNamed(parent, ns, local)[0] ?? null;
}

/**
 * Returns the descendants with the given name, at any depth. The prop
 * elements and the href elements sit at a different depth from body to
 * body.
 */
export function descendantsNamed(
	root: XmlElement,
	ns: string,
	local: string,
): XmlElement[] {
	return Array.from(root.getElementsByTagNameNS(ns, local));
}

export function textOf(el: XmlElement): string {
	return el.textContent ?? '';
}

export function nameOf(el: XmlElement): PropName {
	return { ns: el.namespaceURI ?? '', local: el.localName ?? '' };
}

/**
 * Builds a response document.
 *
 * The class declares the three namespaces of the server on the root
 * element, as a real server does. The elements below the root therefore
 * carry no declaration of their own, and one tree always serializes to the
 * same octets.
 *
 * A request can name a property in any namespace at all, and the response
 * must repeat that name in a propstat with status 404. For a namespace
 * outside the three, the class makes a prefix at the first use of that
 * namespace. The class then declares the prefix on the root element. The
 * prefixes follow the order in which the tree needs them, so one tree
 * serializes to the same octets here too.
 */
export class XmlOutput {
	private readonly doc: XmlDocument;
	private readonly prefixes = new Map<string, string>(PREFIX_BY_NAMESPACE);
	readonly root: XmlElement;

	constructor(namespace: string, local: string) {
		const prefix = this.prefixes.get(namespace) ?? mintedPrefix(0);
		this.prefixes.set(namespace, prefix);
		const doc = new DOMParser().parseFromString(
			`<${prefix}:${local} xmlns:${prefix}="${namespace}"/>`,
			'text/xml',
		);
		const root = doc.documentElement;
		if (!root) {
			throw new Error(`mock server could not build <${local}>`);
		}
		this.doc = doc;
		this.root = root;
		for (const [ns, other] of this.prefixes) {
			if (other !== prefix) {
				root.setAttributeNS(XMLNS_NS, `xmlns:${other}`, ns);
			}
		}
	}

	child(
		parent: XmlElement,
		ns: string,
		local: string,
		text?: string,
	): XmlElement {
		const el =
			ns === ''
				? this.doc.createElementNS(null, local)
				: this.doc.createElementNS(
						ns,
						`${this.prefixFor(ns)}:${local}`,
					);
		if (text !== undefined) {
			el.appendChild(this.doc.createTextNode(text));
		}
		parent.appendChild(el);
		return el;
	}

	serialize(): string {
		return `<?xml version="1.0" encoding="utf-8" ?>\n${new XMLSerializer().serializeToString(
			this.root,
		)}`;
	}

	private prefixFor(namespace: string): string {
		const known = this.prefixes.get(namespace);
		if (known !== undefined) {
			return known;
		}
		const minted = mintedPrefix(this.prefixes.size);
		this.prefixes.set(namespace, minted);
		this.root.setAttributeNS(XMLNS_NS, `xmlns:${minted}`, namespace);
		return minted;
	}
}

function mintedPrefix(position: number): string {
	return `ns${String(position)}`;
}
