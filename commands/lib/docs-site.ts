/**
 * Location of this project's docs site.
 *
 * The site is built by @notation/docs and currently lives in the shared docs
 * repo, which sources this project's docs/ directory over a symlink. That
 * repo is expected to sit alongside this one:
 *
 *   ~/Repos/notation/yieldstar   <- here
 *   ~/Repos/docs/apps/yieldstar  <- the site
 *
 * When the docs package moves into this repository, this becomes './docs' and
 * the sibling-checkout assumption goes away.
 */
export const DOCS_SITE_DIR = "../../docs/apps/yieldstar";
