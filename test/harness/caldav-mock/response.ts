/**
 * Response shapes the handlers share: the multistatus envelope, and the
 * precondition errors WebDAV and CalDAV name for a refusal, which is how a
 * client distinguishes "not supported" from "not found".
 */

import { DAV_NS, XmlOutput, type XmlElement } from './xml';

export interface MockResponse {
	readonly status: number;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: string;
}

const XML_CONTENT_TYPE = 'application/xml; charset=utf-8';

export function multistatus(
	build: (out: XmlOutput, root: XmlElement) => void,
): MockResponse {
	const out = new XmlOutput(DAV_NS, 'multistatus');
	build(out, out.root);
	return {
		status: 207,
		headers: { 'Content-Type': XML_CONTENT_TYPE },
		body: out.serialize(),
	};
}

/** A `<error>` body naming the precondition the request failed. */
export function preconditionError(
	status: number,
	ns: string,
	local: string,
	build?: (out: XmlOutput, condition: XmlElement) => void,
): MockResponse {
	const out = new XmlOutput(DAV_NS, 'error');
	const condition = out.child(out.root, ns, local);
	build?.(out, condition);
	return {
		status,
		headers: { 'Content-Type': XML_CONTENT_TYPE },
		body: out.serialize(),
	};
}

export function plain(
	status: number,
	headers: Readonly<Record<string, string>> = {},
	body = '',
): MockResponse {
	return { status, headers, body };
}

export function statusText(status: number): string {
	return `HTTP/1.1 ${String(status)} ${STATUS_REASONS[status] ?? 'Unknown'}`;
}

const STATUS_REASONS: Readonly<Record<number, string>> = {
	200: 'OK',
	201: 'Created',
	204: 'No Content',
	301: 'Moved Permanently',
	400: 'Bad Request',
	403: 'Forbidden',
	404: 'Not Found',
	405: 'Method Not Allowed',
	409: 'Conflict',
	412: 'Precondition Failed',
	500: 'Internal Server Error',
	503: 'Service Unavailable',
	507: 'Insufficient Storage',
};
