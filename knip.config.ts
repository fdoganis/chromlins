// knip (npx knip) finds unused files, exports and dependencies — type-aware
// (uses the real TypeScript checker), so it doesn't share
// find-uncalled-methods.mjs's getter/same-name-different-class blind spots.
// It has its own blind spot instead: anything reached only through a string,
// not a static `import` — the exact class of bug PACK_EXTERNS=three already
// hit once for real in this project (a renamed dynamic-dispatch key broke
// audio silently). Every entry below was verified by hand before being
// added here, not added just because knip complained — see the reason next
// to each.
export default {
  entry: [
    // src/main.ts is already knip's own default entry — not repeated here,
    // it flagged the explicit copy as redundant once the entries below made
    // this file necessary anyway.
    // Run via spawnSync/child_process from other scripts (pack.mjs,
    // package.json's npm scripts), never a static `import` — knip has no way
    // to see that call. Confirmed by reading pack.mjs directly.
    'scripts/*.mjs',
    // Loaded by tests/audio-loudness.spec.ts via page.addScriptTag({ url:
    // '/tests/lib/audio-harness.ts' }) — a runtime URL string, not an
    // `import`. Confirmed by reading that spec directly.
    'tests/lib/audio-harness.ts',
  ],
  ignoreDependencies: [
    // node_modules/iwer/build/iwer.min.js is loaded via
    // page.addInitScript({ path: ... }) in every IWER-driven spec — a
    // filesystem path, not an `import`. Confirmed: grep finds it in 8 specs.
    'iwer',
    // Invoked via spawnSync in scripts/pack.mjs to run its own bundled
    // compiler binary, never imported as a JS module. Confirmed in pack.mjs.
    'google-closure-compiler',
    // Ambient types package: augments the global XR* types, no code ever
    // imports from '@types/webxr' by name — that's how ambient @types
    // packages work, not a sign it's unused. See
    // scripts/gen-external-api-names.mjs's own comment on this exact
    // distinction (ambient vs real dependency types).
    '@types/webxr',
  ],
  // `npm run cloud` shells out to the cloudflared CLI (a locally-installed
  // system binary, e.g. via Homebrew) — deliberately not an npm dependency.
  ignoreBinaries: ['cloudflared'],
};
