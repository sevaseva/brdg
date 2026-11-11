# AGENTS.md

This repository is the website for the **Cobb Bridge Club**, a friendly (and slightly fictional)
beginner bridge club in Cobb, California. It is a hand-built Jekyll site with a deliberately retro,
late-1990s look: neon colors, beveled panels, a scrolling ticker, a chalkboard bulletin, and
original SVG artwork.

The night-hike almanac has its own guide: **[NIGHT.md](NIGHT.md)**. It covers the generator, the sky
panels, the live conditions, the Milky Way rules, and how the forecasts and estimates work.

## Deployment model

- The site is deployed by a **custom GitHub Actions Jekyll workflow**
  (`.github/workflows/pages.yml`). The workflow installs the small Node build-tooling dependency,
  regenerates the 90-day night-hike almanac and sky forecast (every three days, and on every push),
  builds the site with Jekyll, and deploys the result to GitHub Pages. See [NIGHT.md](NIGHT.md) for
  the almanac itself.
- This switch was made because the night-hike chart is generated at build time, which the native
  GitHub Pages build cannot do. The workflow uses GitHub's official Pages actions
  (`configure-pages`, `upload-pages-artifact`, `deploy-pages`) and still uses **no Jekyll plugins**.
- The build installs a **pinned Jekyll** (`gem install jekyll -v 4.4.1`) on Ruby 3.4 instead of
  using `actions/jekyll-build-pages`. That action wraps the `github-pages` gem, which is still on
  Jekyll 3.10.0 and Ruby 3.3, forces `safe: true`, and injects the Pages default theme and plugins.
  A one-off comparison built this site with both and produced identical output, but the two Jekyll
  majors drift on Sass modules (`@use`), any plugin, and markdown pages without front matter. Pages
  only serves static artifacts here, so matching the local version is the safer default.
- Keep the workflow's Jekyll version in step with the local `jekyll -v`. When upgrading Jekyll
  locally, bump the `gem install jekyll -v` line in the same commit; a mismatch reintroduces the
  silent local-vs-CI drift the pin is meant to prevent.
- The repository also contains a committed copy of `assets/data/night-hikes.json` so a plain local
  `jekyll serve` has data even before the generator is run. Details in [NIGHT.md](NIGHT.md).
- Use Jekyll's **`relative_url` filter** for internal links and assets (for example
  `{{ '/assets/css/style.css' | relative_url }}`). `baseurl` is empty because the site is served
  from the domain root; `relative_url` keeps links and assets working even on deep 404 URLs. Keep
  this rule under any deployment model.
- Do **not** add a `.nojekyll` file. It would disable the Jekyll build.
- Deploying is a **human/operator task**, not an agent one. A person must push the default branch
  and configure the repository under **Settings → Pages → Build and deployment → Source: GitHub
  Actions**. Agents cannot change repository settings: just report what is needed and leave the
  click-through to the human.

## Repository layout

| Path                          | Purpose                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `_config.yml`                 | Jekyll configuration; excludes repo-only files from the published site.                                                            |
| `_layouts/default.html`       | Shared page shell: banner, masthead, navigation, ticker, footer.                                                                   |
| `index.html`                  | The homepage content.                                                                                                              |
| `404.html`                    | GitHub Pages 404 page.                                                                                                             |
| `intro.html`                  | Intro page with lazy-loaded YouTube embeds.                                                                                        |
| `assets/css/style.css`        | All styling (plain CSS, no Sass).                                                                                                  |
| `assets/js/retro.js`          | Small vanilla-JS enhancements: visitor counter, webring joke, click sparkles, and an autoplaying, toggleable chiptune "MIDI" tune. |
| `assets/images/*.svg`         | Original artwork: hero scene, card fan, construction sign, badges, favicon, moon-hike scene.                                       |
| `assets/images/robson.webp`   | Robson Level 1 course thumbnail used on the intro page.                                                                            |
| `.github/workflows/pages.yml` | Regenerates the almanac, builds Jekyll, and deploys to GitHub Pages.                                                               |
| `package.json`                | Build-tooling dependencies (`astronomy-engine`, `satellite.js`) and the generator script.                                          |
| `NIGHT.md`                    | The night-hike guide: almanac rules, sky panels, forecasts, estimates.                                                             |
| `AGENTS.md`                   | This guide.                                                                                                                        |

The night-hike page and generator files (`night-hikes.html`, `assets/js/night-hikes*.js`,
`assets/data/night-hikes.json`, `scripts/night-hikes*`) are listed in [NIGHT.md](NIGHT.md).

## Local development

Ruby and Jekyll come from the Manjaro/Arch repositories. Installing them is a **one-time
human/operator task**; agents should not run the `sudo` install unless explicitly asked, and should
report missing tools instead:

```bash
sudo pacman -S jekyll tidy prettier
```

The night-hike generator needs Node 26 or newer. See [NIGHT.md](NIGHT.md) for installing and running
it, and for the summer-chart test recipe.

Agents can then serve the site with live reload:

```bash
jekyll serve --livereload
```

Note: During a development session/collaboration of a human and an agent, there is no need to stop
that server every time when the agent finished work for one human's prompt. Instad the agent should
keep that local dev server running and use it in the next steps in the development session.

Then open <http://localhost:4000/>. The almanac lives at <http://localhost:4000/night-hikes/>.

To build only:

```bash
jekyll build
```

The generated site goes to `_site/`, which is gitignored. There is no Gemfile or bundler step; npm
is only for the build-time night-hike generator, not for the browser.

## Checks

Build, then validate the generated HTML and check formatting:

```bash
jekyll build
tidy -qe _site/index.html _site/404.html _site/intro/index.html _site/night-hikes/index.html
prettier --check "assets/**/*.{css,js}" "scripts/**/*.mjs" "scripts/**/*.json" "package.json" "*.md" "_config.yml"
```

If you changed the night-hike generator or its config, run its checks first; they are in
[NIGHT.md](NIGHT.md).

`tidy` may report HTML5-related warnings; treat actual errors as failures and review warnings.
`prettier` is configured in `.prettierrc` and ignores the Liquid-heavy pages, layouts, and includes
listed in `.prettierignore`; `tidy` covers the generated HTML. The generated
`assets/data/night-hikes.json` is deliberately not on the prettier list because it is
machine-written and large.

## Content and style rules

- Keep the voice playful, warm, and a little corny. Avoid mean-spirited jokes and real personal
  information.
- The club is a toy. Do not invent real contact details, street addresses, or claims that could
  mislead.
- All images must be original files committed to the repo. Do not hotlink images or add copyrighted
  artwork.
- There are currently no analytics, no trackers, no external fonts, no CDNs, and no third-party
  embeds (exceptions: the `/intro` videos and the night-hike page's live weather/air/aurora fetches,
  described in [NIGHT.md](NIGHT.md)). Those can be added/used but do check explicitly check with the
  human/operator before introducing them.
- Keep the site accessible: meaningful `alt` text, semantic headings, visible focus styles,
  reduced-motion support, and readable contrast.
- Preserve the retro aesthetic, but do not sacrifice readability on mobile.

## Git

- **Do not commit unless explicitly asked.** **Do not push unless explicitly asked.**
- Follow the **50/72 rule** for commit messages: a subject line of at most 50 characters, a blank
  line, then body lines of at most 72 characters.
