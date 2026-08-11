/**
 * Device-local storage port (§3.3): sync cursors, the dirty set, caches,
 * UI state. Nothing here travels between devices — cursors that travel
 * corrupt incremental sync. Everything stored must be regenerable from the
 * server plus the ledger, or its loss must degrade to a surfaced question
 * rather than a wrong write.
 */
export interface DeviceStore {
	get<T>(key: string): Promise<T | null>;
	set<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<void>;
}
