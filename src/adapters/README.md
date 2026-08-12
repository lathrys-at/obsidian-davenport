# Adapters

The adapters implement the `core/ports/` interfaces over platform APIs
(Obsidian, `requestUrl`, `saveLocalStorage`). The boundary rule is as
follows. `core/` never imports platform modules. Adapters never hold
engine logic. Adapter modules arrive with the issues that need them.
