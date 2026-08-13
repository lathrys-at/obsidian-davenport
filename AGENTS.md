# Obsidian community plugin

## Project overview

- Target: Obsidian Community Plugin (TypeScript → bundled JavaScript).
- Entry point: the build compiles `src/main.ts` into `main.js`. Obsidian then loads `main.js`.
- Required release artifacts: `main.js` and `manifest.json`. The `styles.css` file is optional.

## Environment & tooling

- Node.js: use the current LTS version (Node 18+ recommended).
- **Package manager: npm** (`package.json` defines the scripts and dependencies).
- **Bundler: esbuild** (`esbuild.config.mjs` and the build scripts depend on it).
- Types: `obsidian` type definitions.

### Install

```bash
npm install
```

### Dev (watch)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

## Linting

- The project comes with ESLint already configured with `eslint-plugin-obsidianmd` and typescript-eslint strict-type-checked. ESLint also applies invariant guards. The guards forbid the global `fetch` everywhere. The guards also prevent `src/core/` from importing platform modules and from using ambient time. The clock port supplies the time.
- Run `npm run lint` to lint the project. Run `npm run format` to run Prettier.
- CI runs the lint, the typecheck, the tests, and the build with a bundle scan. CI does this on every commit on all branches. CI aggregates these jobs into the required `ci-ok` check.

## File & folder conventions

- **Organize code into multiple files**: Put the functionality in separate modules. Do not put all the code in `main.ts`.
- The source code lives in `src/`. Keep `main.ts` small. Keep `main.ts` limited to the plugin lifecycle: loading, unloading, and registering commands.
- **File structure** (ports-and-adapters; the boundary rule is in `src/adapters/README.md`):
    ```
    src/
      main.ts           # Plugin entry point, lifecycle only
      core/             # Platform-free engine: no obsidian/electron/node
        model/          # Domain types (events, records, identity, registry)
        ports/          # Interfaces the engine depends on (transport,
                        #   vault, device store, clock, logger)
      adapters/         # Port implementations over platform APIs
      ui/               # Views, modals, settings tab (arrives with features)
    ```
- **Do not commit build artifacts**: Never commit `node_modules/`, `main.js`, or other generated files to version control.
- Keep the plugin small. Avoid large dependencies. Prefer browser-compatible packages.
- The generated output should go to the plugin root or to `dist/`. Your build setup decides which of the two locations applies. The release artifacts must be at the top level of the plugin folder in the vault (`main.js`, `manifest.json`, `styles.css`).

## Manifest rules (`manifest.json`)

- The manifest must include these fields (the list is not exhaustive):
    - `id` (plugin ID; for local development the `id` should match the folder name)
    - `name`
    - `version` (Semantic Versioning `x.y.z`)
    - `minAppVersion`
    - `description`
    - `isDesktopOnly` (boolean)
    - Optional: `author`, `authorUrl`, `fundingUrl` (string or map)
- Never change `id` after you release the plugin. Treat `id` as a stable API.
- Keep `minAppVersion` accurate when you use newer APIs.
- The canonical requirements are in this file: https://github.com/obsidianmd/obsidian-releases/blob/master/.github/workflows/validate-plugin-entry.yml

## Testing

- The automated tests run under Vitest. Run the tests with `npm test`. The file `test/README.md` gives the layout and naming conventions.
- To install the plugin manually for testing, copy `main.js`, `manifest.json`, and `styles.css` (if `styles.css` exists) to this folder:
    ```
    <Vault>/.obsidian/plugins/<plugin-id>/
    ```
- Reload Obsidian. Then enable the plugin in **Settings → Community plugins**.

## Commands & settings

- You should add all user-facing commands with `this.addCommand(...)`.
- If the plugin has configuration, provide a settings tab. If the plugin has configuration, also provide sensible defaults.
- Persist the settings with `this.loadData()` and `this.saveData()`.
- Use stable command IDs. Do not rename a command ID after you release it.

## Versioning & releases

- Bump the `version` field in `manifest.json` (SemVer). Also update `versions.json` to map the plugin version to the minimum app version.
- Create a GitHub release. Give the release a tag that exactly matches the `version` field in `manifest.json`. Do not use a leading `v`.
- Attach `manifest.json`, `main.js`, and `styles.css` (if present) to the release as individual assets.
- After the initial release, follow the process that adds or updates your plugin in the community catalog, as required.

## Security, privacy, and compliance

Follow Obsidian's **Developer Policies** and **Plugin Guidelines**. Obey these rules in particular:

- Operate locally and offline by default. Make a network request only when the feature cannot work without it.
- Do not add hidden telemetry. If you collect optional analytics or call third-party services, require an explicit opt-in from the user. If you collect optional analytics or call third-party services, also document the analytics and the services clearly in `README.md` and in the settings.
- Never execute remote code. Never fetch and eval scripts. Never auto-update the plugin code outside of normal releases.
- Keep the scope to a minimum. Read and write only the necessary files, and only inside the vault. Do not access files outside the vault.
- Disclose clearly all the external services that you use, all the data that you send, and all the risks.
- Respect the privacy of the user. Do not collect vault contents, filenames, or personal information, unless the collection is absolutely necessary and the user gives explicit consent.
- Do not use deceptive patterns, ads, or spammy notifications.
- Register all DOM, app, and interval listeners with the provided `register*` helpers. Clean up the same listeners with these helpers. These steps make the plugin unload safely.

## UX & copy guidelines (for UI text, commands, settings)

- Prefer sentence case for headings, buttons, and titles.
- Use clear, action-oriented imperatives in step-by-step copy.
- Use **bold** to show literal UI labels. Prefer the word "select" for interactions.
- Use arrow notation for navigation: **Settings → Community plugins**.
- Keep in-app strings short, consistent, and free of jargon.
- In-app strings and dialogue text follow Simplified Technical English (ASD-STE100). Apply the asd-ste100 skill when you write these strings and this text. The file docs/dev/process.md states the procedure and the precision rule.

## Performance

- Keep the startup light. Defer heavy work until the plugin needs it.
- Do not start long-running tasks during `onload`. Use lazy initialization instead.
- Batch the disk access. Do not scan the vault more than necessary.
- Debounce or throttle expensive operations that respond to file system events.

## Coding conventions

- Prefer TypeScript with `"strict": true`.
- Write code comments as plain prose that states the contract. Never put subsection anchors in code comments: spec `§` references, test-plan IDs, and issue numbers. Link out to documentation only when it is absolutely necessary.
- All technical documentation, code comments, error messages, dialogue text, and instruction text follow Simplified Technical English (ASD-STE100). Apply the asd-ste100 skill as a mandatory authoring step. The file docs/dev/process.md states the procedure.
- **Keep `main.ts` minimal**: Keep only the plugin lifecycle code in `main.ts` (onload, onunload, addCommand calls). Put all feature logic in separate modules.
- **Split large files**: If a file becomes longer than ~200-300 lines, consider splitting the file into smaller, focused modules.
- **Use clear module boundaries**: Each file should have a single, well-defined responsibility.
- Bundle all the code into `main.js`. The plugin must have no unbundled runtime dependencies.
- Do not use Node or Electron APIs if you want mobile compatibility. Set `isDesktopOnly` to match your choice.
- Prefer `async/await` to promise chains. Handle errors gracefully.

## Mobile

- When it is feasible, test the plugin on iOS and Android.
- Do not assume desktop-only behavior unless `isDesktopOnly` is `true`.
- Do not use large in-memory structures. Keep the memory and storage constraints in mind.

## Agent do/don't

**Do**

- Add commands with stable IDs. Do not rename an ID after a release.
- Provide defaults and validation in settings.
- Write idempotent code paths. Then a reload or an unload does not leak listeners or intervals.
- Use `this.register*` helpers for everything that needs cleanup.

**Don't**

- Do not introduce network calls without an obvious user-facing reason and without documentation.
- Do not ship features that require cloud services without clear disclosure and without explicit opt-in.
- Do not store or transmit vault contents, unless the operation is essential and the user consents.

## Common tasks

### Organize code across multiple files

`src/main.ts` stays lifecycle-only. The file constructs the adapters. The file
wires the adapters into core through the port interfaces. The file registers
commands and views as features land.

The engine logic lives in `src/core/`. The engine logic never imports platform
modules. The adapters implement `src/core/ports/` over the Obsidian API.

When you add a feature, put the domain logic of the feature in core. Put the
platform glue of the feature in an adapter. Put only the registration of the
feature in `main.ts`.

### Add a command

```ts
this.addCommand({
	id: 'your-command-id',
	name: 'Do the thing',
	callback: () => this.doTheThing(),
});
```

### Persist settings

```ts
interface PluginSettings { enabled: boolean }
const DEFAULT_SETTINGS: PluginSettings = { enabled: true };

async onload() {
  this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<PluginSettings>);
  await this.saveData(this.settings);
}
```

### Register listeners safely

```ts
this.registerEvent(
	this.app.workspace.on('file-open', (f) => {
		/* ... */
	}),
);
this.registerDomEvent(activeWindow, 'resize', () => {
	/* ... */
});
this.registerInterval(
	window.setInterval(() => {
		/* ... */
	}, 1000),
);
```

## Troubleshooting

- The plugin does not load after a build: make sure that `main.js` and `manifest.json` are at the top level of the plugin folder under `<Vault>/.obsidian/plugins/<plugin-id>/`.
- Build issues: if `main.js` is missing, run `npm run build` or `npm run dev` to compile your TypeScript source code.
- Commands do not appear: make sure that `addCommand` runs after `onload`. Also make sure that the command IDs are unique.
- Settings do not persist: make sure that you await `loadData` and `saveData`. Also make sure that you re-render the UI after each change.
- Mobile-only issues: make sure that you do not use desktop-only APIs. Then check `isDesktopOnly` and adjust the value.

## References

- Obsidian sample plugin: https://github.com/obsidianmd/obsidian-sample-plugin
- API documentation: https://docs.obsidian.md
- Developer policies: https://docs.obsidian.md/Developer+policies
- Plugin guidelines: https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines
- Style guide: https://help.obsidian.md/style-guide
