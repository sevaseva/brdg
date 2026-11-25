/* Movie-night planning board.

   Proposals and votes live in the club's public Firebase Realtime Database,
   under /movie-nights. Everything is append-only: a proposal or a vote cannot
   be edited or deleted from the browser. That keeps the rules simple and the
   board honest.

   Votes are keyed by a normalized name, so one name is one ballot. The board
   loads once and stays put; reload the page to see new votes from elsewhere. */
(() => {
  'use strict';

  const DATABASE = 'https://brdg-lol-default-rtdb.firebaseio.com';
  const ROOT = 'movie-nights';
  const NAME_KEY = 'user:name';
  const MAX_NAME = 40;
  const MAX_TITLE = 80;
  const MAX_PITCH = 2000;
  const MAX_URL = 300;
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
  const CHOICES = ['yes', 'maybe', 'no'];
  const YOUTUBE_HOSTS = new Set([
    'youtube.com',
    'www.youtube.com',
    'm.youtube.com',
    'music.youtube.com',
    'youtu.be',
    'youtube-nocookie.com',
    'www.youtube-nocookie.com',
  ]);

  const nameInput = document.querySelector('[data-voter-name]');
  const voterStatus = document.querySelector('[data-voter-status]');
  const liveStatus = document.querySelector('[data-live-status]');

  const moviesList = document.querySelector('[data-movies]');
  const moviesStatus = document.querySelector('[data-movies-status]');
  const movieVoteStatus = document.querySelector('[data-movie-vote-status]');

  const datesList = document.querySelector('[data-dates]');
  const datesStatus = document.querySelector('[data-dates-status]');
  const dateVoteStatus = document.querySelector('[data-date-vote-status]');

  const movieForm = document.querySelector('[data-movie-form]');
  const movieSubmit = document.querySelector('[data-movie-submit]');
  const movieWarning = document.querySelector('[data-movie-warning]');
  const movieStatus = document.querySelector('[data-movie-status]');
  const moviePitchCount = document.querySelector('[data-movie-pitch-count]');

  const dateForm = document.querySelector('[data-date-form]');
  const dateSubmit = document.querySelector('[data-date-submit]');
  const dateWarning = document.querySelector('[data-date-warning]');
  const dateStatus = document.querySelector('[data-date-status]');
  const dateInput = document.querySelector('[data-date-input]');

  const dialog = document.querySelector('[data-trailer-dialog]');
  const trailerTitle = document.querySelector('[data-trailer-title]');
  const trailerFrame = document.querySelector('[data-trailer-frame]');
  const trailerLink = document.querySelector('[data-trailer-link]');
  const trailerClose = document.querySelector('[data-trailer-close]');

  if (!nameInput || !moviesList || !datesList || !movieForm || !dateForm) return;

  const reservedAnchors = new Set(['top', 'main']);

  for (const node of document.querySelectorAll('[id]')) {
    reservedAnchors.add(node.id);
  }

  const pitchInput = movieForm.elements.namedItem('pitch');

  function updatePitchCount() {
    if (!moviePitchCount || !pitchInput) return;

    moviePitchCount.textContent = `${pitchInput.value.length} / ${MAX_PITCH}`;
  }

  if (pitchInput) {
    pitchInput.addEventListener('input', updatePitchCount);
    movieForm.addEventListener('reset', () => {
      window.setTimeout(updatePitchCount, 0);
    });
    updatePitchCount();
  }

  const collator = new Intl.Collator('en', { sensitivity: 'base' });
  const longDate = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const weekdayFormat = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
  const monthDayFormat = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });
  const yearFormat = new Intl.DateTimeFormat('en-US', { year: 'numeric' });
  const proposedFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  let movies = [];
  let dates = [];
  let movieAnchors = new Map();
  let dateAnchors = new Map();
  let movieVotes = {};
  let dateVotes = {};
  let loaded = false;
  let loading = false;
  let movieArmed = false;
  let dateArmed = false;
  const savingMovies = new Set();
  const savingDates = new Set();

  // -------------------------------------------------------------------------
  // Small helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function cleanName(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : 'Anonymous';
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function announce(message) {
    if (!liveStatus) return;
    liveStatus.textContent = '';
    window.setTimeout(() => {
      liveStatus.textContent = message;
    }, 30);
  }

  // Analytics is a nice-to-have: a missing or blocked analytics.js must never
  // stop a vote or a proposal from being saved. ANALYTICS.md lists the events.
  function track(name, params) {
    window.clubTrack?.(name, params);
  }

  function trackFailure(actionEvent, failureReason, params) {
    window.clubTrackFailure?.(actionEvent, failureReason, params);
  }

  function slugify(value) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  function normalizeTitle(value) {
    const normalized = value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    return normalized || value.toLowerCase().trim();
  }

  function assignAnchors(items, baseFor, used, allowDate, order) {
    const anchors = new Map();

    for (const item of [...items].sort(order)) {
      const base = baseFor(item) || `item-${item.id.slice(0, 8)}`;
      let anchor = base;
      let suffix = 2;

      while (
        used.has(anchor) ||
        /^\d+$/.test(anchor) ||
        /^date-\d+$/.test(anchor) ||
        (!allowDate && DATE_RE.test(anchor))
      ) {
        anchor = `${base}-${suffix}`;
        suffix += 1;
      }

      used.add(anchor);
      anchors.set(item.id, anchor);
    }

    return anchors;
  }

  function rebuildAnchors() {
    const used = new Set(reservedAnchors);

    movieAnchors = assignAnchors(
      movies,
      (movie) => slugify(movie.title),
      used,
      false,
      (left, right) =>
        left.createdAt - right.createdAt || collator.compare(left.title, right.title),
    );
    dateAnchors = assignAnchors(
      dates,
      (date) => date.date,
      used,
      true,
      (left, right) => left.date.localeCompare(right.date) || left.createdAt - right.createdAt,
    );
  }

  function todayString() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate(),
    ).padStart(2, '0')}`;
  }

  function parseDate(value) {
    if (typeof value !== 'string' || !DATE_RE.test(value)) return null;

    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }

    return date;
  }

  function formatDate(value) {
    const date = parseDate(value);
    return date ? longDate.format(date) : value;
  }

  function proposedOn(value) {
    return value ? proposedFormat.format(new Date(value)) : '';
  }

  function currentSlug() {
    return slugify(nameInput.value.trim());
  }

  function nameProblem(name) {
    if (!name) return 'Add your name first so the club knows whose vote this is.';
    if (name.length > MAX_NAME) return 'That name is a little too long.';
    if (!slugify(name)) return 'Please use at least one letter or number in your name.';
    return '';
  }

  function requireVoter(actionEvent) {
    const name = nameInput.value.trim();
    const problem = nameProblem(name);

    if (problem) {
      voterStatus.textContent = problem;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      nameInput.scrollIntoView({
        block: 'center',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
      trackFailure(actionEvent, 'validation', { field: 'name' });
      return null;
    }

    nameInput.removeAttribute('aria-invalid');
    voterStatus.textContent = '';
    return { name, slug: slugify(name) };
  }

  function readStoredName() {
    try {
      return window.localStorage.getItem(NAME_KEY) || '';
    } catch {
      return '';
    }
  }

  function rememberName(name) {
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch {
      // A blocked storage API just means the name is not pre-filled next time.
    }
  }

  function forgetName() {
    try {
      window.localStorage.removeItem(NAME_KEY);
    } catch {
      // Nothing to do.
    }
  }

  // -------------------------------------------------------------------------
  // YouTube links
  // -------------------------------------------------------------------------

  function videoIdFrom(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (YOUTUBE_ID.test(raw)) return raw;

    let candidate = raw;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

    let url;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!YOUTUBE_HOSTS.has(host)) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    let id = '';

    if (host === 'youtu.be') {
      id = parts[0] || '';
    } else if (parts[0] === 'watch') {
      id = url.searchParams.get('v') || '';
    } else if (['shorts', 'embed', 'live', 'v', 'e'].includes(parts[0])) {
      id = parts[1] || '';
    }

    return YOUTUBE_ID.test(id) ? id : null;
  }

  function openTrailer(movie) {
    if (!dialog || !trailerFrame || !YOUTUBE_ID.test(movie.videoId || '')) return;

    trailerTitle.textContent = movie.title;
    trailerLink.href = `https://www.youtube.com/watch?v=${movie.videoId}`;
    trailerFrame.replaceChildren();

    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube-nocookie.com/embed/${movie.videoId}?autoplay=1&rel=0&enablejsapi=1`;
    iframe.title = `Trailer for ${movie.title}`;
    iframe.dataset.videoId = movie.videoId;
    iframe.dataset.videoTitle = movie.title;
    iframe.allow =
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    trailerFrame.append(iframe);

    dialog.showModal();
    if (trailerClose) trailerClose.focus();

    track('movie_trailer_open', { movie_id: movie.id, movie_title: movie.title });
  }

  if (dialog) {
    dialog.addEventListener('close', () => {
      if (trailerFrame) trailerFrame.replaceChildren();
    });

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  }

  if (trailerClose && dialog) {
    trailerClose.addEventListener('click', () => dialog.close());
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  function api(path) {
    return `${DATABASE}/${ROOT}${path ? `/${path}` : ''}.json`;
  }

  async function fetchJson(path) {
    const response = await fetch(api(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function putJson(path, payload) {
    const response = await fetch(api(path), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  function records(value) {
    if (!value || typeof value !== 'object') return [];
    return Object.entries(value)
      .filter(([, item]) => item && typeof item === 'object')
      .map(([id, item]) => ({ id, ...item }));
  }

  function voteGroups(value) {
    const groups = {};
    if (!value || typeof value !== 'object') return groups;

    for (const [id, group] of Object.entries(value)) {
      if (group && typeof group === 'object') groups[id] = group;
    }

    return groups;
  }

  function setStatus(element, message) {
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
  }

  function showLoadError() {
    loading = false;

    for (const status of [moviesStatus, datesStatus]) {
      if (!status) continue;
      status.replaceChildren();
      status.hidden = false;
      status.append(
        document.createTextNode('The projector jammed. Give it another go in a moment. '),
      );
      const retry = el('button', 'movie-board__retry', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', () => void load());
      status.append(retry);
    }

    moviesList.replaceChildren();
    datesList.replaceChildren();
  }

  async function load() {
    if (loaded || loading) return;

    loading = true;
    setStatus(moviesStatus, 'Threading the projector…');
    setStatus(datesStatus, 'Checking the calendar…');

    try {
      const data = (await fetchJson('')) || {};

      movies = records(data.movies)
        .filter((movie) => typeof movie.title === 'string' && movie.title.trim())
        .map((movie) => ({
          id: movie.id,
          title: movie.title.trim(),
          videoId: typeof movie.videoId === 'string' ? movie.videoId : '',
          name: cleanName(movie.name),
          pitch: typeof movie.pitch === 'string' ? movie.pitch.trim() : '',
          createdAt: numberOrZero(movie.createdAt),
        }));

      dates = records(data.dates)
        .filter((date) => typeof date.date === 'string' && DATE_RE.test(date.date))
        .map((date) => ({
          id: date.id,
          date: date.date,
          name: cleanName(date.name),
          createdAt: numberOrZero(date.createdAt),
        }));

      movieVotes = voteGroups(data.votes);
      dateVotes = voteGroups(data.dateVotes);

      setStatus(moviesStatus, '');
      setStatus(datesStatus, '');
      movieForm.hidden = false;
      dateForm.hidden = false;
      if (dateInput) dateInput.min = todayString();

      renderMovies();
      renderDates();
      updateVoteControls();
      loaded = true;
      focusHashTarget();
    } catch {
      showLoadError();
    } finally {
      loading = false;
    }
  }

  // -------------------------------------------------------------------------
  // Vote records
  // -------------------------------------------------------------------------

  function movieVoteRecords(id) {
    const group = movieVotes[id];
    if (!group || typeof group !== 'object') return [];

    return Object.values(group).filter(
      (vote) =>
        vote && typeof vote === 'object' && typeof vote.name === 'string' && vote.name.trim(),
    );
  }

  function dateTally(id) {
    const tally = { yes: [], maybe: [], no: [] };
    const group = dateVotes[id];
    if (!group || typeof group !== 'object') return tally;

    for (const vote of Object.values(group)) {
      if (!vote || typeof vote !== 'object') continue;
      if (!CHOICES.includes(vote.choice)) continue;
      if (typeof vote.name !== 'string' || !vote.name.trim()) continue;
      tally[vote.choice].push(vote.name.trim());
    }

    for (const choice of CHOICES) tally[choice].sort(collator.compare);
    return tally;
  }

  function movieById(id) {
    return movies.find((movie) => movie.id === id) || null;
  }

  function dateById(id) {
    return dates.find((date) => date.id === id) || null;
  }

  function movieCardFor(id) {
    return (
      [...moviesList.querySelectorAll('[data-movie-id]')].find(
        (card) => card.dataset.movieId === id,
      ) || null
    );
  }

  function dateCardFor(id) {
    return (
      [...datesList.querySelectorAll('[data-date-id]')].find(
        (card) => card.dataset.dateId === id,
      ) || null
    );
  }

  function focusCard(card) {
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }

  function focusHashTarget() {
    if (!window.location.hash || window.location.hash.length < 2) {
      return;
    }

    let id;

    try {
      id = decodeURIComponent(window.location.hash.slice(1));
    } catch {
      return;
    }

    const target = document.getElementById(id);

    if (!target) {
      return;
    }

    target.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });

    for (const node of document.querySelectorAll('.is-hash-target')) {
      node.classList.remove('is-hash-target');
    }

    const card = target.closest('.movie-card, .date-card');

    if (card) {
      card.classList.add('is-hash-target');
      card.focus({ preventScroll: true });
    }
  }

  window.addEventListener('hashchange', focusHashTarget);

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function emptyState(message) {
    return el('p', 'movie-board__empty', message);
  }

  function movieVoteButton(movie) {
    const button = el('button', 'vote-button');
    button.type = 'button';
    button.dataset.movieVote = movie.id;
    button.addEventListener('click', () => void voteMovie(movie.id));
    applyMovieVoteState(button, movie);
    return button;
  }

  function applyMovieVoteState(button, movie) {
    const slug = currentSlug();
    const voted = Boolean(slug && movieVotes[movie.id] && movieVotes[movie.id][slug]);
    const saving = savingMovies.has(movie.id);

    button.disabled = voted || saving;
    button.setAttribute('aria-pressed', voted ? 'true' : 'false');
    button.classList.toggle('is-voted', voted);
    button.textContent = saving ? 'Saving…' : voted ? 'Voted ✓' : 'Vote';
    button.setAttribute(
      'aria-label',
      saving
        ? `Saving your vote for ${movie.title}`
        : voted
          ? `You voted for ${movie.title}`
          : `Vote for ${movie.title}`,
    );
  }

  function movieMeter(count, max) {
    const meter = el('div', 'vote-meter');
    meter.setAttribute('role', 'img');
    meter.setAttribute('aria-label', count === 1 ? '1 vote' : `${count} votes`);

    let filled = 0;
    if (max > 0 && count > 0) {
      filled = Math.max(1, Math.min(10, Math.round((count / max) * 10)));
    }

    for (let index = 0; index < 10; index += 1) {
      meter.append(el('span', `vote-meter__block${index < filled ? ' is-on' : ''}`));
    }

    return meter;
  }

  function pitchParagraphs(text) {
    return text
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.replace(/\s*\r?\n\s*/g, ' ').trim())
      .filter(Boolean);
  }

  function movieCard(movie, rank, count, max, anchor) {
    const card = el('article', 'movie-card');
    card.tabIndex = -1;
    card.dataset.movieId = movie.id;

    if (anchor) {
      card.id = anchor;
    }

    const rankAnchor = el('span', 'anchor-target');
    rankAnchor.id = String(rank + 1);
    rankAnchor.setAttribute('aria-hidden', 'true');
    card.append(rankAnchor);

    const rankBadge = el('span', 'movie-card__rank', String(rank + 1).padStart(2, '0'));
    rankBadge.setAttribute('aria-hidden', 'true');
    card.append(rankBadge);

    const main = el('div', 'movie-card__main');
    main.append(el('h3', 'movie-card__title', movie.title));

    const meta = [`Proposed by ${movie.name}`];
    const proposed = proposedOn(movie.createdAt);
    if (proposed) meta.push(proposed);
    main.append(el('p', 'movie-card__meta', meta.join(' · ')));

    if (movie.pitch) {
      const pitch = el('div', 'movie-card__pitch');

      for (const paragraph of pitchParagraphs(movie.pitch)) {
        pitch.append(el('p', null, paragraph));
      }

      main.append(pitch);
    }

    const bottom = el('div', 'movie-card__bottom');
    const actions = el('div', 'movie-card__actions');

    if (YOUTUBE_ID.test(movie.videoId)) {
      const trailer = el('button', 'trailer-button', '▶ Play trailer');
      trailer.type = 'button';
      trailer.setAttribute('aria-label', `Play the trailer for ${movie.title}`);
      trailer.addEventListener('click', () => openTrailer(movie));
      actions.append(trailer);
    }

    actions.append(movieVoteButton(movie));

    const summary = el('div', 'vote-summary');
    const countLine = el('p', 'vote-summary__count');
    countLine.append(
      el('strong', '', String(count)),
      document.createTextNode(count === 1 ? ' vote' : ' votes'),
    );
    summary.append(countLine, movieMeter(count, max));

    const names = movieVoteRecords(movie.id)
      .map((vote) => vote.name.trim())
      .sort(collator.compare);

    if (names.length) {
      const details = el('details', 'vote-who');
      details.append(el('summary', '', `Who voted (${names.length})`));
      details.append(el('p', '', names.join(', ')));
      summary.append(details);
    }

    bottom.append(actions, summary);
    main.append(bottom);
    card.append(main);
    return card;
  }

  function movieCounts() {
    const counts = new Map();
    for (const movie of movies) counts.set(movie.id, movieVoteRecords(movie.id).length);
    return counts;
  }

  function renderMovies(options = {}) {
    rebuildAnchors();

    const counts = movieCounts();
    const max = Math.max(0, ...counts.values());
    const sorted = [...movies].sort((a, b) => {
      const difference = (counts.get(b.id) || 0) - (counts.get(a.id) || 0);
      if (difference) return difference;
      if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
      return collator.compare(a.title, b.title);
    });

    moviesList.replaceChildren();
    if (!sorted.length) {
      moviesList.append(
        emptyState('The marquee is empty. Propose the first movie — someone has to go first.'),
      );
    } else {
      sorted.forEach((movie, index) => {
        moviesList.append(
          movieCard(movie, index, counts.get(movie.id) || 0, max, movieAnchors.get(movie.id)),
        );
      });
    }

    if (options.focusMovie) focusCard(movieCardFor(options.focusMovie));
  }

  function dateHeading(date) {
    const parsed = parseDate(date.date);
    const heading = el('h3', 'date-card__heading');
    const time = document.createElement('time');
    time.dateTime = date.date;
    time.setAttribute('aria-label', formatDate(date.date));

    if (parsed) {
      time.append(
        el('span', 'date-card__weekday', weekdayFormat.format(parsed)),
        el('span', 'date-card__day', monthDayFormat.format(parsed)),
        el('span', 'date-card__year', yearFormat.format(parsed)),
      );
    } else {
      time.textContent = date.date;
    }

    heading.append(time);
    return heading;
  }

  function dateMeter(tally) {
    const total = tally.yes.length + tally.maybe.length + tally.no.length;
    const meter = el('div', 'date-meter');
    meter.setAttribute('role', 'img');
    meter.setAttribute(
      'aria-label',
      total
        ? `${tally.yes.length} yes, ${tally.maybe.length} maybe, ${tally.no.length} no`
        : 'No votes yet',
    );

    for (const choice of CHOICES) {
      const part = el('span', `date-meter__part date-meter__part--${choice}`);
      part.style.width = total ? `${(tally[choice].length / total) * 100}%` : '0%';
      meter.append(part);
    }

    return meter;
  }

  function dateCard(date, tally, leading, rank, anchor) {
    const card = el('article', 'date-card');
    card.tabIndex = -1;
    card.dataset.dateId = date.id;

    if (anchor) {
      card.id = anchor;
    }

    const rankAnchor = el('span', 'anchor-target');
    rankAnchor.id = `date-${rank + 1}`;
    rankAnchor.setAttribute('aria-hidden', 'true');
    card.append(rankAnchor);

    const stamp = el('div', 'date-card__date');
    stamp.append(dateHeading(date));

    const body = el('div', 'date-card__body');

    const meta = [`Proposed by ${date.name}`];
    const proposed = proposedOn(date.createdAt);
    if (proposed) meta.push(proposed);
    body.append(el('p', 'date-card__meta', meta.join(' · ')));

    if (leading) {
      const badges = el('p', 'date-card__badges');
      badges.append(el('span', 'badge badge--leading', '★ Most available'));
      body.append(badges);
    }

    const total = tally.yes.length + tally.maybe.length + tally.no.length;
    if (total) {
      const tallyLine = el('p', 'date-card__tally');
      for (const choice of CHOICES) {
        const part = el('span', `date-tally__part date-tally__part--${choice}`);
        part.textContent = `${tally[choice].length} ${choice}`;
        tallyLine.append(part);
      }
      body.append(tallyLine, dateMeter(tally));
    } else {
      body.append(el('p', 'date-card__tally-empty', 'No votes yet.'));
    }

    const actions = el('div', 'date-card__actions');
    actions.append(el('span', 'date-card__prompt', 'Can you make it?'));

    const group = el('div', 'date-vote');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `Your availability for ${formatDate(date.date)}`);

    for (const choice of CHOICES) {
      const button = el('button', 'date-vote__button', choice[0].toUpperCase() + choice.slice(1));
      button.type = 'button';
      button.dataset.dateVote = date.id;
      button.dataset.choice = choice;
      const label =
        choice === 'yes'
          ? `Yes, I can make ${formatDate(date.date)}`
          : choice === 'maybe'
            ? `Maybe I can make ${formatDate(date.date)}`
            : `No, I cannot make ${formatDate(date.date)}`;
      button.setAttribute('aria-label', label);
      button.addEventListener('click', () => void voteDate(date.id, choice));
      group.append(button);
    }

    const you = el('p', 'date-card__you');
    you.dataset.dateYou = '';
    you.hidden = true;
    actions.append(group, you);
    body.append(actions);

    if (total) {
      const details = el('details', 'vote-who');
      details.append(el('summary', '', `Who's in (${total})`));
      const list = document.createElement('dl');
      for (const choice of CHOICES) {
        if (!tally[choice].length) continue;
        list.append(el('dt', '', choice));
        list.append(el('dd', '', tally[choice].join(', ')));
      }
      details.append(list);
      body.append(details);
    }

    card.append(stamp, body);
    applyDateVoteState(card, date.id);
    return card;
  }

  function applyDateVoteState(card, id) {
    const slug = currentSlug();
    const existing = slug && dateVotes[id] ? dateVotes[id][slug] : null;
    const choice =
      existing && typeof existing === 'object' && CHOICES.includes(existing.choice)
        ? existing.choice
        : '';
    const saving = savingDates.has(id);

    for (const button of card.querySelectorAll('[data-date-vote]')) {
      const chosen = Boolean(choice) && button.dataset.choice === choice;
      button.disabled = Boolean(choice) || saving;
      button.setAttribute('aria-pressed', chosen ? 'true' : 'false');
      button.classList.toggle('is-chosen', chosen);
    }

    const you = card.querySelector('[data-date-you]');
    if (you) {
      if (saving) you.textContent = 'Saving…';
      else if (choice) {
        you.textContent = `You voted ${choice[0].toUpperCase() + choice.slice(1)}.`;
      } else you.textContent = '';
      you.hidden = !you.textContent;
    }
  }

  function renderDates(options = {}) {
    rebuildAnchors();

    const today = todayString();
    const active = dates
      .filter((date) => parseDate(date.date) && date.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);

    const tallies = new Map(active.map((date) => [date.id, dateTally(date.id)]));
    const maxYes = Math.max(0, ...active.map((date) => tallies.get(date.id).yes.length));

    datesList.replaceChildren();
    if (!active.length) {
      datesList.append(
        emptyState(
          dates.length
            ? 'Every night on the board has already happened. Propose the next one.'
            : 'No nights on the board yet. Propose one and see who can make it.',
        ),
      );
    } else {
      active.forEach((date, index) => {
        const tally = tallies.get(date.id);
        datesList.append(
          dateCard(
            date,
            tally,
            maxYes > 0 && tally.yes.length === maxYes,
            index,
            dateAnchors.get(date.id),
          ),
        );
      });
    }

    if (options.focusDate) focusCard(dateCardFor(options.focusDate));
  }

  function updateVoteControls() {
    for (const card of moviesList.querySelectorAll('[data-movie-id]')) {
      const movie = movieById(card.dataset.movieId);
      const button = card.querySelector('[data-movie-vote]');
      if (movie && button) applyMovieVoteState(button, movie);
    }

    for (const card of datesList.querySelectorAll('[data-date-id]')) {
      applyDateVoteState(card, card.dataset.dateId);
    }
  }

  // -------------------------------------------------------------------------
  // Voting
  // -------------------------------------------------------------------------

  async function voteMovie(id) {
    const movie = movieById(id);
    if (!movie) return;

    const voter = requireVoter('movie_vote');
    if (!voter) return;

    if (movieVotes[id] && movieVotes[id][voter.slug]) {
      if (movieVoteStatus) movieVoteStatus.textContent = 'You already voted for this movie.';
      announce('You already voted for this movie.');
      return;
    }

    const card = movieCardFor(id);
    const button = card ? card.querySelector('[data-movie-vote]') : null;
    savingMovies.add(id);
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
      button.setAttribute('aria-label', `Saving your vote for ${movie.title}`);
    }
    if (movieVoteStatus) movieVoteStatus.textContent = '';

    const createdAt = Date.now();

    try {
      await putJson(`votes/${encodeURIComponent(id)}/${encodeURIComponent(voter.slug)}`, {
        v: 1,
        name: voter.name,
        createdAt,
      });

      if (!movieVotes[id]) movieVotes[id] = {};
      movieVotes[id][voter.slug] = { v: 1, name: voter.name, createdAt };
      rememberName(voter.name);
      track('movie_vote', {
        movie_id: movie.id,
        movie_title: movie.title,
      });
      savingMovies.delete(id);
      renderMovies({ focusMovie: id });
      if (movieVoteStatus) movieVoteStatus.textContent = 'Vote saved.';
      announce(`Vote saved for ${movie.title}.`);
    } catch {
      savingMovies.delete(id);

      const existing = await fetchJson(
        `votes/${encodeURIComponent(id)}/${encodeURIComponent(voter.slug)}`,
      ).catch(() => null);

      if (existing && typeof existing === 'object' && existing.name) {
        if (!movieVotes[id]) movieVotes[id] = {};
        movieVotes[id][voter.slug] = existing;
        renderMovies({ focusMovie: id });
        if (movieVoteStatus) movieVoteStatus.textContent = 'You already voted for this movie.';
        announce('You already voted for this movie.');
      } else {
        if (button) applyMovieVoteState(button, movie);
        if (movieVoteStatus) {
          movieVoteStatus.textContent = 'Could not save that vote. Please try again.';
        }
        announce('Could not save that vote.');
        trackFailure('movie_vote', 'write');
      }
    }
  }

  async function voteDate(id, choice) {
    const date = dateById(id);
    if (!date || !CHOICES.includes(choice)) return;

    const voter = requireVoter('movie_night_vote');
    if (!voter) return;

    if (dateVotes[id] && dateVotes[id][voter.slug]) {
      if (dateVoteStatus) dateVoteStatus.textContent = 'You already voted for this night.';
      announce('You already voted for this night.');
      return;
    }

    const card = dateCardFor(id);
    savingDates.add(id);
    if (card) applyDateVoteState(card, id);
    if (dateVoteStatus) dateVoteStatus.textContent = '';

    const createdAt = Date.now();

    try {
      await putJson(`dateVotes/${encodeURIComponent(id)}/${encodeURIComponent(voter.slug)}`, {
        v: 1,
        name: voter.name,
        choice,
        createdAt,
      });

      if (!dateVotes[id]) dateVotes[id] = {};
      dateVotes[id][voter.slug] = { v: 1, name: voter.name, choice, createdAt };
      rememberName(voter.name);
      track('movie_night_vote', { movie_night_date: date.date, choice });
      savingDates.delete(id);
      renderDates({ focusDate: id });
      if (dateVoteStatus) {
        dateVoteStatus.textContent = `Vote saved: ${choice[0].toUpperCase() + choice.slice(1)}.`;
      }
      announce(`Vote saved: ${choice} for ${formatDate(date.date)}.`);
    } catch {
      savingDates.delete(id);

      const existing = await fetchJson(
        `dateVotes/${encodeURIComponent(id)}/${encodeURIComponent(voter.slug)}`,
      ).catch(() => null);

      if (existing && typeof existing === 'object' && existing.name) {
        if (!dateVotes[id]) dateVotes[id] = {};
        dateVotes[id][voter.slug] = existing;
        renderDates({ focusDate: id });
        if (dateVoteStatus) {
          dateVoteStatus.textContent = 'You already voted for this night.';
        }
        announce('You already voted for this night.');
      } else {
        if (card) applyDateVoteState(card, id);
        if (dateVoteStatus) {
          dateVoteStatus.textContent = 'Could not save that vote. Please try again.';
        }
        announce('Could not save that vote.');
        trackFailure('movie_night_vote', 'write');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Proposals
  // -------------------------------------------------------------------------

  function resetMovieDuplicate() {
    movieArmed = false;
    movieWarning.hidden = true;
    movieWarning.textContent = '';
    movieSubmit.textContent = 'Propose movie';
  }

  function resetDateDuplicate() {
    dateArmed = false;
    dateWarning.hidden = true;
    dateWarning.textContent = '';
    dateSubmit.textContent = 'Propose night';
  }

  async function submitMovie(event) {
    event.preventDefault();

    const titleInput = movieForm.elements.namedItem('title');
    const urlInput = movieForm.elements.namedItem('url');
    const trap = movieForm.elements.namedItem('website');

    if (trap && trap.value) {
      movieForm.reset();
      trackFailure('movie_propose', 'honeypot');
      return;
    }

    const voter = requireVoter('movie_propose');
    if (!voter) return;

    const title = titleInput.value.trim();
    const rawUrl = urlInput.value.trim();
    const pitch = pitchInput.value.trim();
    movieStatus.textContent = '';

    if (!title) {
      movieStatus.textContent = 'Give the movie a title.';
      titleInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'title' });
      return;
    }

    if (title.length > MAX_TITLE) {
      movieStatus.textContent = 'That title is a little too long.';
      titleInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'title' });
      return;
    }

    if (!rawUrl) {
      movieStatus.textContent = 'Paste the YouTube trailer link.';
      urlInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'url' });
      return;
    }

    if (rawUrl.length > MAX_URL) {
      movieStatus.textContent = 'That link is a little too long.';
      urlInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'url' });
      return;
    }

    const videoId = videoIdFrom(rawUrl);
    if (!videoId) {
      movieStatus.textContent =
        'That is not a single YouTube video link. Watch, youtu.be, Shorts, live, and embed links work; playlists, channels, and other sites do not.';
      urlInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'url' });
      return;
    }

    if (pitch.length > MAX_PITCH) {
      movieStatus.textContent = 'That description is a little too long.';
      pitchInput.focus();
      trackFailure('movie_propose', 'validation', { field: 'pitch' });
      return;
    }

    const duplicate = movies.find((movie) => normalizeTitle(movie.title) === normalizeTitle(title));
    if (duplicate && !movieArmed) {
      movieArmed = true;
      movieWarning.textContent = `“${duplicate.title}” is already on the board, proposed by ${duplicate.name}. Vote for it below, or choose “Propose anyway” if this is a different film.`;
      movieWarning.hidden = false;
      movieSubmit.textContent = 'Propose anyway';
      return;
    }

    movieSubmit.disabled = true;
    movieSubmit.textContent = 'Proposing…';

    const id = newId();
    const payload = {
      v: 1,
      title,
      videoId,
      name: voter.name,
      createdAt: Date.now(),
    };
    if (pitch) payload.pitch = pitch;

    // Only a failed write is a failed action; anything after it is local.
    let saved = false;

    try {
      await putJson(`movies/${encodeURIComponent(id)}`, payload);
      saved = true;
      movies.push({ id, ...payload });
      rememberName(voter.name);
      track('movie_propose', {
        movie_title: title,
        has_pitch: pitch ? 1 : 0,
      });
      movieForm.reset();
      resetMovieDuplicate();
      movieStatus.textContent = 'Proposed! It is on the board.';
      renderMovies({ focusMovie: id });
    } catch {
      movieStatus.textContent = 'Could not post that. Please try again.';
      if (!saved) {
        trackFailure('movie_propose', 'write');
      }
    } finally {
      movieSubmit.disabled = false;
      movieSubmit.textContent = movieArmed ? 'Propose anyway' : 'Propose movie';
    }
  }

  async function submitDate(event) {
    event.preventDefault();

    const trap = dateForm.elements.namedItem('website');
    if (trap && trap.value) {
      dateForm.reset();
      trackFailure('movie_night_propose', 'honeypot');
      return;
    }

    const voter = requireVoter('movie_night_propose');
    if (!voter) return;

    const value = dateInput.value;
    dateStatus.textContent = '';

    if (!value) {
      dateStatus.textContent = 'Pick a night.';
      dateInput.focus();
      trackFailure('movie_night_propose', 'validation', { field: 'date' });
      return;
    }

    if (!parseDate(value)) {
      dateStatus.textContent = 'That date does not exist. Try again.';
      dateInput.focus();
      trackFailure('movie_night_propose', 'validation', { field: 'date' });
      return;
    }

    if (value < todayString()) {
      dateStatus.textContent = 'That night has already passed. Pick an upcoming night.';
      dateInput.focus();
      trackFailure('movie_night_propose', 'validation', { field: 'date' });
      return;
    }

    const duplicate = dates.find((date) => date.date === value);
    if (duplicate && !dateArmed) {
      dateArmed = true;
      dateWarning.textContent = `That night is already on the board, proposed by ${duplicate.name}. Choose “Propose anyway” if you really mean to add it again.`;
      dateWarning.hidden = false;
      dateSubmit.textContent = 'Propose anyway';
      return;
    }

    dateSubmit.disabled = true;
    dateSubmit.textContent = 'Proposing…';

    const id = newId();
    const payload = {
      v: 1,
      date: value,
      name: voter.name,
      createdAt: Date.now(),
    };

    // Only a failed write is a failed action; anything after it is local.
    let saved = false;

    try {
      await putJson(`dates/${encodeURIComponent(id)}`, payload);
      saved = true;
      dates.push({ id, ...payload });
      rememberName(voter.name);
      track('movie_night_propose', { movie_night_date: value });
      dateForm.reset();
      resetDateDuplicate();
      dateStatus.textContent = 'Proposed! It is on the board.';
      renderDates({ focusDate: id });
    } catch {
      dateStatus.textContent = 'Could not post that. Please try again.';
      if (!saved) {
        trackFailure('movie_night_propose', 'write');
      }
    } finally {
      dateSubmit.disabled = false;
      dateSubmit.textContent = dateArmed ? 'Propose anyway' : 'Propose night';
    }
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  nameInput.value = readStoredName();

  nameInput.addEventListener('input', () => {
    nameInput.removeAttribute('aria-invalid');
    voterStatus.textContent = '';
    if (movieVoteStatus) movieVoteStatus.textContent = '';
    if (dateVoteStatus) dateVoteStatus.textContent = '';
    updateVoteControls();
  });

  nameInput.addEventListener('change', () => {
    const name = nameInput.value.trim();
    if (name && !nameProblem(name)) rememberName(name);
    else if (!name) forgetName();
  });

  movieForm.addEventListener('submit', (event) => void submitMovie(event));
  dateForm.addEventListener('submit', (event) => void submitDate(event));

  for (const field of movieForm.querySelectorAll('input, textarea')) {
    if (field.name === 'website') continue;
    field.addEventListener('input', () => {
      movieStatus.textContent = '';
      if (movieArmed) resetMovieDuplicate();
    });
  }

  for (const field of dateForm.querySelectorAll('input, textarea')) {
    if (field.name === 'website') continue;
    field.addEventListener('input', () => {
      dateStatus.textContent = '';
      if (dateArmed) resetDateDuplicate();
    });
  }

  if (dateInput) {
    dateInput.addEventListener('focus', () => {
      dateInput.min = todayString();
    });
  }

  void load();
})();
