/* Shared GA4 events for the site's vanilla scripts.

   The layout defines gtag() only when _config.yml sets google_analytics, so
   every call is a no-op in a build without analytics, and a blocked gtag.js
   never breaks a feature. Events are plain GA4 custom events; none of them
   carry a visitor's name, comment text, or other entered personal data.

   The video listener counts real playback, not a page view. A YouTube embed
   posts its player state to the parent frame when its URL carries
   enablejsapi=1, so the prep-page iframes and the trailer dialog add that
   parameter and this file listens for the message. No third-party script is
   loaded for it. */
(() => {
  'use strict';

  window.clubTrack = function clubTrack(name, params) {
    if (typeof window.gtag !== 'function') return;

    window.gtag('event', name, params);
  };

  const watched = new WeakSet();

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
    if (!frame || watched.has(frame)) return;

    watched.add(frame);

    const params = {
      video_title: frame.getAttribute('data-video-title') || frame.getAttribute('title') || 'video',
      video_provider: 'youtube',
    };
    const videoId = frame.getAttribute('data-video-id');

    if (videoId) params.video_id = videoId;

    window.clubTrack('video_watch', params);
  });
})();
