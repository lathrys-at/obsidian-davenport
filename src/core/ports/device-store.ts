/**
 * Device-local storage port: sync cursors, the dirty set, caches, UI
 * state. Nothing here travels between devices — cursors that travel
 * corrupt incremental sync. Everything stored must be regenerable from the
 * server plus the ledger, or its loss must degrade to a surfaced question
 * rather than a wrong write.
 */
export interface DeviceStore {
	/** Returns what was stored, or null. Callers validate the shape; a
	 * typed getter here would be an unchecked cast in disguise. */
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
}
