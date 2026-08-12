/**
 * A standalone probe that records how this build of Obsidian writes
 * frontmatter, so runs from different versions and devices can be compared
 * byte for byte.
 *
 * Lifecycle and copy only: the run itself is in `run.ts`. The probe reads
 * and writes one folder in the vault, reaches no network, and stores
 * nothing anywhere else.
 */

import { Notice, Plugin } from 'obsidian';
import { describeError, runProbe } from './run';

/** Long enough to read a path off a phone screen. */
const NOTICE_MS = 20000;

export default class FrontmatterProbePlugin extends Plugin {
	override onload(): void {
		this.addCommand({
			id: 'run-frontmatter-probe',
			name: 'Run frontmatter probe',
			callback: () => {
				void this.probe();
			},
		});
	}

	private async probe(): Promise<void> {
		new Notice('Frontmatter probe: running…');
		try {
			const run = await runProbe(this.app, new Date());
			const refused =
				run.failed === 0
					? ''
					: `, ${String(run.failed)} refused by the writer`;
			new Notice(
				`Frontmatter probe: ${String(run.emitted)} samples${refused}. Results in ${run.path}`,
				NOTICE_MS,
			);
		} catch (error) {
			console.error('frontmatter probe failed', error);
			new Notice(
				`Frontmatter probe failed: ${describeError(error)}`,
				NOTICE_MS,
			);
		}
	}
}
