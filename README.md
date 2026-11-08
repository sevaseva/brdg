# Cobb Bridge Club

A tiny, deliberately retro website for a beginner bridge club in Cobb, California. Built with Jekyll
and deployed by GitHub Pages' native build — no Actions workflow, no plugins.

## Preview locally

```bash
jekyll serve --livereload
```

Open <http://localhost:4000/brdg/>. To preview at the site root instead, run
`jekyll serve --livereload --baseurl ""` and open <http://localhost:4000>.

## Deploy

Push to the default branch, then set **Settings → Pages → Build and deployment → Source: Deploy from
a branch → `main` / `/ (root)`**. The site is configured for a project site named `brdg`; if the
GitHub repository has a different name, update `baseurl` in `_config.yml` first. For a user site
(`<user>.github.io`), set `baseurl: ""`.

See [AGENTS.md](AGENTS.md) for contributor and agent notes.
