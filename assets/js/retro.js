/* Small, dependency-free late-1990s-style enhancements. */
(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Fictional visitor counter
  // -------------------------------------------------------------------------

  const counter = document.querySelector('[data-counter]');

  if (counter) {
    try {
      const key = 'cobb-bridge-club-visits';
      const stored = Number.parseInt(window.localStorage.getItem(key) || '41', 10);
      const visits = (Number.isFinite(stored) ? stored : 41) + 1;
      window.localStorage.setItem(key, String(visits));
      counter.textContent = String(visits).padStart(6, '0');
    } catch {
      // localStorage may be unavailable; keep the static counter.
    }
  }

  // -------------------------------------------------------------------------
  // Snowed-in webring
  // -------------------------------------------------------------------------

  const webringStatus = document.querySelector('[data-webring-status]');

  document.querySelectorAll('[data-webring]').forEach((button) => {
    button.addEventListener('click', () => {
      if (webringStatus) {
        webringStatus.textContent = 'The webring is snowed in. Try again after the thaw.';
      }
    });
  });

  // -------------------------------------------------------------------------
  // Suit-shaped click sparkles
  // -------------------------------------------------------------------------

  const suits = ['♠', '♥', '♦', '♣'];
  const sparkleColors = ['#ffe14d', '#ff3ea5', '#35f0e0', '#ff8a3d'];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!reduceMotion) {
    document.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      const sparkle = document.createElement('span');
      sparkle.className = 'sparkle';
      sparkle.textContent = suits[Math.floor(Math.random() * suits.length)];
      sparkle.style.left = `${event.clientX}px`;
      sparkle.style.top = `${event.clientY}px`;
      sparkle.style.setProperty(
        '--sparkle-color',
        sparkleColors[Math.floor(Math.random() * sparkleColors.length)],
      );
      document.body.appendChild(sparkle);
      sparkle.addEventListener('animationend', () => sparkle.remove());
    });
  }

  // -------------------------------------------------------------------------
  // A tiny, entirely original "MIDI" tune. No autoplay; click to start/stop.
  // -------------------------------------------------------------------------

  const midiButton = document.querySelector('[data-midi]');
  const midiStatus = document.querySelector('[data-midi-status]');
  const melody = [
    523.25, 659.25, 783.99, 1046.5, 783.99, 659.25, 587.33, 698.46, 880, 1174.66, 880, 698.46,
  ];
  const noteLength = 0.16;

  let audioContext;
  let midiTimer;
  let midiStep = 0;

  function playNote(frequency, startTime) {
    if (!audioContext) {
      return;
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'square';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.04, startTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + noteLength);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(startTime);
    oscillator.stop(startTime + noteLength + 0.02);
  }

  function scheduleMidi() {
    if (!audioContext) {
      return;
    }

    playNote(melody[midiStep % melody.length], audioContext.currentTime);
    midiStep += 1;
    midiTimer = window.setTimeout(scheduleMidi, noteLength * 1000 * 1.15);
  }

  function stopMidi() {
    window.clearTimeout(midiTimer);
    midiTimer = undefined;

    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = undefined;
    }

    if (midiButton) {
      midiButton.textContent = '♫ MIDI: OFF';
      midiButton.setAttribute('aria-pressed', 'false');
    }

    if (midiStatus) {
      midiStatus.hidden = true;
    }
  }

  if (midiButton) {
    midiButton.addEventListener('click', () => {
      if (audioContext) {
        stopMidi();
        return;
      }

      const AudioContext = window.AudioContext || window.webkitAudioContext;

      if (!AudioContext) {
        if (midiStatus) {
          midiStatus.hidden = false;
          midiStatus.textContent = 'Your browser cannot play MIDI. Try Netscape Navigator 4.0.';
        }
        return;
      }

      audioContext = new AudioContext();
      midiStep = 0;
      midiButton.textContent = '♫ MIDI: ON';
      midiButton.setAttribute('aria-pressed', 'true');

      if (midiStatus) {
        midiStatus.hidden = false;
      }

      scheduleMidi();
    });
  }

  window.addEventListener('pagehide', stopMidi);
})();
