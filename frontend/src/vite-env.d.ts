/// <reference types="vite/client" />

// Vite's ambient types for `import.meta.env`.
//
// This file is part of the standard Vite scaffold and was missing, which meant
// `import.meta.env` was untyped everywhere. Nothing caught it because the only
// type-check in CI ran `tsc --noEmit` against tsconfig.json -- a solution-style
// config with `files: []`, so it compiled nothing and passed vacuously.

interface ImportMetaEnv {
  /**
   * Origin the API is served from. Empty means same-origin relative requests,
   * which is what the nginx container proxies in a container deployment.
   *
   * Inlined into the bundle at build time and served to every visitor, so
   * nothing secret may ever be given a VITE_ prefix.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
