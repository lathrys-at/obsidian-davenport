import { Plugin } from 'obsidian';

/**
 * Davenport — bidirectional calendar and task sync over CalDAV.
 *
 * Entry point: lifecycle and registration only. Behavior lives in core/
 * behind port interfaces, implemented by adapters/. Lifecycle methods
 * arrive with the first feature that needs them.
 */
export default class DavenportPlugin extends Plugin {}
