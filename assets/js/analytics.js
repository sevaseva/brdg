/* Shared GA4 events for the site's vanilla scripts.

   The layouts define gtag() only when _config.yml sets google_analytics, so
   every call is a no-op in a build without analytics, and a blocked gtag.js
   never breaks a feature. ANALYTICS.md is the catalog of every event, its
   parameters, and the privacy rules; keep that page in step with this file.

   Feature scripts call the two globals with optional chaining, so a page that
   somehow loads a feature without this file still works:

     window.clubTrack?.(name, params)
     window.clubTrackFailure?.(actionEvent, failureReason, params)

   This file also owns the two events that are easier to observe centrally than
   at each call site: video_watch (YouTube player messages) and outbound_link
   (a delegated click listener). */
(() => {
  'use strict';

  // ---- shared helpers ------------------------------------------------------

  function track(name, params) {
    if (typeof window.gtag !== 'function') return;

    window.gtag('event', name, params);
  }

  function trackFailure(actionEvent, failureReason, params) {
    track('action_failed', {
      action_event: actionEvent,
      failure_reason: failureReason,
      ...params,
    });
  }

  window.clubTrack = track;
  window.clubTrackFailure = trackFailure;

  // ---- video_watch ---------------------------------------------------------
  // Counts real playback, not page views. A YouTube embed posts its player
  // state to the parent frame when its URL carries enablejsapi=1, so the prep
  // iframes and the trailer dialog add that parameter and this listener reads
  // the message. No third-party script is loaded for it. One event per iframe
  // per page load, however many times the player starts.

  const watchedFrames = new WeakSet();

  function frameFor(source) {
    for (const frame of document.querySelectorAll('iframe[data-video-id]')) {
      if (frame.contentWindow === source) return frame;
    }

    return null;
  }

  function playerState(payload) {
    if (!payload || typeof payload !== 'object') return null;

    if (payload.event === 'onStateChange' && typeof payload.info === 'number') {
      return payload.info;
    }

    if (
      payload.event === 'infoDelivery' &&
      payload.info &&
      typeof payload.info.playerState === 'number'
    ) {
      return payload.info.playerState;
    }

    return null;
  }

  function trackVideoWatch(frame) {
    const params = {
      video_title: frame.getAttribute('data-video-title') || frame.getAttribute('title') || 'video',
      video_provider: 'youtube',
    };
    const videoId = frame.getAttribute('data-video-id');

    if (videoId) params.video_id = videoId;

    track('video_watch', params);
  }

  window.addEventListener('message', (event) => {
    if (!/^https:\/\/(www\.)?youtube(-nocookie)?\.com$/.test(event.origin)) return;
    if (typeof event.data !== 'string') return;

    let payload;

    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    // 1 is YouTube's "playing" state; everything else is ignored.
    if (playerState(payload) !== 1) return;

    const frame = frameFor(event.source);
    if (!frame || watchedFrames.has(frame)) return;

    watchedFrames.add(frame);
    trackVideoWatch(frame);
  });

  // ---- outbound_link -------------------------------------------------------
  // Every link that leaves the site, without per-link markup. Same-site links
  // and non-HTTP links are ignored. The text is the site's own link label,
  // never anything a visitor typed.

  function trackOutboundLink(link) {
    let url;

    try {
      url = new URL(link.href, window.location.href);
    } catch {
      return;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.hostname === window.location.hostname) return;

    const text = (link.getAttribute('aria-label') || link.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);

    track('outbound_link', {
      link_domain: url.hostname.replace(/^www\./, ''),
      link_text: text || 'link',
      link_url: url.href.slice(0, 100),
    });
  }

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;

    const link = event.target.closest('a[href]');
    if (link) trackOutboundLink(link);
  });
})();
