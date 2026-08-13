/**
 * What the run reports about the environment that the run used.
 *
 * The probe records the environment. The probe never changes what it does
 * because of the environment. The purpose of the exercise is to hold the
 * input the same, and to let the environment be the only variable.
 * Therefore this module writes down every identifier that can explain a
 * difference.
 */

import { Platform, apiVersion, type App } from 'obsidian';
import type { ProbePlatform } from './results';

const UNKNOWN = 'unknown';

/**
 * The version of the app. The typed API does not carry this value. The
 * value is `unknown` when the app gives no version.
 */
export function obsidianVersion(app: App): string {
	const version: unknown = Reflect.get(app, 'appVersion');
	return typeof version === 'string' ? version : UNKNOWN;
}

/** The version of the plugin API that this build of the app gives. */
export function pluginApiVersion(): string {
	return apiVersion;
}

/** The device, in the terms that the app and the browser engine report. */
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
