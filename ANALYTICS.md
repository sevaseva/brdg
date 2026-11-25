# Analytics

The site sends a small set of custom events straight to Google Analytics 4. There is no Tag Manager
container and no other tracker. This page is the single catalog of what is sent and why. The
sections in [AGENTS.md](AGENTS.md) that describe a feature mention the events it sends and link here
for the full detail.

## How it loads

- `_layouts/default.html` and `_layouts/redirect.html` include the gtag.js snippet only when
  `_config.yml` sets `google_analytics` (currently `G-Q5JZ38H0KW`). The default layout then loads
  `assets/js/analytics.js` before the page scripts, so every feature script sees the same two
  helpers.
- `window.clubTrack(name, params)` sends an event. It is a no-op when gtag is missing, so a blocked
  or stripped-down build can never break a feature.
- `window.clubTrackFailure(actionEvent, failureReason, params)` sends `action_failed` for an action
  that did not happen.

Feature scripts call both with optional chaining (`window.clubTrack?.(...)`), so a page that somehow
loads a feature without `analytics.js` still works.

## Events

| Event                 | Fires when                                     | Parameters                                               |
| --------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `movie_vote`          | a movie vote is saved                          | `movie_id`, `movie_title`                                |
| `movie_propose`       | a movie proposal is saved                      | `movie_title`, `has_pitch` (`1`/`0`)                     |
| `movie_night_vote`    | a date vote is saved                           | `movie_night_date`, `choice` (`yes`/`maybe`/`no`)        |
| `movie_night_propose` | a date proposal is saved                       | `movie_night_date`                                       |
| `movie_trailer_open`  | a trailer dialog opens                         | `movie_id`, `movie_title`                                |
| `comment_add`         | a comment is saved                             | `session`                                                |
| `comments_reply`      | a reply is saved                               | `session`                                                |
| `comments_toggle`     | the comments button shows or hides the section | `session`, `comments_state` (`shown`/`hidden`)           |
| `video_watch`         | a YouTube embed starts playing                 | `video_title`, `video_provider`, `video_id`              |
| `midi_toggle`         | the MIDI button is pressed                     | `midi_state` (`on`/`off`/`unsupported`)                  |
| `hint_show`           | a night-hike `?` hint is revealed              | `hint_label`                                             |
| `deal_play`           | **Play deal** starts a session diagram         | `session`                                                |
| `deal_control`        | a deal control is used                         | `session`, `control`, `control_target` (for `show_hide`) |
| `outbound_link`       | a link that leaves the site is clicked         | `link_domain`, `link_text`, `link_url`                   |
| `webring_click`       | a footer webring button is pressed             | `direction` (`prev`/`random`/`next`)                     |
| `action_failed`       | an action did not happen                       | `action_event`, `failure_reason`, `field`                |

Every write-backed event fires only after the write succeeds. A duplicate vote ("you already voted")
is a normal answer, not a failure, so it sends nothing.

## `action_failed` and its reasons

`action_failed` carries `action_event`, the name of the success event the action would have sent,
plus a `failure_reason`:

| `failure_reason` | Meaning                                            | Extra parameter                                             |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `write`          | the remote write was rejected or failed            | —                                                           |
| `validation`     | a field was missing, blank, too long, or malformed | `field`: `name`, `body`, `title`, `url`, `pitch`, or `date` |
| `honeypot`       | the hidden bot-trap field was filled               | —                                                           |

A save that succeeds is never reported as failed, even if a later redraw throws.

## Mechanics that matter

- `video_watch` counts real playback, not page views. YouTube posts its player state to the parent
  frame when an embed's URL carries `enablejsapi=1`, which the prep-page iframes and the trailer
  dialog add. No third-party script is loaded. One event per iframe per page load.
- `outbound_link` is one delegated listener in `analytics.js`, so every link that leaves the site is
  counted without per-link markup. Same-site links and non-HTTP links are ignored.
- `hint_show` is reported once per hint per page load, however it opened (mouse hover, keyboard
  focus, or tap).
- `deal_control` reports only explicit controls: `show_hide` (with `control_target` of `auction`,
  `ns`, `ew`, or a seat), `undo`, `restart`, and `collect_trick`. Automatic play and automatic trick
  collection send nothing.
- `comments_toggle` reports only the button, not the initial load or the retry branch that appears
  after a failed fetch.

## Privacy

No event sends a visitor's name, comment text, quoted passage, or anything else a visitor typed.
Parameters are feature data (titles, dates, IDs, contract or choice values) or the site's own link
text. GA4 itself may collect cross-browser/device signals as configured at the property level.

Custom dimensions are not registered yet. The events appear in GA4 as-is, but a parameter only shows
up in reports after it is registered as a custom, event-scoped dimension.

## Adding or changing an event

1. Call `window.clubTrack?.(name, params)` after the action succeeds, and
   `window.clubTrackFailure?.(name, reason, params)` when it fails.
2. Keep parameters low-cardinality or feature data, never user-entered text.
3. Add a row to the table above, and a one-line mention where the feature is described in
   [AGENTS.md](AGENTS.md).
4. Verify below, then build and run `prettier --check`.

## Verifying locally

- Serve with `jekyll serve` and open the page.
- In the browser console, `window.dataLayer.filter((entry) => entry[0] === 'event')` lists every
  event this page has queued, including ones gtag could not transmit.
- In GA4, use Realtime or DebugView to confirm events land, then register the parameters you want as
  custom dimensions.
- The sandbox used for automated checks cannot reach `googletagmanager.com` or YouTube, but
  `window.dataLayer` still records the events, so behavior can be verified without the network.
