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

| Path                            | Purpose                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `_config.yml`                   | Jekyll configuration; excludes repo-only files from the published site.                                                            |
| `_layouts/default.html`         | Shared page shell: banner, masthead, navigation, ticker, footer.                                                                   |
| `_layouts/session.html`         | Renders one session's notes from the `_sessions` collection.                                                                       |
| `_sessions/`                    | Session notes as Markdown, one `YYYY-MM-DD.md` file per session.                                                                   |
| `s/`                            | The study hall at `/s/`, prep at `/s/prep/`, and thin pages that expose a session at `/s/N/` and `/s/YYYY-MM-DD/`.                 |
| `bidding/`                      | Bidding landing page at `/bidding/` and the SAYC reference page at `/bidding/sayc/`.                                               |
| `index.html`                    | The homepage content.                                                                                                              |
| `404.html`                      | GitHub Pages 404 page.                                                                                                             |
| `intro.html`                    | Redirect to `/s/prep/`, kept so the old `/intro/` URL keeps working.                                                               |
| `assets/css/style.css`          | All styling (plain CSS, no Sass).                                                                                                  |
| `assets/js/retro.js`            | Small vanilla-JS enhancements: visitor counter, webring joke, click sparkles, and an autoplaying, toggleable chiptune "MIDI" tune. |
| `assets/js/session-comments.js` | Text-selection comments on session notes, backed by Firebase.                                                                      |
| `assets/images/*.svg`           | Original artwork: hero scene, card fan, construction sign, badges, favicon, moon-hike scene.                                       |
| `assets/images/robson.webp`     | Robson Level 1 course thumbnail used on the prep page.                                                                             |
| `.github/workflows/pages.yml`   | Regenerates the almanac, builds Jekyll, and deploys to GitHub Pages.                                                               |
| `package.json`                  | Build-tooling dependencies (`astronomy-engine`, `satellite.js`) and the generator and moon-sun scripts.                            |
| `scripts/moon-sun-cli/`         | Standalone terrain-aware and sea-level sun/moon rise/set CLI; not used by the website build.                                       |
| `NIGHT.md`                      | The night-hike guide: almanac rules, sky panels, forecasts, estimates.                                                             |
| `AGENTS.md`                     | This guide.                                                                                                                        |

The night-hike page and generator files (`night-hikes.html`, `assets/js/night-hikes*.js`,
`assets/data/night-hikes.json`, `scripts/night-hikes*`) are listed in [NIGHT.md](NIGHT.md).

## Session notes

Session notes are Markdown files in `_sessions/`, named for the date of the session
(`YYYY-MM-DD.md`). Each file starts with front matter:

```yaml
---
session: 1
date: 2026-11-12
title: Session 1
description: A one-line description for the page metadata.
---
```

`session` is the short number used in `/s/N/`; `date` is the date of that session, used in
`/s/YYYY-MM-DD/`. The collection itself is not output. To publish a session, add two thin pages in
`s/`:

- `s/N.html` with `layout: session`, `session: N`, `body_class: session-page`, and
  `permalink: /s/N/`
- `s/YYYY-MM-DD.html` with the same values and `permalink: /s/YYYY-MM-DD/`

Both pages render the same collection document, so do not put note text in them. The session layout
exposes the session number and date as data attributes for features that need a stable page key.

Every session page carries `<link rel="canonical">` pointing at `/s/N/`, so search engines fold the
dated URL into the short one. The layout derives it from the page's `session` front matter (an
explicit `canonical:` in front matter still wins), and builds the absolute URL with `site.url` from
`_config.yml`, which must stay in step with the `CNAME` file.

`s/index.html` (permanent URL `/s/`) is the study hall: one column of learning material, newest
first. It loops over `site.sessions` sorted newest-first, so the latest session is at the top, and
puts the prep page `s/prep.html` (`/s/prep/`) at the bottom. That ordering is deliberate: read down
from the top for a refresher, or start at the bottom and work up to go through everything from the
beginning. Each session links both its short `/s/N/` address and its dated `/s/YYYY-MM-DD/` address.
The list is plain Liquid, not a collection document, so it needs no per-session edit.

The bidding system is deliberately off that ladder. `bidding/sayc.html` (`/bidding/sayc/`) holds the
two ACBL SAYC booklets — one laid out for Letter paper, one for printing as a booklet — and is where
the club's own system notes can grow. `bidding/index.html` (`/bidding/`) is a deliberately short,
jokey placeholder for bidding material in general, with a single link to SAYC and room for
conventions and cheat sheets later. The study hall links straight to `/bidding/sayc/` from a
separate "Reference Shelf" panel (`panel--alt`), visually apart from the sequence; for now the only
link to `/bidding/` is the "← Bidding" crumb on the SAYC page.

The main navigation is deliberately minimal: Home, Study hall, and Night hikes. The study hall
itself routes to prep (its bottom card) and the latest session (its top card), so the menu never
needs to list individual sessions. `/intro/` is a minimal redirect page with a canonical link to
`/s/prep/`, so old links and search results still land in the right place.

Session pages also load `assets/js/session-comments.js` through the `scripts:` front matter; no
other page loads it.

### Session comments

Readers can select a passage of the notes and attach a public comment to it. Comments are stored in
a Firebase Realtime Database at `https://brdg-lol-default-rtdb.firebaseio.com/`, under
`/comments/<session>/<comment>/` and `/replies/<session>/<comment>/<reply>/`. They are public and
immutable: the rules allow reads and create-only writes, so there is no edit or delete path from the
browser. The rules live in the Firebase console; there is no copy in the repository, because they
are not used at build time.

- A comment stores the session number (from front matter), the name, the body, the quoted passage,
  60 characters of context on each side, and zero-based offsets into a plain-text copy of the notes.
  The quote is the real anchor; the offsets are a fast path. Re-resolution tries the exact quote at
  the old offset, then the exact quote anywhere, then a whitespace-insensitive match, and otherwise
  shows the thread in a "Comments that lost their place" section. There is no fuzzy matching.
- The browser generates its own UUID key and issues `PUT` requests, because the rules grant write
  permission per comment rather than per collection.
- A hidden comment section makes no database requests at all. The toggle is the only thing that
  runs, and the first "Show comments" click fetches and renders. Hiding and showing again reuses
  everything that was already fetched and calculated; only a reload picks up new comments.
- Clicking a highlighted passage briefly flashes the comment it belongs to, and clicking a comment
  pulses the passage it was written on.
- Preferences use `comments:<session>` in `localStorage` (`"hidden"` when hidden, absent when shown)
  and `user:name` for the remembered display name.
- Comments print inline after their passage, and only while they are shown. The toggle, forms, and
  selection button are print-hidden.
- The session layout wraps `♥` and `♦` in `<span class="suit suit--red">` so the red suits render
  red; the Markdown keeps plain suit characters.
- Because the rules forbid deletes, test comments can only be removed from the Firebase console.

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
tidy -qe _site/index.html _site/404.html _site/intro/index.html _site/night-hikes/index.html \
  _site/s/index.html _site/s/prep/index.html _site/s/1/index.html _site/s/2026-11-12/index.html \
  _site/bidding/index.html _site/bidding/sayc/index.html
prettier --check "assets/**/*.{css,js}" "scripts/**/*.mjs" "scripts/**/*.json" "scripts/**/*.md" "package.json" "*.md" "_config.yml"
```

If you changed the night-hike generator or its config, run its checks first; they are in
[NIGHT.md](NIGHT.md).

`tidy` may report HTML5-related warnings; treat actual errors as failures and review warnings.
`prettier` is configured in `.prettierrc` and ignores the Liquid-heavy pages, layouts, and includes
listed in `.prettierignore`; `tidy` covers the generated HTML. The generated
`assets/data/night-hikes.json` is deliberately not on the prettier list because it is
machine-written and large.

## What is real and what is invented

The site deliberately mixes three kinds of content. Match the writing to the kind:

- **Study material** — the study hall (`/s/`), prep (`/s/prep/`), the session notes (`/s/N/` and
  `/s/YYYY-MM-DD/`), and the bidding pages (`/bidding/`, `/bidding/sayc/`). This part is real: the
  sessions happen, the notes describe what was actually covered, and SAYC is a real system. Keep it
  factually correct, because a beginner will trust it, while keeping the playful voice and the
  jokes. A joke must never change a rule, a number, or a fact. Call the real gatherings **sessions**
  on these pages.
- **The fictional club** — `index.html` and the club fiction around it. The Cobb Bridge Club is a
  character, not a factual record of a real organisation: the meeting time is a guarded secret, the
  regulars are invented, and the news is gossip. This copy can be as loose and silly as it likes,
  and it should not try to teach real bridge; the "Learn Bridge in Four Easy Bids" panel is a joke,
  and a small note points to the study hall for the real thing. The word **meeting** fits the
  fiction better here; keep the homepage light.
- **The night-hike almanac** — `/night-hikes/`. Unrelated to bridge and included purely for fun, but
  the data on it is real: the almanac, sky panels, weather, air quality, and aurora forecasts are
  computed from actual sources. Joke in the prose, never in the numbers. Details are in
  [NIGHT.md](NIGHT.md).

When a page crosses zones — a homepage joke that links into the study hall, or a session note that
mentions the club — keep the fiction in the club's voice and let the study page carry the accurate
detail. When in doubt about a number or a rule, the study pages win.

## Content and style rules

- Keep the voice playful, warm, and a little corny. Avoid mean-spirited jokes and real personal
  information.
- The club is a toy. Do not invent real contact details, street addresses, or claims that could
  mislead.
- All images must be original files committed to the repo. Do not hotlink images or add copyrighted
  artwork.
- There are currently no analytics, no trackers, no external fonts, no CDNs, and no third-party
  embeds (exceptions: the `/s/prep/` videos, the night-hike page's live weather/air/aurora fetches
  described in [NIGHT.md](NIGHT.md), and the SAYC page's links to the ACBL booklets, which are
  ordinary outward links rather than embeds). Those can be added/used but do check explicitly with
  the human/operator before introducing them.
- Keep the site accessible: meaningful `alt` text, semantic headings, visible focus styles,
  reduced-motion support, and readable contrast.
- Preserve the retro aesthetic, but do not sacrifice readability on mobile.

## Git

- **Do not commit unless explicitly asked.** **Do not push unless explicitly asked.**
- Follow the **50/72 rule** for commit messages: a subject line of at most 50 characters, a blank
  line, then body lines of at most 72 characters.
