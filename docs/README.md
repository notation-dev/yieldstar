# Documentation

This directory is both the documentation source and the site that publishes it.
The site is built by [`@notation/docs`](../../../docs/packages/docs), a Vite
preset that supplies the whole docs shell; everything project-specific lives here.

## Commands

Run these from the repository root:

| Command | What it does |
| --- | --- |
| `pok docs dev` | Dev server on http://localhost:3004 |
| `pok docs build` | Production build into `docs/dist` |
| `pok docs deploy` | Build, then deploy the `yieldstar-docs` Cloudflare Worker |

## Layout

| Path | Purpose |
| --- | --- |
| `manual/`, `runtimes/`, `packages/` | Markdown, one directory per docs category |
| `*/nav.ts` | Sidebar for that category, beside its Markdown |
| `index.ts` | Orders the categories; must match `categories` in `vite.config.ts` |
| `pages/` | Extra routes outside `/docs`, such as the landing page |
| `views/` | React components used by those pages |
| `vite.config.ts` | Title, nav categories, favicon, logo, version source, deployment |

The build fails on a broken link, a duplicate slug or an undeclared category, so
a nav entry and its `.md` file always stay in step.

## Updating the framework

`@notation/docs` is not published yet, so it is installed from a sibling
checkout that must sit at `~/Repos/docs`. pnpm caches that by path, so after
changing the framework, rebuild it and refresh this package:

```sh
cd ~/Repos/docs/packages/docs && pnpm build
cd - && pnpm --filter @yieldstar/docs-site update @notation/docs
```

Because that path does not exist on CI, the workflows install with
`--filter '!@yieldstar/docs-site'`. Once the framework is published, swap the `file:`
dependency for a version range and both workarounds go away.
