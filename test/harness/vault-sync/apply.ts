/**
 * Landing a delivery on a device.
 *
 * A delivery applies cleanly when the destination holds exactly the
 * content the origin replaced — it has seen everything the origin saw — or
 * when it already holds what the delivery carries. Anything else is a
 * local edit made without knowledge of this change, and the profile
 * decides: overwrite it, move it aside into a conflict copy, or merge.
 *
 * A merge that declines falls back to the conflict copy, and a profile
 * with no copy pattern falls back to overwriting, so every divergence has
 * an outcome. A divergent delete keeps the local file except under
 * overwrite, since a tool that makes copies has no reason to destroy the
 * one edit it would be copying.
 *
 * A conflict copy stays on the device that made it. Real tools do
 * propagate their copies, but a copy that travels meets the copy the peer
 * made of the same file and breeds another, so the simulator stops at the
 * first one: the copy is on a device, which is what a vault has to cope
 * with, and the count stays scriptable.
 */

import type { ControlledClock } from '../clock';
import type { SyncDevice } from './device';
import type { MergeMangler } from './mangle';
import { renderConflictPath, type SyncToolProfile } from './profiles';
import type {
	Delivery,
	DeliveryChange,
	DeliveryOutcome,
	LandedDelivery,
} from './types';

type RenameChange = Extract<DeliveryChange, { kind: 'rename' }>;

export interface ApplyContext {
	readonly device: SyncDevice;
	readonly profile: SyncToolProfile;
	readonly merger: MergeMangler;
	readonly clock: ControlledClock;
}

const MAX_CONFLICT_COPIES = 99;

export async function applyDelivery(
	context: ApplyContext,
	delivery: Delivery,
): Promise<LandedDelivery> {
	const { change } = delivery;
	switch (change.kind) {
		case 'upsert':
			return applyUpsert(
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
	const at = landingTime(context, delivery);
	if (current === content) {
		return landed(
			delivery,
			'converged',
			null,
			device.modifiedAt(path) ?? at,
		);
	}
	if (current === base) {
		await device.vault.write(path, content);
		device.noteModified(path, at);
		return landed(
			delivery,
			current === null ? 'created' : 'updated',
			null,
			at,
		);
	}
	if (current === null) {
		await device.vault.write(path, content);
		device.noteModified(path, at);
		return landed(delivery, 'overwritten', null, at);
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
	if (profile.divergentDelivery === 'merge') {
		const merged = merger({
			path,
			base,
			local: current,
			incoming: content,
		});
		if (merged !== null) {
			await device.vault.write(path, merged);
			device.noteModified(path, at);
			return landed(delivery, 'merged', null, at);
		}
	}
	if (
		profile.divergentDelivery === 'overwrite' ||
		profile.conflictCopyPattern === null
	) {
		await device.vault.write(path, content);
		device.noteModified(path, at);
		return landed(delivery, 'overwritten', null, at);
	}
	const copyPath = freeConflictPath(
		device,
		profile.conflictCopyPattern,
		path,
		at,
	);
	const copiedAt = device.modifiedAt(path) ?? at;
	await device.vault.write(copyPath, current);
	device.noteModified(copyPath, copiedAt);
	await device.vault.write(path, content);
	device.noteModified(path, at);
	return landed(delivery, 'conflict-copy', copyPath, at);
}

async function applyDelete(
	context: ApplyContext,
	delivery: Delivery,
	path: string,
): Promise<LandedDelivery> {
	const { device, profile } = context;
	const current = await contentOrNull(device, path);
	const at = landingTime(context, delivery);
	if (current === null) {
		return landed(delivery, 'converged', null, at);
	}
	if (current === delivery.previousContent) {
		await device.vault.trash(path);
		device.forgetModified(path);
		return landed(delivery, 'deleted', null, at);
	}
	if (profile.divergentDelivery === 'overwrite') {
		await device.vault.trash(path);
		device.forgetModified(path);
		return landed(delivery, 'overwritten', null, at);
	}
	return landed(delivery, 'kept-local', null, device.modifiedAt(path) ?? at);
}

async function applyRename(
	context: ApplyContext,
	delivery: Delivery,
	change: RenameChange,
): Promise<LandedDelivery> {
	const { device, profile } = context;
	const { path, oldPath, content } = change;
	const oldContent = await contentOrNull(device, oldPath);
	const oldMatches =
		oldContent !== null && oldContent === delivery.previousContent;
	if (
		profile.renameDelivery === 'rename' &&
		oldMatches &&
		!device.holds(path)
	) {
		const at = landingTime(context, delivery);
		await device.vault.rename(oldPath, path);
		device.forgetModified(oldPath);
		device.noteModified(path, at);
		return landed(delivery, 'renamed', null, at);
	}
	if (oldMatches) {
		await device.vault.trash(oldPath);
		device.forgetModified(oldPath);
	}
	return applyUpsert(context, delivery, path, content, null);
}

/**
 * The first conflict-copy path this device has free. Patterns carrying no
 * counter render one candidate, so a collision numbers the name instead.
 */
function freeConflictPath(
	device: SyncDevice,
	pattern: string,
	path: string,
	at: number,
): string {
	const render = (counter: number): string =>
		renderConflictPath(pattern, { path, device: device.id, at, counter });
	const first = render(2);
	if (!device.holds(first)) {
		return first;
	}
	const counted = pattern.includes('{counter}');
	for (let counter = 3; counter <= MAX_CONFLICT_COPIES; counter += 1) {
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
	modifiedAt: number,
): LandedDelivery {
	return { delivery, outcome, conflictPath, modifiedAt };
}
