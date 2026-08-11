/**
 * The sweeps every run starts with. Standing assertions accrete with the
 * behavior they police, so this set grows as the engine does; what is here
 * is what the harness can already answer on its own evidence.
 */

import {
	NETWORK_SURFACES,
	evidenceStrings,
	type RunEvidence,
} from './evidence';
import type { Sweep, SweepViolation } from './sweep';

/**
 * Network discipline as the run experienced it. The lint rules keep a
 * direct fetch out of the source; this keeps one out of the run, and
 * catches code that puts a working fetch back after the poison went in.
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
 * Credential material in anything the run produced. The run declares what
 * is sensitive and this looks for it everywhere, so a value that reaches
 * frontmatter, a record, a request line, a request body or header, a file
 * a sync channel carried to another device, or a log entry is found
 * wherever it landed — the walk crosses every surface the record holds,
 * so a surface added to the record is scanned without this being told. A
 * violation names the value's label and never the value: the report goes
 * to a terminal and a CI log like any other test failure.
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
 * Work the engine took on because it observed something remotely, rather
 * than because a user asked for it, talks to no server at all — not the
 * calendar server, not a feed, not anything a later surface adds, which is
 * why this walks the surface table rather than naming one. Nothing opens
 * such a stretch until the engine lands, so this passes on every run
 * today; it is registered anyway, because a registry that holds only the
 * assertions with a producer teaches suites to add the producer and the
 * assertion together, and the second half is the one that gets dropped.
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
