# AGENTS.md

This repository is the website for the **Cobb Bridge Club**, a friendly (and slightly fictional)
beginner bridge club in Cobb, California. It is a hand-built Jekyll site with a deliberately retro,
late-1990s look: neon colors, beveled panels, a scrolling ticker, a chalkboard bulletin, and
original SVG artwork.

## Deployment model

- The site is deployed by **GitHub Pages' native/classic Jekyll build**. There is no GitHub Actions
  workflow, and one should not be added.
- GitHub Pages builds the default branch with its managed Jekyll version (3.10.x at the time of
  writing) and only its whitelisted plugins. This site intentionally uses **no Jekyll plugins**, so
  the local Jekyll 4.x build and the GitHub Pages build stay compatible.
- Use Jekyll's **`relative_url` filter** for internal links and assets (for example
  `{{ '/assets/css/style.css' | relative_url }}`). `baseurl` is empty because the site is served
  from the domain root; `relative_url` keeps links and assets working even on deep 404 URLs.
- Do **not** add a `.nojekyll` file. It would disable the Jekyll build.
- To deploy, push the default branch and configure the repository under **Settings → Pages → Build
  and deployment → Source: Deploy from a branch → `master` / `/ (root)`**.

## Repository layout

| Path                    | Purpose                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------- |
| `_config.yml`           | Jekyll configuration; excludes repo-only files from the published site.                                        |
| `_layouts/default.html` | Shared page shell: banner, masthead, navigation, ticker, footer.                                               |
| `index.html`            | The homepage content.                                                                                          |
| `404.html`              | GitHub Pages 404 page.                                                                                         |
| `assets/css/style.css`  | All styling (plain CSS, no Sass).                                                                              |
| `assets/js/retro.js`    | Small vanilla-JS enhancements: visitor counter, webring joke, click sparkles, optional chiptune "MIDI" toggle. |
| `assets/images/*.svg`   | Original artwork: hero scene, card fan, construction sign, badges, favicon.                                    |
| `AGENTS.md`             | This guide.                                                                                                    |
| `README.md`             | Short public-facing description.                                                                               |

## Local development

Ruby and Jekyll are installed from the Manjaro/Arch repositories:

```bash
sudo pacman -S jekyll tidy prettier
```

Serve the site with live reload:

```bash
jekyll serve --livereload
```

Then open <http://localhost:4000/>. To build only:

```bash
jekyll build
```

The generated site goes to `_site/`, which is gitignored. There is no Gemfile or bundler step.

## Checks

Build first, then validate the generated HTML and check formatting:

```bash
jekyll build
tidy -qe _site/index.html _site/404.html
prettier --check "assets/**/*.{css,js}" "*.md" "_config.yml"
```

`tidy` may report HTML5-related warnings; treat actual errors as failures and review warnings.
`prettier` is configured in `.prettierrc` and ignores HTML containing Liquid tags, plus the
Liquid-heavy layouts and includes; `tidy` covers the generated HTML.

## Content and style rules

- Keep the voice playful, warm, and a little corny. Avoid mean-spirited jokes and real personal
  information.
- The club is a toy. Do not invent real contact details, street addresses, or claims that could
  mislead. If a placeholder is ever needed, use an `.example` domain.
- All images must be original files committed to the repo. Do not hotlink images or add copyrighted
  artwork.
- No analytics, trackers, external fonts, CDNs, or third-party embeds.
- Keep the site accessible: meaningful `alt` text, semantic headings, visible focus styles,
  reduced-motion support, and readable contrast.
- Keep dependencies to zero beyond Jekyll. Prefer plain CSS and vanilla JavaScript.
- Preserve the retro aesthetic, but do not sacrifice readability on mobile.

## Git

- **Do not commit or push unless explicitly asked.**
- Keep `_site/`, `.jekyll-cache/`, editor files, and OS files out of version control.
