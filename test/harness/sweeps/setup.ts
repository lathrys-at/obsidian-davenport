/**
 * Vitest setup, applied to every test file in the repository. Global fetch
 * is poisoned before any test module is imported, and the sweep registry
 * returns to the standing set before each test so nothing a test registers
 * reaches its neighbours.
 */

import { beforeEach } from 'vitest';
import { poisonFetch } from './fetch-poison';
import { resetSweeps } from './registry';

poisonFetch();

beforeEach(() => {
	resetSweeps();
});
