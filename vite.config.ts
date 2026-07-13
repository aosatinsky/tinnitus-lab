import { defineConfig } from 'vite';

// Deployed at https://aosatinsky.github.io/tinnitus-lab/ — assets live under
// the /tinnitus-lab/ subpath in production, at / in dev.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/tinnitus-lab/' : '/',
}));
