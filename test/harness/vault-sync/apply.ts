/**
 * How a delivery lands on a device.
 *
 * A delivery carries the version that its path had on the origin. The
 * destination compares that version against the version that the
 * destination holds for the same path. Three results are possible.
 *
 * First, the version of the delivery covers the version of the
 * destination. The destination then holds no change that the origin
 * missed, so the destination applies the change, however far behind the
 * destination is. A change that comes through a third device lands the
 * same way, in any order of arrival.
 *
 * Second, the version of the destination already covers the version of
 * the delivery. The delivery then brings nothing new, and the
 * destination writes nothing.
 *
 * Third, neither version covers the other version. The two devices then
 * made their edits with no knowledge of each other. The profile decides
 * what becomes of the side that does not take the path. The profile
 * discards that side, or moves that side aside into a conflict copy, or
 * merges that side into the other side. A merge uses the content that
 * the origin replaced as its base.
 *
 * The winner rule of the profile decides which of the two contents takes
 * the path. The rule reads the stamps that the two sides carry, and the
 * rule does not read which side is the local side. Both devices in a
 * divergence hold the same pair of stamps, so both devices pick the same
 * winner, and both devices hold the same bytes at the path. The losing
 * content goes into a conflict copy, and the copy carries the name of
 * the device that wrote that content. Both devices give the copy the
 * same name. A profile that makes no copies discards the losing content
 * instead.
 *
 * A profile that merges gets the two sides in that same fixed order.
 * That profile gets the winner as the side that arrives. Therefore every
 * device that merges one pair makes one file. The devices really
 * do converge through a conflict, and they do not swap contents. A
 * device that meets three or more concurrent edits ranks those edits in
 * the same order, in any order of arrival. One case is different: a copy
 * pattern that numbers its copies instead of naming them. Two devices
 * that meet the same collisions in a different order then give the
 * copies different numbers.
 *
 * Every divergence has an outcome, because each step falls back to the
 * next step. A profile that merges falls back to the conflict copy when
 * the merger makes no merge. A profile with no copy pattern falls back
 * to keeping the winner alone.
 *
 * A divergent deletion, and a divergent edit of a path that the
 * destination deleted, are one question from two sides. The profile
 * answers both the same way. Under `overwrite` the deletion wins. Under
 * every profile that copies or merges, the edit comes back: a tool that
 * makes copies has no reason to destroy the one edit that it would copy.
 * Both answers leave the destination with the knowledge that the origin
 * had. Therefore the two devices converge whichever delivery lands
 * first.
 *
 * The profile carries one more fact for each tool: does a conflict copy
 * reach the other devices? A device that sees both sides of a divergence
 * makes the copy itself. Therefore this fact decides only what a device
 * gets when that device never sees one of the two sides. A conflict copy
 * travels one time only. A landing writes the copy where the destination
 * has the path free, and drops the copy where the path is not free. Thus
 * a device never resolves a copy against a local edit, and a copy never
 * makes another copy.
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

/** Sends a conflict copy that a landing made, to the other devices. */
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
 * Lands a divergent edit of a path that the destination deleted. The
 * destination holds no local content to copy or to merge. A divergent
 * deletion asks the same question from the other side, so the profile
 * gives the same answer in both cases. Under `overwrite` the deletion
 * wins. Under every other profile the edit comes back.
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
 * Lands a conflict copy that travelled from another device. The function
 * writes the copy where the destination has the path free, and drops the
 * copy where the path is not free. Thus the copy resolves nothing, and
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
 * The first conflict-copy path that this device has free. The name comes
 * from the side that lost. A pattern with no `{counter}` gives one
 * candidate name only. On a collision the function adds a number to that
 * one name instead. The number starts at 2, which is also the number
 * that the first copy of a counted pattern carries.
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
		`vault-sync channel: there is no free conflict-copy path for ${path} on device ${device.id}; let the script make fewer conflict copies of this path`,
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

/**
 * Who wrote the content that a delivery carries, and when they wrote
 * that content.
 */
function deliveryStamp(delivery: Delivery): ContentStamp {
	return { author: delivery.from, at: delivery.modifiedAt };
}

/**
 * The stamp on the content that the destination holds. A file that a
 * suite planted in the vault carries no stamp. Such a file counts as the
 * content of this device. Its time is the time that the device recorded
 * for the file, or the time of the landing when the device recorded no
 * time.
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

/** Records that this device knows every change that the delivery knew. */
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
