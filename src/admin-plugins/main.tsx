/**
 * Poster Memento — Admin entry point with plugin registration.
 *
 * This file will replace the current src/admin/ when the @3dn packages are
 * published and the migration (Phase 4) is complete.
 *
 * Usage during migration:
 *   1. Publish @3dn/memento-core and @3dn/memento-admin to GitHub Packages
 *   2. Add GITHUB_TOKEN to .npmrc and run `npm install`
 *   3. Adapt ProcessingTab and ScraperTab to import from @3dn/memento-admin
 *   4. Point the Vite build config at this entry point
 *   5. Remove src/admin/ once verified
 *
 * Final import structure (post-migration):
 *
 *   import { registerPlugins } from '@3dn/memento-admin/src/plugin/PluginRegistry';
 *   import { App } from '@3dn/memento-admin';
 *   import { ProcessingTab } from './ProcessingTab';
 *   import { ScraperTab } from './ScraperTab';
 *
 *   registerPlugins({
 *     tabs: [
 *       { id: 'processing', component: ProcessingTab },
 *       { id: 'scraper', component: ScraperTab },
 *     ],
 *   });
 *
 *   createRoot(document.getElementById('root')!).render(<App />);
 */

// TODO: Replace this file with the structure above once @3dn packages are published.
// For now the poster admin is still served from src/admin/.
export {};
