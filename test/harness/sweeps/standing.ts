/**
 * The sweeps that every run starts with. A standing assertion arrives with
 * the behavior that it guards, so this set grows as the engine grows. The
 * sweeps here are the ones that the harness can already answer from its
 * own evidence.
 */

import {
	NETWORK_SURFACES,
	evidenceStrings,
	type RunEvidence,
} from './evidence';
import type { Sweep, SweepViolation } from './sweep';

/**
 * Checks the network discipline of the run. The harness replaces the
 * global fetch with a function that throws, and that replacement is the
 * poison. The lint rules keep a direct call to fetch out of the source,
 * and this sweep keeps such a call out of the run. The sweep checks that
 * the poison stayed in place for the whole run, and it reports every call
 * that the poison refused. The sweep also catches code that put a working
 * fetch back after the harness installed the poison.
 */
const fetchPoisonActive: Sweep = {
	name: 'fetch-poison-active',
	check(evidence: RunEvidence): readonly SweepViolation[] {
		const violations: SweepViolation[] = [];
		if (!evidence.network.poisoned) {
			violations.push({
				where: 'network.poisoned',
				detail: 'global fetch was reachable during the run',
			});
		}
		evidence.network.attempts.forEach((attempt, index) => {
			violations.push({
				where: `network.attempts[${String(index)}]`,
				detail: `${attempt.spelling}.fetch was called for ${attempt.target}`,
			});
		});
		return violations;
	},
};

/**
 * Looks for credential material in everything that the run produced. The
 * run declares which values are sensitive, and this sweep looks for each
 * of those values everywhere. The sweep finds a value that reached any of
 * these places:
 *
 * - frontmatter;
 * - a record;
 * - a request line;
 * - a request body or a request header;
 * - a file that a sync channel carried to another device;
 * - a log entry.
 *
 * The walk crosses every surface that the evidence record holds. Thus the
 * sweep scans a surface that is added to the record, and nobody needs to
 * tell the sweep about that surface. A violation names the label of the
 * value and never the value itself, because the report goes to a terminal
 * and to a CI log like any other test failure.
 */
const secretsScan: Sweep = {
	name: 'secrets-scan',
	check(evidence: RunEvidence): readonly SweepViolation[] {
		if (evidence.secrets.length === 0) {
			return [];
		}
		const violations: SweepViolation[] = [];
		for (const found of evidenceStrings(evidence)) {
			for (const secret of evidence.secrets) {
				if (found.text.includes(secret.value)) {
					violations.push({
						where: found.where,
						detail: `carries the value registered as ${JSON.stringify(secret.label)}`,
					});
				}
			}
		}
		return violations;
	},
};

/**
 * Sometimes the engine does work because it observed something remotely,
 * and not because a user asked for the work. During that work the engine
 * must speak to no server at all. The engine must not speak to any of
 * these:
 *
 * - the calendar server;
 * - a feed;
 * - a server that a later surface adds.
 *
 * This sweep therefore walks the surface table, and it does not name one
 * surface.
 *
 * No code opens such a stretch of a run until the engine lands, so this
 * sweep passes on every run today. The registry holds the sweep anyway. A
 * registry that holds only the assertions that have a producer teaches
 * suites to add the producer and the assertion in one step, and the
 * assertion is the half that suites drop.
 */
const remoteObservedNoServerRequests: Sweep = {
	name: 'remote-observed-no-server-requests',
	check(evidence: RunEvidence): readonly SweepViolation[] {
		const violations: SweepViolation[] = [];
		for (const window of evidence.remoteObserved) {
			for (const surface of NETWORK_SURFACES) {
				const requests = surface.requests(evidence);
				const to = Math.min(window.to[surface.key], requests.length);
				for (
					let index = window.from[surface.key];
					index < to;
					index++
				) {
					const request = requests[index];
					if (request) {
						violations.push({
							where: request.where,
							detail: `${request.detail} was issued while processing ${window.label}`,
						});
					}
				}
			}
		}
		return violations;
	},
};

export const STANDING_SWEEPS: readonly Sweep[] = [
	fetchPoisonActive,
	secretsScan,
	remoteObservedNoServerRequests,
];
