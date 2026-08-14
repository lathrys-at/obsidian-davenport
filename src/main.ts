import { Plugin } from 'obsidian';

/**
 * Davenport synchronizes calendar events and tasks between the vault and
 * a CalDAV server. It sends changes in both directions: from the vault
 * to the server, and from the server to the vault.
 *
 * This file is the entry point of the plugin. It holds the lifecycle of
 * the plugin, and it registers the parts of the plugin with Obsidian.
 * It holds no other code.
 *
 * The behavior of the plugin lives in core/. The code in core/ reaches
 * the platform only through the interfaces in core/ports/. The code in
 * adapters/ implements those interfaces over the platform APIs.
 */
export default class DavenportPlugin extends Plugin {}
