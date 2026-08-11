/**
 * Vault port: the engine's only view of note files and their metadata. The
 * deterministic test fake and the Obsidian adapter both implement it; core
 * code never imports platform APIs.
 */

/**
 * Creation is distinct from modification: file arrival matters in its own
 * right, because some sync tools deliver renames as delete-plus-create
 * pairs and a note can arrive before its record.
 */
export type VaultFileEvent =
	| { readonly kind: 'created'; readonly path: string }
	| { readonly kind: 'modified'; readonly path: string }
	| { readonly kind: 'renamed'; readonly path: string; readonly oldPath: string }
	| { readonly kind: 'deleted'; readonly path: string };

export type Unsubscribe = () => void;

export interface VaultPort {
	read(path: string): Promise<string>;
	/** Create or overwrite. Write-if-changed discipline is the caller's. */
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	rename(path: string, newPath: string): Promise<void>;
	/**
	 * Move to trash honoring the user's deleted-files preference — never a
	 * permanent delete.
	 */
	trash(path: string): Promise<void>;
	/** Parsed frontmatter, or null where absent or unparseable. */
	frontmatter(path: string): Promise<Readonly<Record<string, unknown>> | null>;
	/**
	 * Update frontmatter through the platform writer. Cross-device byte
	 * determinism of the real writer is verified empirically, never assumed
	 * by the fake.
	 */
	updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
	onFileEvent(handler: (event: VaultFileEvent) => void): Unsubscribe;
}
