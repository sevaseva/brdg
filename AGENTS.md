# AGENTS.md

This repository is the website for the **Cobb Bridge Club**, a friendly (and slightly fictional)
beginner bridge club in Cobb, California. It is a hand-built Jekyll site with a deliberately retro,
late-1990s look: neon colors, beveled panels, a scrolling ticker, a chalkboard bulletin, and
original SVG artwork.

## Deployment model

- The site is currently deployed by **GitHub Pages' zero-config, native/classic Jekyll build**: the
  default branch is built automatically, with no GitHub Actions workflow involved.
- That is a convenient default, **not a hard constraint**. If a new feature needs something the
  native build cannot provide (extra Jekyll plugins, a newer Jekyll version, Sass or other build
  tooling, generated assets, post-build checks), feel free to switch to a **custom GitHub Actions
  Jekyll build workflow** and update this guide and `_config.yml` accordingly.
- While the native build is in use, GitHub Pages builds the default branch with its managed Jekyll
  version (3.10.x at the time of writing) and only its whitelisted plugins. The site intentionally
  uses **no Jekyll plugins**, so the local Jekyll 4.x build and the GitHub Pages build stay
  compatible. Any move away from that should come with the custom workflow described above.
- Use Jekyll's **`relative_url` filter** for internal links and assets (for example
  `{{ '/assets/css/style.css' | relative_url }}`). `baseurl` is empty because the site is served
  from the domain root; `relative_url` keeps links and assets working even on deep 404 URLs. Keep
  this rule under any deployment model.
- Do **not** add a `.nojekyll` file. It would disable the Jekyll build.
- Deploying with the current setup is a **human/operator task**, not an agent one. A person must
  push the default branch and configure the repository under **Settings → Pages → Build and
  deployment → Source: Deploy from a branch → `master` / `/ (root)`** (or switch the source to
  **GitHub Actions** if a custom workflow is introduced). Agents cannot change repository settings:
  just report what is needed and leave the click-through to the human.

## Repository layout

| Path                        | Purpose                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `_config.yml`               | Jekyll configuration; excludes repo-only files from the published site.                                                            |
| `_layouts/default.html`     | Shared page shell: banner, masthead, navigation, ticker, footer.                                                                   |
| `index.html`                | The homepage content.                                                                                                              |
| `404.html`                  | GitHub Pages 404 page.                                                                                                             |
| `intro.html`                | Intro page with lazy-loaded YouTube embeds.                                                                                        |
| `assets/css/style.css`      | All styling (plain CSS, no Sass).                                                                                                  |
| `assets/js/retro.js`        | Small vanilla-JS enhancements: visitor counter, webring joke, click sparkles, and an autoplaying, toggleable chiptune "MIDI" tune. |
| `assets/images/*.svg`       | Original artwork: hero scene, card fan, construction sign, badges, favicon.                                                        |
| `assets/images/robson.webp` | Robson Level 1 course thumbnail used on the intro page.                                                                            |
| `AGENTS.md`                 | This guide.                                                                                                                        |

## Local development

Ruby and Jekyll come from the Manjaro/Arch repositories. Installing them is a **one-time
human/operator task**; agents should not run the `sudo` install unless explicitly asked, and should
report missing tools instead:

```bash
sudo pacman -S jekyll tidy prettier
```

Agents can then serve the site with live reload:

```bash
jekyll serve --livereload
```

Note: During a development session/collaboration of a human and an agent, there is no need to stop that server every time when the agent finished work for one human's prompt. Instad the agent should keep that local dev server running and use it in the next steps in the development session.

Then open <http://localhost:4000/>.

To build only:

```bash
jekyll build
```

The generated site goes to `_site/`, which is gitignored. There is no Gemfile or bundler step.

## Checks

Build first, then validate the generated HTML and check formatting:

```bash
jekyll build
tidy -qe _site/index.html _site/404.html _site/intro/index.html
prettier --check "assets/**/*.{css,js}" "*.md" "_config.yml"
```

`tidy` may report HTML5-related warnings; treat actual errors as failures and review warnings.
`prettier` is configured in `.prettierrc` and ignores the Liquid-heavy pages, layouts, and includes
listed in `.prettierignore`; `tidy` covers the generated HTML.

## Content and style rules

- Keep the voice playful, warm, and a little corny. Avoid mean-spirited jokes and real personal
  information.
- The club is a toy. Do not invent real contact details, street addresses, or claims that could
  mislead.
- All images must be original files committed to the repo. Do not hotlink images or add copyrighted
  artwork.
- There are currently no analytics, no trackers, no external fonts, no CDNs, and no third-party embeds (exception: /intro with embedded youtube videos). Those can be added/used but do check explicitly check with the human/operator before introducing them.
- Keep the site accessible: meaningful `alt` text, semantic headings, visible focus styles,
  reduced-motion support, and readable contrast.
- Preserve the retro aesthetic, but do not sacrifice readability on mobile.

## Git

- **Do not commit unless explicitly asked.** **Do not push unless explicitly asked.**
