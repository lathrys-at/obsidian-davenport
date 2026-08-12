# Adapters

The adapters implement the `core/ports/` interfaces over platform APIs
(Obsidian, `requestUrl`, `saveLocalStorage`). The boundary rule has two
parts: `core/` never imports platform modules, and adapters never hold
engine logic. Adapter modules arrive with the issues that need them.
