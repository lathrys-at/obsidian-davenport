/**
 * The vault-sync channel: N simulated devices exchanging file changes
 * under a script the test writes.
 *
 * Nothing moves on its own. A change made on one device becomes a pending
 * delivery to every peer and stays pending until the test delivers it, so
 * order is whatever the script says: hold one path and deliver the rest,
 * deliver two paths in a stated order, deliver to one peer and leave
 * another behind. Latency is the clock time a test lets pass between
 * making a change and delivering it; the modification times the channel
 * records carry that skew.
 *
 * Every delivery carries the version of the path it changes, so a device
 * that is merely behind catches up whichever order the deliveries reach
 * it in, and only edits made without knowledge of each other come out as
 * conflicts.
 *
 * The same script run twice leaves every device holding the same bytes,
 * with the same deliveries landing the same way.
 */

import type { ControlledClock } from '../clock';
import { applyDelivery, type ApplyContext } from './apply';
import { SyncDevice } from './device';
import { lineMergeMangler, type MergeMangler } from './mangle';
import { DEFAULT_SYNC_PROFILE, type SyncToolProfile } from './profiles';
import type {
	CapturedChange,
	Delivery,
	DeliveryChange,
	DeliverySelector,
	DeviceId,
	LandedDelivery,
} from './types';

export interface VaultSyncChannelOptions {
	/** Device ids, in the order fan-out enqueues to them. */
	readonly devices: readonly DeviceId[];
	readonly clock: ControlledClock;
	readonly profile?: SyncToolProfile;
	/**
	 * Merger for profiles that merge, overriding the profile's own. The
	 * profile's merger stands in where this is omitted, and the modeled
	 * line merge where the profile carries none.
	 */
	readonly merger?: MergeMangler;
	/** Files every device starts with. Seeding delivers nothing. */
	readonly seed?: Readonly<Record<string, string>>;
}

/** Releases a hold; calling it more than once does nothing further. */
export type ReleaseHold = () => void;

/** The two files whose arrival order is the flight-skew script. */
export interface FlightSkew {
	readonly record: string;
	readonly note: string;
	readonly to?: DeviceId | readonly DeviceId[];
}

export class VaultSyncChannel {
	private readonly order: SyncDevice[] = [];
	private readonly byId = new Map<DeviceId, SyncDevice>();
	private readonly queue: Delivery[] = [];
	private readonly holds = new Set<DeliverySelector>();
	private readonly landed: LandedDelivery[] = [];
	private readonly clock: ControlledClock;
	private readonly profile: SyncToolProfile;
	private readonly merger: MergeMangler;
	private nextId = 1;

	constructor(options: VaultSyncChannelOptions) {
		if (options.devices.length < 2) {
			throw new Error('vault-sync channel: needs at least two devices');
		}
		this.clock = options.clock;
		this.profile = options.profile ?? DEFAULT_SYNC_PROFILE;
		this.merger =
			options.merger ?? this.profile.merger ?? lineMergeMangler();
		for (const id of options.devices) {
			if (this.byId.has(id)) {
				throw new Error(`vault-sync channel: duplicate device ${id}`);
			}
			const device = new SyncDevice(
				id,
				this.clock,
				(change) => {
					this.enqueue(id, change);
				},
				options.seed ?? {},
			);
			this.order.push(device);
			this.byId.set(id, device);
		}
	}

	get devices(): readonly SyncDevice[] {
		return this.order;
	}

	/** Every delivery that has landed, in the order it landed. */
	get log(): readonly LandedDelivery[] {
		return this.landed;
	}

	/** The device with this id, or an error naming the ids there are. */
	device(id: DeviceId): SyncDevice {
		const device = this.byId.get(id);
		if (device === undefined) {
			const known = [...this.byId.keys()].join(', ');
			throw new Error(
				`vault-sync channel: no device ${id}; channel holds ${known}`,
			);
		}
		return device;
	}

	/** Deliveries waiting, held or not, in the order they were captured. */
	pending(selector?: DeliverySelector): readonly Delivery[] {
		return this.queue.filter((delivery) => matches(delivery, selector));
	}

	/**
	 * Keeps matching deliveries — pending and later — out of every
	 * delivery call until the returned function releases them.
	 */
	hold(selector: DeliverySelector): ReleaseHold {
		const rule: DeliverySelector = { ...selector };
		this.holds.add(rule);
		return () => {
			this.holds.delete(rule);
		};
	}

	/** Releases every hold at once. */
	releaseAll(): void {
		this.holds.clear();
	}

	/**
	 * Delivers matching unheld deliveries in the order they were captured.
	 * A landing originates nothing, save for a conflict copy under a
	 * profile that propagates them: that one is captured behind the
	 * deliveries this call chose and stays pending.
	 */
	async deliver(selector?: DeliverySelector): Promise<LandedDelivery[]> {
		const chosen = this.queue.filter(
			(delivery) => matches(delivery, selector) && !this.isHeld(delivery),
		);
		const results: LandedDelivery[] = [];
		for (const delivery of chosen) {
			this.take(delivery);
			const result = await applyDelivery(
				this.contextFor(delivery),
				delivery,
			);
			this.landed.push(result);
			results.push(result);
		}
		return results;
	}

	/**
	 * Delivers one selector at a time, so the arrival order is the order
	 * the selectors are written in rather than the order of capture.
	 */
	async deliverInOrder(
		selectors: readonly DeliverySelector[],
	): Promise<LandedDelivery[]> {
		const results: LandedDelivery[] = [];
		for (const selector of selectors) {
			results.push(...(await this.deliver(selector)));
		}
		return results;
	}

	/** The record arrives first and its note follows. */
	recordBeforeNote(skew: FlightSkew): Promise<LandedDelivery[]> {
		return this.deliverPathsInOrder([skew.record, skew.note], skew.to);
	}

	/** The note arrives first and its record follows. */
	noteBeforeRecord(skew: FlightSkew): Promise<LandedDelivery[]> {
		return this.deliverPathsInOrder([skew.note, skew.record], skew.to);
	}

	/**
	 * Whether every device holds the same bytes. A conflict copy that
	 * stays where it was made leaves the devices holding different files,
	 * so under a profile that does not propagate its copies this stays
	 * false once any divergence has been resolved by copying.
	 */
	converged(): boolean {
		const first = this.order[0]?.snapshot();
		return this.order.every((device) => device.snapshot() === first);
	}

	private async deliverPathsInOrder(
		paths: readonly string[],
		to: DeviceId | readonly DeviceId[] | undefined,
	): Promise<LandedDelivery[]> {
		const results: LandedDelivery[] = [];
		for (const path of paths) {
			const selector: DeliverySelector =
				to === undefined ? { path } : { path, to };
			const landed = await this.deliver(selector);
			if (landed.length === 0) {
				throw new Error(
					`vault-sync channel: nothing pending for ${path}`,
				);
			}
			results.push(...landed);
		}
		return results;
	}

	private enqueue(
		from: DeviceId,
		captured: CapturedChange,
		conflictCopy = false,
	): void {
		for (const peer of this.order) {
			if (peer.id === from) {
				continue;
			}
			this.queue.push({
				id: this.nextId++,
				from,
				to: peer.id,
				change: captured.change,
				previousContent: captured.previousContent,
				version: captured.version,
				modifiedAt: captured.modifiedAt,
				preserveModifiedAt: this.profile.preserveModificationTimes,
				conflictCopy,
			});
		}
	}

	private take(delivery: Delivery): void {
		const index = this.queue.indexOf(delivery);
		if (index !== -1) {
			this.queue.splice(index, 1);
		}
	}

	private isHeld(delivery: Delivery): boolean {
		for (const rule of this.holds) {
			if (matches(delivery, rule)) {
				return true;
			}
		}
		return false;
	}

	private contextFor(delivery: Delivery): ApplyContext {
		const device = this.device(delivery.to);
		return {
			device,
			profile: this.profile,
			merger: this.merger,
			clock: this.clock,
			propagate: (copy) => {
				this.enqueue(device.id, copy, true);
			},
		};
	}
}

function matches(
	delivery: Delivery,
	selector: DeliverySelector | undefined,
): boolean {
	if (selector === undefined) {
		return true;
	}
	return (
		includes(selector.from, delivery.from) &&
		includes(selector.to, delivery.to) &&
		touchesPath(selector.path, delivery.change)
	);
}

function includes(
	wanted: string | readonly string[] | undefined,
	actual: string,
): boolean {
	if (wanted === undefined) {
		return true;
	}
	return typeof wanted === 'string'
		? wanted === actual
		: wanted.includes(actual);
}

function touchesPath(
	wanted: string | readonly string[] | undefined,
	change: DeliveryChange,
): boolean {
	if (wanted === undefined) {
		return true;
	}
	const touched =
		change.kind === 'rename'
			? [change.path, change.oldPath]
			: [change.path];
	return touched.some((path) => includes(wanted, path));
}
