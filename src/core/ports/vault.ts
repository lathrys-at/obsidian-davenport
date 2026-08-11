/**
 * Vault port: the engine's only view of note files and their metadata. The
 * deterministic test fake and the Obsidian adapter both implement it; core
 * code never imports platform APIs.
 */

export type VaultFileEvent =
	| { readonly kind: 'modified'; readonly path: string }
	| { readonly kind: 'renamed'; readonly path: string; readonly oldPath: string }
	| { readonly kind: 'deleted'; readonly path: string };

export type Unsubscribe = () => void;

export interface VaultPort {
	read(path: string): Promise<string>;
	/** Create or overwrite. Write-if-changed discipline is the caller's (§3.2). */
	write(path: string, content: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	rename(path: string, newPath: string): Promise<void>;
	/**
	 * Move to trash honoring the user's deleted-files preference — never a
	 * permanent delete (§5.4).
	 */
	trash(path: string): Promise<void>;
	/** Parsed frontmatter, or null where absent or unparseable. */
	frontmatter(path: string): Promise<Readonly<Record<string, unknown>> | null>;
	/**
	 * Update frontmatter through the platform writer. Cross-device byte
	 * determinism of the real writer is Appendix A item 11 — verified, never
	 * assumed by the fake.
	 */
	updateFrontmatter(
		path: string,
		update: (frontmatter: Record<string, unknown>) => void,
	): Promise<void>;
	onFileEvent(handler: (event: VaultFileEvent) => void): Unsubscribe;
}
