import { describe, expect, it } from 'vitest';
import { ControlledClock } from '../clock';
import { icsEvent } from '../caldav-mock/fixtures';
import { MockCalDavServer } from '../caldav-mock/server';
import { createFeedFixture } from '../feed-fixture/server';
import { emptyCalendar } from '../feed-fixture/variants';
import { FakeVault } from '../obsidian-fake/vault';
import { VaultSyncChannel } from '../vault-sync/channel';
import { SweepRegistry } from './registry';
import { runSimulation, type SimulationOptions } from './run';
import { SweepFailure, type Sweep } from './sweep';

const FEED_URL = 'https://feeds.davenport.test/team.ics';
const PASSWORD = 'hunter2-app-specific-password';

function server(): MockCalDavServer {
	return new MockCalDavServer({
		accounts: [
			{
				name: 'alice',
				collections: [
					{
						name: 'work',
						resources: [
							{
								name: 'one.ics',
								ics: icsEvent({
									uid: 'one',
									start: '20260310T090000Z',
								}),
							},
						],
					},
				],
			},
		],
	});
}

function feed() {
	return createFeedFixture({
		referenceTime: Date.UTC(2026, 2, 10),
		feeds: { [FEED_URL]: { polls: [emptyCalendar()] } },
	});
}

/** A registry holding one sweep, so a test states exactly what runs. */
function only(sweep: Sweep): SweepRegistry {
	return new SweepRegistry([sweep]);
}

const inert: Sweep = { name: 'inert', check: () => [] };

function options(patch: Partial<SimulationOptions> = {}): SimulationOptions {
	return { name: 'a run', registry: only(inert), ...patch };
}

describe('simulation runs', () => {
	it('returns what the body returned', async () => {
		await expect(runSimulation(options(), () => 'done')).resolves.toBe(
			'done',
		);
	});

	it('gathers the surfaces the run was built with', async () => {
		const caldav = server();
		const feeds = feed();
		const vault = new FakeVault({ 'Events/one.md': 'seeded' });
		await runSimulation(
			options({ caldav, feed: feeds, vault }),
			async (run) => {
				await caldav.request({
					url: caldav.resourceUrl('alice', 'work', 'one.ics'),
					method: 'GET',
				});
				await feeds.request({ url: FEED_URL });
				await vault.write('Events/two.md', 'written');
				run.logger.log({ time: 1, action: 'poll', outcome: 'success' });
				const evidence = await run.evidence();
				expect(evidence.name).toBe('a run');
				expect(
					evidence.caldav.requests.map((entry) => entry.method),
				).toEqual(['GET']);
				expect(
					evidence.feed.requests.map((entry) => entry.url),
				).toEqual([FEED_URL]);
				expect(evidence.vault.changes).toEqual([
					{
						kind: 'created',
						path: 'Events/two.md',
						oldPath: null,
						content: 'written',
					},
				]);
				expect(evidence.vault.files).toEqual({
					'Events/one.md': 'seeded',
					'Events/two.md': 'written',
				});
				expect(evidence.syncLog).toHaveLength(1);
				expect(evidence.network.poisoned).toBe(true);
			},
		);
	});

	it('records the scheduling writes the mock server logged', async () => {
		const caldav = server();
		await runSimulation(options({ caldav }), async (run) => {
			await caldav.request({
				url: caldav.resourceUrl('alice', 'work', 'two.ics'),
				method: 'PUT',
				body: icsEvent({
					uid: 'two',
					start: '20260311T090000Z',
					attendees: ['mailto:bob@davenport.test'],
				}),
				contentType: 'text/calendar',
			});
			const evidence = await run.evidence();
			expect(
				evidence.caldav.scheduling.map((entry) => entry.transition),
			).toEqual(['gains']);
		});
	});

	it('gathers the deliveries the sync channel landed', async () => {
		const channel = new VaultSyncChannel({
			devices: ['laptop', 'phone'],
			clock: new ControlledClock(),
		});
		await runSimulation(options({ vaultSync: channel }), async (run) => {
			await channel.device('laptop').write('Events/one.md', 'written');
			await channel.deliver();
			const evidence = await run.evidence();
			expect(
				evidence.vaultSync.deliveries.map((landed) => [
					landed.delivery.to,
					landed.outcome,
				]),
			).toEqual([['phone', 'created']]);
		});
	});

	it('stops listening to the vault once the run is over', async () => {
		const vault = new FakeVault();
		let seen = 0;
		await runSimulation(options({ vault }), async (run) => {
			await vault.write('a.md', 'one');
			seen = (await run.evidence()).vault.changes.length;
		});
		await vault.write('b.md', 'two');
		expect(seen).toBe(1);
	});

	it('keeps the bytes a change left, not the ones that replaced them', async () => {
		const vault = new FakeVault();
		await runSimulation(options({ vault }), async (run) => {
			await vault.write('a.md', 'first');
			await vault.write('a.md', 'second');
			await vault.rename('a.md', 'b.md');
			await vault.trash('b.md');
			const evidence = await run.evidence();
			expect(
				evidence.vault.changes.map((change) => [
					change.kind,
					change.path,
					change.oldPath,
					change.content,
				]),
			).toEqual([
				['created', 'a.md', null, 'first'],
				['modified', 'a.md', null, 'second'],
				['renamed', 'b.md', 'a.md', 'second'],
				['deleted', 'b.md', null, null],
			]);
			expect(evidence.vault.files).toEqual({});
		});
	});

	it('attributes requests to the stretch that issued them', async () => {
		const caldav = server();
		await runSimulation(options({ caldav }), async (run) => {
			await caldav.request({
				url: caldav.collectionUrl('alice', 'work'),
				method: 'GET',
			});
			await run.remoteObserved('a tombstone', async () => {
				await caldav.request({
					url: caldav.resourceUrl('alice', 'work', 'one.ics'),
					method: 'GET',
				});
			});
			expect((await run.evidence()).remoteObserved).toEqual([
				{
					label: 'a tombstone',
					from: { caldav: 1, feed: 0 },
					to: { caldav: 2, feed: 0 },
				},
			]);
		});
	});

	it('counts a feed poll inside the stretch too', async () => {
		const feeds = feed();
		const failure = await runSimulation(
			{ name: 'a run', feed: feeds },
			async (run) => {
				await run.remoteObserved('a tombstone', async () => {
					await feeds.request({ url: FEED_URL });
				});
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain(
			'remote-observed-no-server-requests',
		);
		expect((failure as SweepFailure).message).toContain(
			`feed.requests[0]: GET ${FEED_URL} was issued while processing a tombstone`,
		);
	});

	it('closes the stretch even when the work inside it throws', async () => {
		const caldav = server();
		await runSimulation(options({ caldav }), async (run) => {
			await expect(
				run.remoteObserved('a tombstone', () => {
					throw new Error('processing failed');
				}),
			).rejects.toThrow('processing failed');
			expect((await run.evidence()).remoteObserved).toHaveLength(1);
		});
	});
});

describe('sweep failures', () => {
	const objector: Sweep = {
		name: 'objector',
		check: (evidence) => [
			{
				where: 'vault.files',
				detail: `${evidence.name} objected`,
			},
		],
	};

	it('fails the owning test naming the sweep and the evidence', async () => {
		const failure = await runSimulation(
			options({ registry: only(objector) }),
			() => undefined,
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(SweepFailure);
		expect((failure as SweepFailure).message).toContain('objector');
		expect((failure as SweepFailure).message).toContain(
			'vault.files: a run objected',
		);
		expect((failure as SweepFailure).reports).toHaveLength(1);
	});

	it('lets the body error through untouched, sweeping nothing', async () => {
		let checked = false;
		const watching: Sweep = {
			name: 'watching',
			check: () => {
				checked = true;
				return [];
			},
		};
		await expect(
			runSimulation(options({ registry: only(watching) }), () => {
				throw new Error('the body failed');
			}),
		).rejects.toThrow('the body failed');
		expect(checked).toBe(false);
	});

	it('catches a registered value that reached a note', async () => {
		const vault = new FakeVault();
		const failure = await runSimulation(
			{ name: 'a run', vault },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await vault.write(
					'Events/one.md',
					`---\npassword: ${PASSWORD}\n---\n`,
				);
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain('secrets-scan');
		expect((failure as SweepFailure).message).toContain(
			'vault.files["Events/one.md"]',
		);
		expect((failure as SweepFailure).message).not.toContain(PASSWORD);
	});

	it('catches a registered value in a note the run then removed', async () => {
		const vault = new FakeVault();
		const failure = await runSimulation(
			{ name: 'a run', vault },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await vault.write('Events/one.md', PASSWORD);
				await vault.trash('Events/one.md');
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain(
			'vault.changes[0].content',
		);
	});

	it('catches a registered value a later write redacted', async () => {
		const vault = new FakeVault();
		const failure = await runSimulation(
			{ name: 'a run', vault },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await vault.write('Events/one.md', PASSWORD);
				await vault.write('Events/one.md', 'redacted');
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain(
			'vault.changes[0].content',
		);
	});

	it('catches a registered value that only a request body carried', async () => {
		const caldav = server();
		const failure = await runSimulation(
			{ name: 'a run', caldav },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await caldav.request({
					url: caldav.resourceUrl('alice', 'work', 'two.ics'),
					method: 'PUT',
					body: icsEvent({
						uid: 'two',
						start: '20260311T090000Z',
						summary: PASSWORD,
					}),
				});
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain('secrets-scan');
		expect((failure as SweepFailure).message).toContain(
			'caldav.requests[0].body',
		);
		expect((failure as SweepFailure).message).not.toContain(PASSWORD);
	});

	it('catches a registered value that only an Authorization header carried', async () => {
		const caldav = server();
		const failure = await runSimulation(
			{ name: 'a run', caldav },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await caldav.request({
					url: caldav.collectionUrl('alice', 'work'),
					method: 'PROPFIND',
					headers: {
						Authorization: `Basic ${PASSWORD}`,
						Depth: '0',
					},
				});
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain(
			'caldav.requests[0].headers.authorization',
		);
	});

	it('catches a registered value the sync channel carried to a peer', async () => {
		const channel = new VaultSyncChannel({
			devices: ['laptop', 'phone'],
			clock: new ControlledClock(),
		});
		const failure = await runSimulation(
			{ name: 'a run', vaultSync: channel },
			async (run) => {
				run.registerSecret({ label: 'app password', value: PASSWORD });
				await channel.device('laptop').write('Events/one.md', PASSWORD);
				await channel.deliver();
			},
		).catch((error: unknown) => error);
		expect((failure as SweepFailure).message).toContain(
			'vaultSync.deliveries[0].delivery.change.content',
		);
	});

	it('takes sensitive values declared at the start too', async () => {
		const vault = new FakeVault({ 'Events/one.md': PASSWORD });
		await expect(
			runSimulation(
				{
					name: 'a run',
					vault,
					secrets: [{ label: 'app password', value: PASSWORD }],
				},
				() => undefined,
			),
		).rejects.toThrow(/secrets-scan/);
	});

	it('refuses the empty string as a sensitive value', async () => {
		await expect(
			runSimulation(options(), (run) => {
				run.registerSecret({ label: 'nothing', value: '' });
			}),
		).rejects.toThrow(/empty string/);
	});
});
