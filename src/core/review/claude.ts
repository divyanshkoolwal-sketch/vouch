// Backwards-compatible shim. The Claude reviewer moved to ./backends/claude.ts
// and all callers now go through the backend dispatcher in ./backends. This file
// remains only to re-export the JSON helper for any external importer.
export { extractJSON } from './backends';
