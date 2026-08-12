/**
 * What the run should say about where it happened.
 *
 * The probe records the environment rather than branching on it: the whole
 * point of the exercise is to hold the input fixed and let the environment
 * be the only variable, so every identifier that might explain a
 * difference is written down.
 */

import { Platform, apiVersion, type App } from 'obsidian';
import type { ProbePlatform } from './results';

const UNKNOWN = 'unknown';

/** The app version, which the typed API does not carry. */
export function obsidianVersion(app: App): string {
	const version: unknown = Reflect.get(app, 'appVersion');
	return typeof version === 'string' ? version : UNKNOWN;
}

/** The plugin API version this build of the app offers. */
export function pluginApiVersion(): string {
	return apiVersion;
}

/** The device, in the terms the app and the engine report it. */
export function probePlatform(): ProbePlatform {
	return {
		isDesktop: Platform.isDesktop,
		isMobile: Platform.isMobile,
		isIosApp: Platform.isIosApp,
		isAndroidApp: Platform.isAndroidApp,
		isMacOS: Platform.isMacOS,
		isWin: Platform.isWin,
		isLinux: Platform.isLinux,
		userAgent: navigator.userAgent,
	};
}
