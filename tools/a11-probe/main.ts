/**
 * The probe plugin. This plugin is separate from the Davenport plugin.
 * The plugin records how this build of Obsidian writes frontmatter. Thus
 * you can compare runs from different versions and different devices,
 * byte for byte.
 *
 * This file holds the plugin lifecycle and the text of the notices. The
 * run itself is in `run.ts`. The probe reads and writes one folder in the
 * vault. The probe uses no network. The probe stores nothing anywhere
 * else.
 */

import { Notice, Plugin } from 'obsidian';
import { describeError } from './results';
import { runProbe } from './run';

/**
 * How long a notice stays on screen. This time is long enough to read a
 * path off a phone screen.
 */
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
		new Notice('Frontmatter probe: the run started…');
		try {
			const run = await runProbe(this, new Date());
			const said = [`${String(run.emitted)} samples`];
			if (run.failed > 0) {
				said.push(
					`fixtures that the writer refused: ${String(run.failed)}`,
				);
			}
			if (run.timedOut > 0) {
				said.push(
					`samples that waited out the cache timeout and are possibly stale: ${String(run.timedOut)}`,
				);
			}
			new Notice(
				`Frontmatter probe: ${said.join(', ')}. The results file is ${run.path}`,
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
