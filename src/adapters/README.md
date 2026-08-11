# Adapters

Implementations of the `core/ports/` interfaces over platform APIs
(Obsidian, `requestUrl`, `saveLocalStorage`). The boundary rule: `core/`
never imports platform modules; adapters never hold engine logic. Adapter
modules land with the issues that need them.
