/**
 * The vault-sync channel simulates two or more devices. The devices
 * exchange file changes, and the test writes the script that moves those
 * changes.
 *
 * Nothing moves on its own. A change on one device becomes a delivery to
 * each other device. Each delivery waits until the test delivers it.
 * Thus the script sets the order. A script can do these things:
 *
 * - hold one path and deliver the other paths;
 * - deliver two paths in a stated order;
 * - deliver to one device and leave another device behind.
 *
 * Latency is the clock time that a test lets pass between the change and
 * the delivery of that change. The modification times that the channel
 * records hold that difference.
 *
 * Every delivery carries the version of the path that the delivery
 * changes. Therefore a device that is only behind catches up in any
 * order of arrival. Two edits become a conflict only when neither device
 * knew about the edit of the other device.
 *
 * A second run of the same script gives the same result. Every device
 * holds the same bytes, and the same deliveries land in the same way.
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
	/**
	 * The ids of the devices. When a change goes out to the other
	 * devices, the channel makes the deliveries in this order.
	 */
	readonly devices: readonly DeviceId[];
	readonly clock: ControlledClock;
	readonly profile?: SyncToolProfile;
	/**
	 * The merger for a profile that merges. This merger replaces the
	 * merger of the profile. If you omit this merger, the channel uses
	 * the merger of the profile. If the profile carries no merger, the
	 * channel uses the modeled line merge.
	 */
	readonly merger?: MergeMangler;
	/** The files that every device starts with. A seed delivers nothing. */
	readonly seed?: Readonly<Record<string, string>>;
}

/**
 * Releases a hold. A second call and each later call do nothing more.
 */
export type ReleaseHold = () => void;

/**
 * The two files of a flight-skew script. Flight skew is the delay
 * between the arrival of a record and the arrival of the note of that
 * record. The script states which of the two files arrives first.
 */
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
			throw new Error(
				'vault-sync channel: the channel needs at least two devices',
			);
		}
		this.clock = options.clock;
		this.profile = options.profile ?? DEFAULT_SYNC_PROFILE;
		this.merger =
			options.merger ?? this.profile.merger ?? lineMergeMangler();
		for (const id of options.devices) {
			if (this.byId.has(id)) {
				throw new Error(
					`vault-sync channel: the options give a duplicate device ${id}; give each device a different id`,
				);
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

	/** Every delivery that landed, in the order in which it landed. */
	get log(): readonly LandedDelivery[] {
		return this.landed;
	}

	/**
	 * The device with this id. If the channel holds no device with this
	 * id, the method throws an error that names the ids that the channel
	 * holds.
	 */
	device(id: DeviceId): SyncDevice {
		const device = this.byId.get(id);
		if (device === undefined) {
			const known = [...this.byId.keys()].join(', ');
			throw new Error(
				`vault-sync channel: there is no device ${id}; the channel holds ${known}`,
			);
		}
		return device;
	}

	/**
	 * The deliveries that wait, held or not, in the order in which the
	 * channel captured them.
	 */
	pending(selector?: DeliverySelector): readonly Delivery[] {
		return this.queue.filter((delivery) => matches(delivery, selector));
	}

	/**
	 * Keeps the deliveries that match the selector out of every delivery
	 * call. The hold covers the deliveries that wait now, and also the
	 * deliveries that come later. The hold stays until the returned
	 * function releases these deliveries.
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
	 * Delivers each delivery that matches the selector and that no hold
	 * stops. The order is the order of capture. A landing makes no new
	 * delivery, with one exception: a profile that propagates its
	 * conflict copies makes a delivery for the conflict copy. The channel
	 * captures that copy after the deliveries that this call chose, and
	 * that copy stays pending.
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
	 * Delivers one selector at a time. Thus the order of arrival is the
	 * order of the selectors, and not the order of capture.
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

	/** The record arrives first. The note of that record arrives second. */
	recordBeforeNote(skew: FlightSkew): Promise<LandedDelivery[]> {
		return this.deliverPathsInOrder([skew.record, skew.note], skew.to);
	}

	/** The note arrives first. The record of that note arrives second. */
	noteBeforeRecord(skew: FlightSkew): Promise<LandedDelivery[]> {
		return this.deliverPathsInOrder([skew.note, skew.record], skew.to);
	}

	/**
	 * True when every device holds the same bytes.
	 *
	 * The devices reach that state after a conflict too. The winner rule
	 * of the profile reads the same way on both sides. Therefore each
	 * device that resolves one conflict keeps the same content at the
	 * path, and writes the same losing content to a copy with the same
	 * name. This holds whether or not the profile propagates its copies.
	 *
	 * The result stays false in two conditions:
	 *
	 * - The channel delivered only one side of a conflict. The device
	 *   that did not see the other side made no copy yet.
	 * - The copy pattern gives the copies numbers and not names, and two
	 *   devices met the same collisions in a different order. Those two
	 *   devices then give the same content a different number.
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
					`vault-sync channel: the channel has nothing pending for ${path}`,
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
