/**
 * The failure that one step of the CalDAV conversation gives.
 *
 * The CalDAV library states a failure in words of its own, and those words
 * can carry the body that the server sent. A server writes what it wants
 * in that body: a page of HTML, the name of a user, the name of a
 * calendar. The log of this plugin holds only words that the plugin wrote,
 * and the screen of this plugin states each condition in words of its own.
 * The protocol layer therefore lets no word of the library and no word of
 * a server out of itself.
 *
 * A failure of a step carries the name of that step, and it carries
 * nothing else. A caller that must state more to the user reads the status
 * of the answer, which the layer reports beside the outcome.
 */

/** One step of the CalDAV conversation that failed. */
export class CalDavError extends Error {
	/** The name of the step, in the words of this plugin. */
	readonly step: string;

	constructor(step: string) {
		super(`the ${step} step with the calendar server failed`);
		this.name = 'CalDavError';
		this.step = step;
	}
}
