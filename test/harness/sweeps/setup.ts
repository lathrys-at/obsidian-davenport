/**
 * The setup file of vitest. Vitest runs this file for every test file in
 * the repository. The file does two things.
 *
 * First, the file replaces the global fetch with a function that throws.
 * This replacement is the poison. The file installs the poison at the
 * top level. The poison is therefore in place before vitest imports any
 * test module.
 *
 * Second, the file puts the sweep registry back to the standing set
 * before each test. The standing set holds the sweeps that every run
 * starts with. A sweep that one test registers therefore does not reach
 * another test.
 */

import { beforeEach } from 'vitest';
import { poisonFetch } from './fetch-poison';
import { resetSweeps } from './registry';

poisonFetch();

beforeEach(() => {
	resetSweeps();
});
