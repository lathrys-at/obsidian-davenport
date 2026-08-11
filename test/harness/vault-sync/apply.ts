/**
 * Landing a delivery on a device.
 *
 * A delivery carries the version its path had on the origin, and the
 * destination compares it against the version it holds for that path. A
 * delivery whose version covers the destination's applies: the
 * destination has seen nothing the origin missed, so it fast-forwards
 * however far behind it is, and a change relayed through a third device
 * lands the same way whatever order the deliveries arrive in. A delivery
 * the destination's version already covers is old news and nothing is
 * written. Only when neither version covers the other were the two edits
 * made without knowledge of each other, and then the profile decides what
 * becomes of the side that does not take the path: discarded, moved aside
 * into a conflict copy, or merged into the other, with the content the
 * origin replaced as the merge base.
 *
 * Which of the two contents takes the path is the profile's winner rule,
 * read from the stamps the two sides carry rather than from which one
 * happens to be local. Both devices in a divergence hold the same pair of
 * stamps, so they pick the same winner and end up agreeing on the path's
 * bytes; the loser goes to a conflict copy named after the device that
 * wrote it, which both devices also name alike, or is discarded where the
 * profile makes no copies. A merging profile is handed the two sides in
 * that same fixed order — the winner as the arriving side — so every
 * device merging one pair produces one file. Convergence through a
 * conflict is therefore real rather than a swap of contents, and a device
 * meeting three or more concurrent edits ranks them the same however they
 * arrive — except where a copy pattern numbers its copies rather than
 * naming them, since two devices meeting the same collisions in different
 * orders number them differently.
 *
 * A merge that declines falls back to the conflict copy, and a profile
 * with no copy pattern falls back to keeping the winner alone, so every
 * divergence has an outcome. A divergent deletion and a divergent edit of
 * a path the destination deleted are the same question asked from two
 * sides, and the profile answers both alike: under overwrite the deletion
 * wins, and under any profile that copies or merges the edit survives — a
 * tool that makes copies has no reason to destroy the one edit it would
 * be copying. Resolving either way leaves the destination knowing what
 * the origin knew, so the two devices converge whichever delivery lands
 * first.
 *
 * Whether a conflict copy reaches the other devices is a per-tool fact
 * the profile carries. It decides what a device that never sees one side
 * of a divergence ends up with, since one that sees both makes the copy
 * itself. A copy that travels is terminal by construction: landing one
 * writes the file where the destination has the path free and drops it
 * where it does not, so a copy is never resolved against a local edit and
 * can never produce another copy.
 */

import type { ControlledClock } from '../clock';
import type { SyncDevice } from './device';
import type { MergeMangler } from './mangle';
import {
	incomingWins,
	renderConflictPath,
	type SyncToolProfile,
} from './profiles';
import type {
	CapturedChange,
	ContentStamp,
	Delivery,
	DeliveryChange,
	DeliveryOutcome,
	LandedDelivery,
} from './types';
import {
	bumpVersion,
	covers,
	mergeVersions,
	type PathVersion,
} from './version';

type RenameChange = Extract<DeliveryChange, { kind: 'rename' }>;

/** Sends a conflict copy a landing made on to the destination's peers. */
export type PropagateCopy = (copy: CapturedChange) => void;

export interface ApplyContext {
	readonly device: SyncDevice;
	readonly profile: SyncToolProfile;
	readonly merger: MergeMangler;
	readonly clock: ControlledClock;
	readonly propagate: PropagateCopy;
}

const MAX_CONFLICT_COPIES = 99;

export async function applyDelivery(
	context: ApplyContext,
	delivery: Delivery,
): Promise<LandedDelivery> {
	const { change } = delivery;
	switch (change.kind) {
		case 'upsert':
			return delivery.conflictCopy
				? applyConflictCopy(
						context,
						delivery,
						change.path,
						change.content,
					)
				: applyUpsert(
						context,
						delivery,
						change.path,
						change.content,
						delivery.previousContent,
					);
		case 'delete':
			return applyDelete(context, delivery, change.path);
		case 'rename':
			return applyRename(context, delivery, change);
	}
}

async function applyUpsert(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
	content: string,
	base: string | null,
): Promise<LandedDelivery> {
	const { device } = context;
	const current = await contentOrNull(device, path);
	const local = device.versionOf(path);
	const at = landingTime(context, delivery);
	if (current === content) {
		noteSeen(device, path, delivery.version);
		return landed(
			delivery,
			'converged',
			null,
			device.modifiedAt(path) ?? at,
		);
	}
	if (covers(delivery.version, local)) {
		await device.vault.write(path, content);
		device.noteModified(path, at);
		device.noteStamp(path, deliveryStamp(delivery));
		noteSeen(device, path, delivery.version);
		return landed(
			delivery,
			current === null ? 'created' : 'updated',
			null,
			at,
		);
	}
	if (covers(local, delivery.version)) {
		return landed(delivery, 'superseded', null, device.modifiedAt(path));
	}
	if (current === null) {
		return resolveAbsent(context, delivery, path, content, at);
	}
	return resolveDivergence(
		context,
		delivery,
		path,
		content,
		base,
		current,
		at,
	);
}

/**
 * A divergent edit of a path the destination deleted. There is no local
 * content to copy or merge, so the profile's answer is the one it gives a
 * divergent deletion read from the other side: the deletion wins under
 * overwrite, and the edit comes back under anything else.
 */
async function resolveAbsent(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
	content: string,
	at: number,
): Promise<LandedDelivery> {
	const { device, profile } = context;
	if (profile.divergentDelivery === 'overwrite') {
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'kept-local', null, null);
	}
	await device.vault.write(path, content);
	device.noteModified(path, at);
	device.noteStamp(path, deliveryStamp(delivery));
	noteSeen(device, path, delivery.version);
	return landed(delivery, 'resurrected', null, at);
}

async function resolveDivergence(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
	content: string,
	base: string | null,
	current: string,
	at: number,
): Promise<LandedDelivery> {
	const { device, profile, merger } = context;
	const incoming = deliveryStamp(delivery);
	const local = localStamp(device, path, at);
	const takesPath = incomingWins(profile.divergenceWinner, incoming, local);
	const loser = takesPath ? current : content;
	const loserStamp = takesPath ? local : incoming;
	if (profile.divergentDelivery === 'merge') {
		const merged = merger({
			path,
			base,
			local: loser,
			incoming: takesPath ? content : current,
		});
		if (merged !== null) {
			await device.vault.write(path, merged);
			device.noteModified(path, at);
			device.noteStamp(path, takesPath ? incoming : local);
			noteSeen(device, path, delivery.version);
			return landed(delivery, 'merged', null, at);
		}
	}
	if (
		profile.divergentDelivery === 'overwrite' ||
		profile.conflictCopyPattern === null
	) {
		if (!takesPath) {
			noteSeen(device, path, delivery.version);
			return landed(
				delivery,
				'kept-local',
				null,
				device.modifiedAt(path),
			);
		}
		await device.vault.write(path, content);
		device.noteModified(path, at);
		device.noteStamp(path, incoming);
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'overwritten', null, at);
	}
	const copyPath = freeConflictPath(
		device,
		profile.conflictCopyPattern,
		path,
		loserStamp,
	);
	const copyVersion = bumpVersion(device.versionOf(copyPath), device.id);
	await device.vault.write(copyPath, loser);
	device.noteModified(copyPath, loserStamp.at);
	device.noteVersion(copyPath, copyVersion);
	device.noteStamp(copyPath, loserStamp);
	if (takesPath) {
		await device.vault.write(path, content);
		device.noteModified(path, at);
		device.noteStamp(path, incoming);
	}
	noteSeen(device, path, delivery.version);
	if (profile.propagateConflictCopies) {
		context.propagate({
			change: { kind: 'upsert', path: copyPath, content: loser },
			previousContent: null,
			version: copyVersion,
			modifiedAt: loserStamp.at,
		});
	}
	return landed(
		delivery,
		'conflict-copy',
		copyPath,
		takesPath ? at : device.modifiedAt(path),
	);
}

/**
 * A conflict copy that travelled. It is written where the destination has
 * the path free and dropped where it does not, so it resolves nothing and
 * makes no copy of its own.
 */
async function applyConflictCopy(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
	content: string,
): Promise<LandedDelivery> {
	const { device } = context;
	const current = await contentOrNull(device, path);
	const at = landingTime(context, delivery);
	if (current === content) {
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'converged', null, device.modifiedAt(path));
	}
	if (current !== null) {
		return landed(delivery, 'kept-local', null, device.modifiedAt(path));
	}
	await device.vault.write(path, content);
	device.noteModified(path, at);
	device.noteStamp(path, deliveryStamp(delivery));
	noteSeen(device, path, delivery.version);
	return landed(delivery, 'created', null, at);
}

async function applyDelete(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
): Promise<LandedDelivery> {
	const { device, profile } = context;
	const current = await contentOrNull(device, path);
	const local = device.versionOf(path);
	if (current === null) {
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'converged', null, null);
	}
	if (covers(delivery.version, local)) {
		await device.vault.trash(path);
		device.forgetModified(path);
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'deleted', null, null);
	}
	if (covers(local, delivery.version)) {
		return landed(delivery, 'superseded', null, device.modifiedAt(path));
	}
	if (profile.divergentDelivery === 'overwrite') {
		await device.vault.trash(path);
		device.forgetModified(path);
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'overwritten', null, null);
	}
	noteSeen(device, path, delivery.version);
	return landed(delivery, 'kept-local', null, device.modifiedAt(path));
}

async function applyRename(
	context: ApplyContext,
	delivery: Delivery,
	change: RenameChange,
): Promise<LandedDelivery> {
	const { device, profile } = context;
	const { path, oldPath, content } = change;
	const settled = covers(delivery.version, device.versionOf(oldPath));
	if (
		profile.renameDelivery === 'rename' &&
		settled &&
		device.holds(oldPath) &&
		!device.holds(path)
	) {
		const at = landingTime(context, delivery);
		await device.vault.rename(oldPath, path);
		device.forgetModified(oldPath);
		noteSeen(device, oldPath, delivery.version);
		device.noteModified(path, at);
		device.noteStamp(path, deliveryStamp(delivery));
		noteSeen(device, path, delivery.version);
		return landed(delivery, 'renamed', null, at);
	}
	if (settled) {
		if (device.holds(oldPath)) {
			await device.vault.trash(oldPath);
			device.forgetModified(oldPath);
		}
		noteSeen(device, oldPath, delivery.version);
	}
	const kept = !settled && device.holds(oldPath);
	const result = await applyUpsert(context, delivery, path, content, null);
	if (
		kept &&
		(result.outcome === 'created' || result.outcome === 'updated')
	) {
		return { ...result, outcome: 'duplicated' };
	}
	return result;
}

/**
 * The first conflict-copy path this device has free, named after the side
 * that lost. Patterns carrying no counter render one candidate, so a
 * collision numbers the name instead, from two, the same number a counted
 * pattern's second copy carries.
 */
function freeConflictPath(
	device: SyncDevice,
	pattern: string,
	path: string,
	loser: ContentStamp,
): string {
	const render = (counter: number): string =>
		renderConflictPath(pattern, {
			path,
			device: loser.author,
			at: loser.at,
			counter,
		});
	const first = render(2);
	if (!device.holds(first)) {
		return first;
	}
	const counted = pattern.includes('{counter}');
	for (
		let counter = counted ? 3 : 2;
		counter <= MAX_CONFLICT_COPIES;
		counter += 1
	) {
		const candidate = counted ? render(counter) : numbered(first, counter);
		if (!device.holds(candidate)) {
			return candidate;
		}
	}
	throw new Error(
		`vault-sync channel: no free conflict-copy path for ${path} on ${device.id}`,
	);
}

function numbered(path: string, counter: number): string {
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');
	if (dot <= slash + 1) {
		return `${path} ${String(counter)}`;
	}
	return `${path.slice(0, dot)} ${String(counter)}${path.slice(dot)}`;
}

/** Who wrote the content a delivery carries, and when they wrote it. */
function deliveryStamp(delivery: Delivery): ContentStamp {
	return { author: delivery.from, at: delivery.modifiedAt };
}

/**
 * The stamp on the content the destination holds. A file planted straight
 * into the vault carries none, so it counts as this device's own, written
 * at whatever time the device has recorded for it or at the landing
 * instant.
 */
function localStamp(
	device: SyncDevice,
	path: string,
	at: number,
): ContentStamp {
	return (
		device.stampOf(path) ?? {
			author: device.id,
			at: device.modifiedAt(path) ?? at,
		}
	);
}

/** Records that this device has now seen everything the delivery had. */
function noteSeen(
	device: SyncDevice,
	path: string,
	version: PathVersion,
): void {
	device.noteVersion(path, mergeVersions(device.versionOf(path), version));
}

function landingTime(context: ApplyContext, delivery: Delivery): number {
	return delivery.preserveModifiedAt
		? delivery.modifiedAt
		: context.clock.now();
}

async function contentOrNull(
	device: SyncDevice,
	path: string,
): Promise<string | null> {
	return device.holds(path) ? await device.vault.read(path) : null;
}

function landed(
	delivery: Delivery,
	outcome: DeliveryOutcome,
	conflictPath: string | null,
	modifiedAt: number | null,
): LandedDelivery {
	return { delivery, outcome, conflictPath, modifiedAt };
}
