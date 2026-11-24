/**
 * Empty stand-in for the `server-only` marker, aliased by vitest.config.mts.
 *
 * `import "server-only"` is Next's marker that a module may never be imported into a
 * client component. Next resolves it to an empty module on the server build, and the
 * marker is not an installed package here, so a test that imports the service layer
 * (which is server-only code) would fail to resolve it.
 *
 * The alias resolves the marker to this empty file. Nothing about behaviour changes:
 * the marker carries no code, only an intent, and the intent is still enforced by
 * Next itself in the real build.
 */
export {};
