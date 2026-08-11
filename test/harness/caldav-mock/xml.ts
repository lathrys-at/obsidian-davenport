/**
 * XML in and out for the mock CalDAV server, over a namespace-aware DOM.
 * WebDAV bodies arrive with whatever prefixes the client picked, and a
 * default namespace is legal everywhere, so every lookup here is by
 * namespace URI and local name. Responses are built as a tree and
 * serialized; the mock never assembles or matches XML as strings.
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

/** A namespace-qualified element name, the mock's unit of XML identity. */
export interface PropName {
	readonly ns: string;
	readonly local: string;
}

/** Null when the body is empty or not well-formed; callers answer 400. */
export function parseXml(text: string): XmlDocument | null {
	if (text.trim() === '') {
		return null;
	}
	try {
		const doc = new DOMParser().parseFromString(text, 'text/xml');
		return doc.documentElement ? doc : null;
	} catch {
		return null;
	}
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

/** Direct children only; descendant search would cross filter nesting. */
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

/** Descendants at any depth, for props and hrefs whose nesting varies. */
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
 * Builds a response document. All three namespaces are declared on the
 * root, as servers do, so nested elements carry no declarations of their
 * own and output stays byte-stable for a given tree.
 */
export class XmlOutput {
	private readonly doc: XmlDocument;
	readonly root: XmlElement;

	constructor(namespace: string, local: string) {
		const prefix = prefixFor(namespace);
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
		for (const [ns, other] of PREFIX_BY_NAMESPACE) {
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
		const el = this.doc.createElementNS(ns, `${prefixFor(ns)}:${local}`);
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
}

function prefixFor(namespace: string): string {
	const prefix = PREFIX_BY_NAMESPACE.get(namespace);
	if (prefix === undefined) {
		throw new Error(`mock server has no prefix for ${namespace}`);
	}
	return prefix;
}
