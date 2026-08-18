import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'bragvault-mcp': 'src/bin/bragvault-mcp.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
  dts: false,
  banner: { js: '#!/usr/bin/env node' },
  // The committed dist is launched directly via `node` from plugin installs
  // (no node_modules present), so runtime deps must be bundled in.
  noExternal: ['@modelcontextprotocol/sdk', 'zod'],
});
