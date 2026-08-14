/**
 * The device store port keeps the data that belongs to one device only.
 * This data includes the sync cursors, the dirty set, the caches, and the
 * state of the user interface. A sync cursor records how far this device
 * read the changes of one calendar. The dirty set holds the paths of the
 * notes that this device saw the user change.
 *
 * No data from this store goes to another device. The sync cursors give
 * the reason. A cursor from another device points at the wrong place in
 * the changes of the calendar. A sync that reads only the changes after
 * that point then gives a wrong result.
 *
 * Each item in this store must obey one of two conditions. First, the
 * plugin can make the item again from the data of the server and from the
 * record files in the vault. Second, if the plugin loses the item, the
 * plugin asks the user a question, and the plugin does not write a wrong
 * value.
 */
export interface DeviceStore {
	/**
	 * Returns the value that the store holds for the key, or null when
	 * the store holds no value for the key. The type of the value is
	 * unknown, and the caller must check the shape of the value. A typed
	 * result here would hide a cast that nobody checks.
	 */
	get(key: string): Promise<unknown>;
	set(key: string, value: unknown): Promise<void>;
	delete(key: string): Promise<void>;
}
