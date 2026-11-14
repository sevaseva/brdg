/* Text-selection comments for session pages.

   Comments are public and immutable. They live in a Firebase Realtime Database
   under /comments/<session>/<commentId> and /replies/<session>/<commentId>/<replyId>.
   The database refuses updates and deletes, so the browser only ever creates new
   records (with PUT, at a locally generated key).

   A comment remembers the passage it was written on as a quote plus a little
   surrounding context, and as offsets into a plain-text copy of the page.
   When the page changes, the quote is the real anchor: exact match at the old
   offset first, then the exact quote anywhere, then a whitespace-insensitive
   match. Anything that cannot be found is shown at the bottom as an orphan.

   Nothing here runs while comments are hidden, except the toggle itself. */
(() => {
  'use strict';

  const article = document.querySelector('[data-session-id]');
  const body = article ? article.querySelector('[data-session-body]') : null;

  if (!article || !body) return;

  const DATABASE = 'https://brdg-lol-default-rtdb.firebaseio.com';
  const NAME_KEY = 'user:name';
  const MAX_NAME = 40;
  const MAX_BODY = 2000;
  const MAX_QUOTE = 300;
  const CONTEXT = 60;
  const MIN_NORMALIZED_QUOTE = 8;

  const sessionId = article.dataset.sessionId;
  const toggle = article.querySelector('[data-comments-toggle]');
  const statusEl = article.querySelector('[data-comments-status]');

  // Elements that start a new line in the plain-text copy of the notes.
  const BLOCK_TAGS = new Set([
    'ADDRESS',
    'ARTICLE',
    'ASIDE',
    'BLOCKQUOTE',
    'BR',
    'DD',
    'DIV',
    'DL',
    'DT',
    'FIELDSET',
    'FIGCAPTION',
    'FIGURE',
    'FOOTER',
    'FORM',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'HEADER',
    'HR',
    'LI',
    'MAIN',
    'NAV',
    'OL',
    'P',
    'PRE',
    'SECTION',
    'TABLE',
    'TBODY',
    'TD',
    'TFOOT',
    'TH',
    'THEAD',
    'TR',
    'UL',
  ]);

  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  let shown = readPreference();
  let loaded = false;
  let loading = false;
  let loadFailed = false;
  let threads = [];
  let textIndex = null;
  let pendingSelection = null;
  let selectionTimer = 0;
  let bubble = null;
  let bubbleTouched = false;
  let composer = null;
  let commentHighlight = null;
  let flashTimer = 0;
  let textFlashTimer = 0;
  let pendingAlign = false;

  // -------------------------------------------------------------------------
  // Local storage
  // -------------------------------------------------------------------------

  function readPreference() {
    try {
      return window.localStorage.getItem(`comments:${sessionId}`) !== 'hidden';
    } catch {
      return true;
    }
  }

  function writePreference(value) {
    try {
      if (value) window.localStorage.removeItem(`comments:${sessionId}`);
      else window.localStorage.setItem(`comments:${sessionId}`, 'hidden');
    } catch {
      // A blocked storage API just means the choice is not remembered.
    }
  }

  function readName() {
    try {
      return window.localStorage.getItem(NAME_KEY) || '';
    } catch {
      return '';
    }
  }

  function writeName(value) {
    try {
      window.localStorage.setItem(NAME_KEY, value);
    } catch {
      // Not fatal: the name just will not be prefilled next time.
    }
  }

  // -------------------------------------------------------------------------
  // Plain-text copy of the session notes
  // -------------------------------------------------------------------------

  function buildTextIndex() {
    if (textIndex) return textIndex;

    let text = '';
    const nodes = [];
    const byNode = new Map();
    const blocks = [];

    const breakLine = () => {
      if (text && !text.endsWith('\n')) text += '\n';
    };

    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const start = text.length;
        text += node.data;
        const entry = { node, start, end: text.length };
        nodes.push(entry);
        byNode.set(node, entry);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.hasAttribute('data-comment-ui')) return;
      if (node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;

      const blockish = BLOCK_TAGS.has(node.tagName);
      if (blockish) breakLine();
      node.childNodes.forEach(walk);
      if (blockish) breakLine();
    };

    for (const child of body.childNodes) {
      const start = text.length;
      walk(child);
      if (child.nodeType === Node.ELEMENT_NODE && !child.hasAttribute('data-comment-ui')) {
        blocks.push({ el: child, start, end: text.length });
      }
    }

    textIndex = { text, nodes, byNode, blocks, normalized: null };
    return textIndex;
  }

  function firstText(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.data.length ? node : null;
    if (node.nodeType !== Node.ELEMENT_NODE) return null;
    if (node.hasAttribute('data-comment-ui')) return null;
    for (const child of node.childNodes) {
      const found = firstText(child);
      if (found) return found;
    }
    return null;
  }

  // Plain-text offset of a DOM boundary. Element boundaries walk forward to the
  // first piece of real text, so a selection that starts or ends on a block edge
  // still lands somewhere sensible.
  function offsetAt(container, offset) {
    if (container.nodeType === Node.TEXT_NODE) {
      const entry = textIndex.byNode.get(container);
      if (!entry) return null;
      return entry.start + Math.min(offset, entry.node.data.length);
    }

    if (container.nodeType !== Node.ELEMENT_NODE) return null;

    if (offset < container.childNodes.length) {
      const found = firstText(container.childNodes[offset]);
      if (found) {
        const entry = textIndex.byNode.get(found);
        if (entry) return entry.start;
      }
    }

    let node = container;
    while (node && node !== body) {
      let sibling = node.nextSibling;
      while (sibling) {
        const found = firstText(sibling);
        if (found) {
          const entry = textIndex.byNode.get(found);
          if (entry) return entry.start;
        }
        sibling = sibling.nextSibling;
      }
      node = node.parentNode;
    }

    return textIndex.text.length;
  }

  function locate(offset) {
    const { nodes } = textIndex;
    let low = 0;
    let high = nodes.length - 1;

    while (low <= high) {
      const middle = (low + high) >> 1;
      const entry = nodes[middle];
      if (offset < entry.start) high = middle - 1;
      else if (offset > entry.end) low = middle + 1;
      else return { entry, offset: Math.min(offset - entry.start, entry.node.data.length) };
    }

    const last = nodes[nodes.length - 1];
    return last ? { entry: last, offset: last.node.data.length } : null;
  }

  function domRange(start, end) {
    const from = locate(start);
    const to = locate(end);
    if (!from || !to) return null;

    const range = document.createRange();
    range.setStart(from.entry.node, from.offset);
    range.setEnd(to.entry.node, to.offset);
    return range;
  }

  function blockAt(offset) {
    let previous = null;

    for (const block of textIndex.blocks) {
      if (offset < block.start) return previous || block.el;
      if (offset <= block.end) return block.el;
      previous = block.el;
    }

    return previous;
  }

  // Turns a live selection into the anchor that gets stored with a comment.
  function anchorFor(range) {
    let start = offsetAt(range.startContainer, range.startOffset);
    let end = offsetAt(range.endContainer, range.endOffset);

    if (start === null || end === null || end <= start) return null;

    while (start < end && /\s/.test(textIndex.text[start])) start += 1;
    while (end > start && /\s/.test(textIndex.text[end - 1])) end -= 1;
    if (end <= start) return null;

    const capped = Math.min(end, start + MAX_QUOTE);
    const quote = textIndex.text.slice(start, capped);
    if (!quote.trim()) return null;

    return {
      start,
      end: capped,
      quote,
      prefix: textIndex.text.slice(Math.max(0, start - CONTEXT), start),
      suffix: textIndex.text.slice(capped, capped + CONTEXT),
      block: blockAt(start),
    };
  }

  // -------------------------------------------------------------------------
  // Finding a comment's passage again
  // -------------------------------------------------------------------------

  function normalizedText() {
    if (textIndex.normalized) return textIndex.normalized;

    let text = '';
    const map = [];
    let pendingSpace = -1;

    for (let index = 0; index < textIndex.text.length; index += 1) {
      const char = textIndex.text[index];
      if (/\s/.test(char)) {
        if (pendingSpace < 0) pendingSpace = index;
        continue;
      }

      if (pendingSpace >= 0 && text.length > 0) {
        text += ' ';
        map.push(pendingSpace);
      }
      pendingSpace = -1;
      text += char;
      map.push(index);
    }

    textIndex.normalized = { text, map };
    return textIndex.normalized;
  }

  function scoreCandidate(position, quote, prefix, suffix) {
    let score = 0;
    if (prefix) {
      const before = textIndex.text.slice(Math.max(0, position - prefix.length), position);
      if (before === prefix) score += 2;
    }
    if (suffix) {
      const after = textIndex.text.slice(
        position + quote.length,
        position + quote.length + suffix.length,
      );
      if (after === suffix) score += 2;
    }
    return score;
  }

  function bestCandidate(positions, quote, prefix, suffix, start) {
    let best = null;

    for (const position of positions) {
      const score = scoreCandidate(position, quote, prefix, suffix);
      const distance = Math.abs(position - start);
      if (!best || score > best.score || (score === best.score && distance < best.distance)) {
        best = { position, score, distance };
      }
    }

    return best;
  }

  function resolveNormalized(quote, start) {
    const needle = quote.replace(/\s+/g, ' ').trim();
    if (needle.length < MIN_NORMALIZED_QUOTE) return null;

    const { text, map } = normalizedText();
    const candidates = [];
    let found = text.indexOf(needle);

    while (found !== -1 && candidates.length < 400) {
      candidates.push({ position: map[found], index: found });
      found = text.indexOf(needle, found + 1);
    }

    let best = null;
    for (const candidate of candidates) {
      const distance = Math.abs(candidate.position - start);
      if (!best || distance < best.distance) best = { ...candidate, distance };
    }

    if (!best) return null;

    const first = map[best.index];
    const last = map[best.index + needle.length - 1];
    if (!Number.isFinite(first) || !Number.isFinite(last)) return null;

    return { start: first, end: last + 1 };
  }

  function resolve(comment) {
    const quote = typeof comment.quote === 'string' ? comment.quote : '';
    if (!quote) return null;

    const rawStart = Number(comment.start);
    const start = Number.isFinite(rawStart) ? Math.max(0, Math.floor(rawStart)) : 0;
    const prefix = typeof comment.prefix === 'string' ? comment.prefix : '';
    const suffix = typeof comment.suffix === 'string' ? comment.suffix : '';

    if (start + quote.length <= textIndex.text.length) {
      const atStart = textIndex.text.slice(start, start + quote.length);
      if (atStart === quote) return { start, end: start + quote.length };
    }

    const positions = [];
    let found = textIndex.text.indexOf(quote);

    while (found !== -1 && positions.length < 400) {
      positions.push(found);
      found = textIndex.text.indexOf(quote, found + 1);
    }

    const best = bestCandidate(positions, quote, prefix, suffix, start);
    if (best) return { start: best.position, end: best.position + quote.length };

    return resolveNormalized(quote, start);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  function createdAt(data) {
    const value = Number(data.createdAt);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function formatDate(value) {
    if (!value) return '';
    return dateFormat.format(new Date(value));
  }

  function meta(data, tag) {
    const paragraph = document.createElement('p');
    paragraph.className = 'comment__meta';

    if (tag) {
      const badge = document.createElement('span');
      badge.className = 'comment__tag';
      badge.textContent = tag;
      paragraph.append(badge);
    }

    const name = document.createElement('span');
    name.className = 'comment__name';
    name.textContent = typeof data.name === 'string' && data.name.trim() ? data.name : 'Anonymous';

    const time = document.createElement('time');
    const value = createdAt(data);
    if (value) time.dateTime = new Date(value).toISOString();
    time.textContent = formatDate(value);

    paragraph.append(name, time);
    return paragraph;
  }

  function quoteBlock(quote) {
    const block = document.createElement('blockquote');
    block.className = 'comment__quote';
    block.textContent = quote;
    return block;
  }

  function textParagraph(className, value) {
    const paragraph = document.createElement('p');
    paragraph.className = className;
    paragraph.textContent = typeof value === 'string' ? value : '';
    return paragraph;
  }

  function card(thread) {
    const element = document.createElement('aside');
    element.className = 'comment';
    element.id = `comment-${thread.id}`;
    element.tabIndex = -1;
    element.dataset.commentUi = '';
    element.thread = thread;

    element.append(meta(thread.data));
    if (typeof thread.data.quote === 'string' && thread.data.quote) {
      element.append(quoteBlock(thread.data.quote));
    }
    element.append(textParagraph('comment__body', thread.data.body));

    if (thread.replies.length) {
      const list = document.createElement('ol');
      list.className = 'comment__replies';

      for (const reply of thread.replies) {
        const item = document.createElement('li');
        item.className = 'comment__reply';
        item.append(meta(reply.data, 'Reply'), textParagraph('comment__body', reply.data.body));
        list.append(item);
      }

      element.append(list);
    }

    const details = document.createElement('details');
    details.className = 'comment__reply-form';
    const summary = document.createElement('summary');
    summary.textContent = 'Reply';
    details.append(summary);
    details.append(buildForm({ commentId: thread.id }));
    element.append(details);

    return element;
  }

  function wrapBlock(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'session-block';

    const comments = document.createElement('div');
    comments.className = 'session-block__comments';
    comments.dataset.commentUi = '';

    block.replaceWith(wrapper);
    wrapper.append(block, comments);
    return comments;
  }

  function commentsSlot(block) {
    ensureCommentLayout();

    const wrapper = block.parentElement;
    if (wrapper && wrapper.classList.contains('session-block')) {
      const existing = wrapper.querySelector(':scope > .session-block__comments');
      if (existing) return existing;
    }

    return wrapBlock(block);
  }

  function ensureCommentLayout() {
    if (body.classList.contains('session-body--with-comments')) return;

    body.classList.add('session-body--with-comments');
    for (const child of [...body.children]) {
      if (child.hasAttribute('data-comment-ui')) continue;
      if (child.classList.contains('session-block')) continue;
      wrapBlock(child);
    }
  }

  function orphanSection(list) {
    const section = document.createElement('section');
    section.className = 'session-comments-orphans';
    section.dataset.commentUi = '';

    const heading = document.createElement('h2');
    heading.textContent = 'Comments that lost their place';

    const intro = document.createElement('p');
    intro.className = 'session-comments-orphans__intro';
    intro.textContent =
      'These comments were written on passages that have changed, so they no longer point at anything on this page.';

    const stack = document.createElement('div');
    stack.className = 'comments-stack';
    for (const thread of list) stack.append(card(thread));

    section.append(heading, intro, stack);
    return section;
  }

  function teardown() {
    for (const wrapper of [...body.querySelectorAll('.session-block')]) {
      const comments = wrapper.querySelector(':scope > .session-block__comments');
      if (comments) comments.remove();
      wrapper.replaceWith(...[...wrapper.childNodes]);
    }

    for (const node of [...body.querySelectorAll('[data-comment-ui]')]) node.remove();

    body.classList.remove('session-body--with-comments');
    composer = null;
  }

  function render() {
    teardown();
    if (!threads.length) return;

    const grouped = new Map();
    const orphans = [];
    const ordered = [...threads].sort((a, b) => {
      const aStart = a.range ? a.range.start : Number.MAX_SAFE_INTEGER;
      const bStart = b.range ? b.range.start : Number.MAX_SAFE_INTEGER;
      return aStart - bStart || createdAt(a.data) - createdAt(b.data) || a.id.localeCompare(b.id);
    });

    for (const thread of ordered) {
      const block = thread.range ? blockAt(thread.range.start) : null;
      if (!block) {
        orphans.push(thread);
        continue;
      }
      if (!grouped.has(block)) grouped.set(block, []);
      grouped.get(block).push(thread);
    }

    if (grouped.size) {
      body.classList.add('session-body--with-comments');

      for (const child of [...body.children]) {
        if (child.hasAttribute('data-comment-ui')) continue;

        const comments = wrapBlock(child);
        for (const thread of grouped.get(child) || []) comments.append(card(thread));
      }
    }

    if (orphans.length) body.append(orphanSection(orphans));

    alignComments();
  }

  function resolveAll() {
    buildTextIndex();
    for (const thread of threads) thread.range = resolve(thread.data);
  }

  // On wide screens the comments sit in a margin column. Nudge each one down so
  // it starts level with the passage it belongs to, while never overlapping the
  // comment above it. Narrow screens and print keep the simple stacked order.
  function alignComments() {
    if (!shown) return;

    const wide = window.matchMedia('(min-width: 980px)').matches;

    for (const wrapper of body.querySelectorAll('.session-block')) {
      const comments = wrapper.querySelector(':scope > .session-block__comments');
      if (!comments) continue;

      const cards = [...comments.children];
      if (!cards.length) continue;

      if (!wide) {
        for (const item of cards) item.style.marginTop = '';
        continue;
      }

      const top = wrapper.getBoundingClientRect().top;
      let used = 0;

      for (const item of cards) {
        const range =
          item.thread && item.thread.range
            ? domRange(item.thread.range.start, item.thread.range.end)
            : null;
        const anchorTop = range ? range.getBoundingClientRect().top : top;
        const desired = Math.max(0, anchorTop - top);
        const gap = used > 0 ? 8 : 0;
        const margin = Math.max(gap, desired - used);

        item.style.marginTop = `${Math.round(margin)}px`;
        used += margin + item.offsetHeight;
      }
    }
  }

  let alignFrame = 0;

  function scheduleAlign() {
    if (!shown) {
      pendingAlign = true;
      return;
    }

    if (alignFrame) return;
    alignFrame = window.requestAnimationFrame(() => {
      alignFrame = 0;
      alignComments();
    });
  }

  // -------------------------------------------------------------------------
  // Highlights (CSS Custom Highlight API, when available)
  // -------------------------------------------------------------------------

  function hideHighlights() {
    window.clearTimeout(textFlashTimer);

    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    CSS.highlights.delete('session-comment');
    CSS.highlights.delete('session-comment-flash');
  }

  function showHighlights() {
    if (typeof CSS === 'undefined' || !CSS.highlights) return;
    if (commentHighlight) CSS.highlights.set('session-comment', commentHighlight);
  }

  function applyHighlights() {
    hideHighlights();
    commentHighlight = null;
    if (!shown) return;
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;

    const ranges = [];
    for (const thread of threads) {
      if (!thread.range) continue;
      const range = domRange(thread.range.start, thread.range.end);
      if (range) ranges.push(range);
    }

    if (!ranges.length) return;
    commentHighlight = new Highlight(...ranges);
    CSS.highlights.set('session-comment', commentHighlight);
  }

  // -------------------------------------------------------------------------
  // Toggle
  // -------------------------------------------------------------------------

  function setStatus(message) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = !message;
  }

  function updateToggle() {
    if (!toggle) return;

    toggle.hidden = false;

    if (!shown) {
      toggle.setAttribute('aria-pressed', 'false');
      toggle.textContent = 'Show comments';
      return;
    }

    // A failed fetch leaves nothing to hide, so the button becomes a retry.
    if (loadFailed) {
      toggle.setAttribute('aria-pressed', 'true');
      toggle.textContent = 'Try again';
      return;
    }

    if (loaded && !threads.length) {
      toggle.hidden = true;
      return;
    }

    toggle.setAttribute('aria-pressed', 'true');
    toggle.textContent = `Hide comments (${threads.length})`;
  }

  async function toggleComments() {
    if (shown && loadFailed && !loading) {
      await load();
      return;
    }

    shown = !shown;
    writePreference(shown);
    article.dataset.comments = shown ? 'shown' : 'hidden';

    if (!shown) {
      hideHighlights();
      discardSelection();
      setStatus('');
      updateToggle();
      return;
    }

    // Showing again reuses the fetched data, the resolved anchors, and the
    // highlight ranges. Only a page reload picks up comments posted elsewhere.
    if (!loaded && !loading) await load();
    if (loaded) {
      showHighlights();
      if (pendingAlign) {
        pendingAlign = false;
        alignComments();
      }
    }
    updateToggle();
  }

  // -------------------------------------------------------------------------
  // Data
  // -------------------------------------------------------------------------

  function api(path) {
    return `${DATABASE}/${path}.json`;
  }

  async function fetchJson(path) {
    const response = await fetch(api(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) || {};
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
    return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  async function load() {
    if (loaded || loading) return;

    loading = true;
    setStatus('Loading comments…');

    try {
      const [comments, replies] = await Promise.all([
        fetchJson(`comments/${sessionId}`),
        fetchJson(`replies/${sessionId}`),
      ]);

      threads = Object.entries(comments)
        .filter(([, data]) => data && typeof data === 'object')
        .map(([id, data]) => ({ id, data, replies: [], range: null }));

      const byId = new Map(threads.map((thread) => [thread.id, thread]));

      for (const [commentId, group] of Object.entries(replies)) {
        const thread = byId.get(commentId);
        if (!thread || !group || typeof group !== 'object') continue;

        thread.replies = Object.entries(group)
          .filter(([, data]) => data && typeof data === 'object')
          .map(([id, data]) => ({ id, data }))
          .sort((a, b) => createdAt(a.data) - createdAt(b.data));
      }

      loaded = true;
      loadFailed = false;
      setStatus('');

      if (shown) {
        resolveAll();
        render();
        applyHighlights();
      }
    } catch {
      loadFailed = true;
      setStatus('Comments are unavailable right now. The page itself is fine.');
    } finally {
      loading = false;
      updateToggle();
    }
  }

  // -------------------------------------------------------------------------
  // Forms
  // -------------------------------------------------------------------------

  function buildForm({ commentId = null, quote = '', anchor = null }) {
    const form = document.createElement('form');
    form.className = 'comment__form';
    form.dataset.commentUi = '';

    if (quote) form.append(quoteBlock(quote));

    const bodyLabel = document.createElement('label');
    bodyLabel.textContent = 'Your comment';
    const textarea = document.createElement('textarea');
    textarea.name = 'body';
    textarea.rows = 3;
    textarea.required = true;
    textarea.maxLength = MAX_BODY;
    bodyLabel.append(textarea);

    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Your name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.name = 'name';
    nameInput.required = true;
    nameInput.maxLength = MAX_NAME;
    nameInput.autocomplete = 'nickname';
    nameInput.value = readName();
    nameLabel.append(nameInput);

    // Honeypot. Real people never see it; a filled field means a bot, and the
    // submit is dropped without a request and without an error message.
    const trap = document.createElement('input');
    trap.type = 'text';
    trap.name = 'website';
    trap.className = 'comment__hp';
    trap.tabIndex = -1;
    trap.autocomplete = 'off';
    trap.setAttribute('aria-hidden', 'true');

    const actions = document.createElement('div');
    actions.className = 'comment__actions';

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = commentId ? 'Post reply' : 'Post comment';

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => {
      form.remove();
      if (composer === form) composer = null;
    });

    actions.append(submit, cancel);

    const formStatus = document.createElement('p');
    formStatus.className = 'comment__status';
    formStatus.setAttribute('role', 'status');

    form.append(bodyLabel, nameLabel, trap, actions, formStatus);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void submitForm({ form, commentId, anchor, nameInput, textarea, trap, submit, formStatus });
    });

    return form;
  }

  async function submitForm({
    form,
    commentId,
    anchor,
    nameInput,
    textarea,
    trap,
    submit,
    formStatus,
  }) {
    const name = nameInput.value.trim();
    const bodyText = textarea.value.trim();

    if (trap.value) {
      form.reset();
      return;
    }

    if (!name || !bodyText) {
      formStatus.textContent = 'Please add your name and a comment.';
      return;
    }

    if (name.length > MAX_NAME || bodyText.length > MAX_BODY) {
      formStatus.textContent = 'That is a little too long.';
      return;
    }

    formStatus.textContent = '';
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Posting…';

    const id = newId();
    const created = Date.now();

    try {
      if (commentId) {
        const reply = { v: 1, name, body: bodyText, createdAt: created };
        await putJson(`replies/${sessionId}/${commentId}/${id}`, reply);

        const thread = threads.find((item) => item.id === commentId);
        if (thread) {
          thread.replies.push({ id, data: reply });
          thread.replies.sort((a, b) => createdAt(a.data) - createdAt(b.data));
        }
      } else {
        if (!anchor) throw new Error('missing anchor');

        const comment = {
          v: 1,
          name,
          body: bodyText,
          quote: anchor.quote,
          prefix: anchor.prefix,
          suffix: anchor.suffix,
          start: anchor.start,
          end: anchor.end,
          createdAt: created,
        };

        await putJson(`comments/${sessionId}/${id}`, comment);

        threads.push({ id, data: comment, replies: [], range: null });
        composer = null;

        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
      }

      loaded = true;
      writeName(name);
      resolveAll();
      render();
      applyHighlights();
      updateToggle();
      focusComment(commentId || id);
    } catch {
      formStatus.textContent = 'Could not post that. Please try again.';
      submit.disabled = false;
      submit.textContent = label;
    }
  }

  function focusComment(id) {
    const element = document.getElementById(`comment-${id}`);
    if (!element) return;
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest' });
  }

  // -------------------------------------------------------------------------
  // Clicking a highlighted passage reveals its comment
  // -------------------------------------------------------------------------

  function offsetFromPoint(x, y) {
    let node = null;
    let offset = 0;

    if (typeof document.caretPositionFromPoint === 'function') {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        node = position.offsetNode;
        offset = position.offset;
      }
    } else if (typeof document.caretRangeFromPoint === 'function') {
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        node = range.startContainer;
        offset = range.startOffset;
      }
    }

    if (!node || !body.contains(node) || inCommentUi(node)) return null;
    return offsetAt(node, offset);
  }

  function commentAtOffset(offset) {
    let best = null;

    for (const thread of threads) {
      if (!thread.range) continue;
      if (offset < thread.range.start || offset > thread.range.end) continue;
      if (!best || thread.range.start < best.range.start) best = thread;
    }

    return best;
  }

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function revealComment(id) {
    const element = document.getElementById(`comment-${id}`);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      element.scrollIntoView({
        block: 'nearest',
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }

    element.classList.remove('comment--flash');
    void element.offsetWidth;
    element.classList.add('comment--flash');

    window.clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => element.classList.remove('comment--flash'), 1600);
  }

  // The other direction: clicking a comment pulses the passage it was written
  // on. ::highlight() paint cannot be animated, so the script blinks a second
  // highlight registration on and off instead.
  function flashText(thread) {
    if (!thread || !thread.range) return;
    if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight !== 'function') return;

    const range = domRange(thread.range.start, thread.range.end);
    if (!range) return;

    const rect = range.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      const element =
        range.startContainer.nodeType === Node.ELEMENT_NODE
          ? range.startContainer
          : range.startContainer.parentElement;
      if (element) {
        element.scrollIntoView({
          block: 'center',
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
        });
      }
    }

    const reduced = prefersReducedMotion();
    const pulse = new Highlight(range);

    window.clearTimeout(textFlashTimer);
    CSS.highlights.delete('session-comment-flash');

    let remaining = reduced ? 1 : 3;

    const off = () => {
      CSS.highlights.delete('session-comment-flash');
      remaining -= 1;
      if (remaining > 0) textFlashTimer = window.setTimeout(on, reduced ? 0 : 140);
    };

    const on = () => {
      if (!shown) return;
      CSS.highlights.set('session-comment-flash', pulse);
      textFlashTimer = window.setTimeout(off, reduced ? 1000 : 260);
    };

    on();
  }

  // -------------------------------------------------------------------------
  // Selection bubble
  // -------------------------------------------------------------------------

  function inCommentUi(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return Boolean(element && element.closest('[data-comment-ui]'));
  }

  function ensureBubble() {
    if (bubble) return bubble;

    bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'comment-bubble';
    bubble.tabIndex = -1;
    bubble.hidden = true;
    bubble.textContent = 'Comment';
    bubble.setAttribute('aria-label', 'Comment on the selected text');
    // Keep the text selection alive while the button is pressed, otherwise the
    // browser would collapse it before the click arrives.
    bubble.addEventListener('pointerdown', (event) => event.preventDefault());
    // iOS Safari drops the selection before it dispatches click, so touch has to
    // act on touchstart. preventDefault also suppresses the compatibility click.
    bubble.addEventListener(
      'touchstart',
      (event) => {
        event.preventDefault();
        bubbleTouched = true;
        window.setTimeout(() => {
          bubbleTouched = false;
        }, 600);
        startComposer();
      },
      { passive: false },
    );
    bubble.addEventListener('click', () => {
      if (bubbleTouched) {
        bubbleTouched = false;
        return;
      }

      startComposer();
    });
    document.body.append(bubble);
    return bubble;
  }

  function hideBubble() {
    if (bubble) bubble.hidden = true;
  }

  function discardSelection() {
    window.clearTimeout(selectionTimer);
    selectionTimer = 0;
    hideBubble();
    pendingSelection = null;
  }

  function captureSelection() {
    if (!shown) return discardSelection();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed)
      return discardSelection();

    const range = selection.getRangeAt(0);
    if (!body.contains(range.commonAncestorContainer)) return discardSelection();
    if (inCommentUi(range.startContainer) || inCommentUi(range.endContainer)) {
      return discardSelection();
    }
    if (!range.toString().trim()) return discardSelection();

    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return discardSelection();

    pendingSelection = range.cloneRange();

    const button = ensureBubble();
    const height = button.offsetHeight || 30;
    const viewportHeight = window.visualViewport
      ? window.visualViewport.height
      : window.innerHeight;
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - 40), window.innerWidth - 96);
    const below = rect.bottom + 8;
    const top = below + height <= viewportHeight ? below : Math.max(8, rect.top - height - 8);

    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
    button.hidden = false;
  }

  function startComposer() {
    if (!pendingSelection || !shown) return discardSelection();

    const selection = pendingSelection;
    discardSelection();
    buildTextIndex();

    const anchor = anchorFor(selection);
    if (!anchor || !anchor.block) return;

    closeComposer();
    const slot = commentsSlot(anchor.block);
    const form = buildForm({ quote: anchor.quote, anchor });
    slot.prepend(form);
    composer = form;

    const textarea = form.querySelector('textarea');
    if (textarea) textarea.focus({ preventScroll: true });
  }

  function closeComposer() {
    if (composer && composer.isConnected) composer.remove();
    composer = null;
  }

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  article.dataset.comments = shown ? 'shown' : 'hidden';
  updateToggle();

  if (toggle) toggle.addEventListener('click', () => void toggleComments());

  body.addEventListener('click', (event) => {
    if (!shown || !threads.length) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('a, [data-comment-ui]')) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    buildTextIndex();
    const offset = offsetFromPoint(event.clientX, event.clientY);
    if (offset === null) return;

    const thread = commentAtOffset(offset);
    if (thread) revealComment(thread.id);
  });

  article.addEventListener('click', (event) => {
    if (!shown || !(event.target instanceof Element)) return;

    const element = event.target.closest('.comment');
    if (!element || !element.thread) return;
    if (event.target.closest('a, button, summary, input, textarea, select, label')) return;

    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;

    flashText(element.thread);
  });

  document.addEventListener('pointerup', (event) => {
    if (event.target instanceof Element && event.target.closest('.comment-bubble')) return;
    captureSelection();
  });

  document.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Element && event.target.closest('.comment-bubble')) return;
    discardSelection();
  });

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      discardSelection();
      return;
    }

    if (!shown) return;

    // Android Chrome commits a long-press selection after the gesture ends, so
    // pointerup can arrive while the selection is still collapsed. Wait for the
    // handles to settle, then offer the button from the live selection.
    window.clearTimeout(selectionTimer);
    selectionTimer = window.setTimeout(() => {
      selectionTimer = 0;
      captureSelection();
    }, 250);
  });

  window.addEventListener(
    'scroll',
    () => {
      const selection = window.getSelection();
      if (!shown || !selection || selection.isCollapsed) {
        discardSelection();
        return;
      }

      // A selection is still live, so the page is probably scrolling to make
      // room for the selection handles. Keep the button with the selection
      // instead of dropping it; the pending capture will place it if needed.
      if (bubble && !bubble.hidden) captureSelection();
    },
    { passive: true },
  );
  window.addEventListener('resize', () => {
    discardSelection();
    scheduleAlign();
  });

  window.addEventListener('beforeprint', () => {
    for (const item of body.querySelectorAll('.comment')) item.style.marginTop = '';
  });

  window.addEventListener('afterprint', scheduleAlign);

  body.addEventListener('toggle', scheduleAlign, true);

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(scheduleAlign).catch(() => {});
  }

  if (shown) void load();
})();
