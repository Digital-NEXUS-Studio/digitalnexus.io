/**
 * Digital NEXUS — Clean 24 FPS Auto-Loop Image Sequence Animation Engine
 * Uses frames: digital_nexus_frames/frame_0001.jpg -> frame_0145.jpg (145 frames @ 24fps)
 */
(function () {
  const TOTAL_FRAMES = 145;
  const FPS = 24;
  const FRAME_DURATION = 1000 / FPS;
  const FRAME_PATH = 'digital_nexus_frames/frame_';

  const frames = new Array(TOTAL_FRAMES);
  let firstFrameLoaded = false;
  const onFirstFrameCallbacks = [];

  function padFrame(num) {
    return String(num).padStart(4, '0');
  }

  function preloadFrames() {
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `${FRAME_PATH}${padFrame(i)}.jpg`;
      img.onload = () => {
        if (i === 1 && !firstFrameLoaded) {
          firstFrameLoaded = true;
          onFirstFrameCallbacks.forEach((cb) => cb(img));
        }
      };
      frames[i - 1] = img;
    }
  }

  function drawFrame(ctx, canvas, frameIndexFloat) {
    const idx = Math.max(0, Math.min(TOTAL_FRAMES - 1, Math.floor(frameIndexFloat)));
    const img = frames[idx];
    if (!img || !img.complete || img.naturalWidth === 0) return;

    if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    // Seamless crossfade over last 10 frames back into frame 1 for silky infinite loop
    if (idx >= TOTAL_FRAMES - 10 && frames[0] && frames[0].complete) {
      const blend = (frameIndexFloat - (TOTAL_FRAMES - 10)) / 10;
      ctx.globalAlpha = Math.max(0, Math.min(1, blend));
      ctx.drawImage(frames[0], 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  function updateSyncedWordmark(rootEl, progress) {
    if (!rootEl) return;
    const wordmark = rootEl.querySelector('[data-dn-wordmark]');
    const divider = rootEl.querySelector('[data-dn-divider]');

    const reveal = Math.min(1, Math.max(0.25, progress * 1.8));
    const glowIntensity = Math.max(0, (progress - 0.5) * 2);

    if (wordmark) {
      const spacing = (0.34 - reveal * 0.10).toFixed(3);
      const translateY = ((1 - reveal) * 10).toFixed(1);
      wordmark.style.opacity = reveal.toFixed(3);
      wordmark.style.letterSpacing = `${spacing}em`;
      wordmark.style.transform = `translateY(${translateY}px)`;
      wordmark.style.textShadow = `0 0 ${(16 + glowIntensity * 24).toFixed(0)}px rgba(245, 158, 11, ${(0.22 + glowIntensity * 0.4).toFixed(2)}), 0 0 ${(22 + glowIntensity * 30).toFixed(0)}px rgba(56, 189, 248, ${(0.18 + glowIntensity * 0.35).toFixed(2)})`;
    }

    if (divider) {
      const scaleX = (0.4 + reveal * 0.6).toFixed(3);
      divider.style.transform = `scaleX(${scaleX})`;
      divider.style.opacity = reveal.toFixed(3);
    }
  }

  function initAutoLoop(canvasId, wrapperId) {
    const canvas = document.getElementById(canvasId);
    const wrapper = document.getElementById(wrapperId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let currentFrame = 0;
    let lastTime = performance.now();

    onFirstFrameCallbacks.push(() => {
      canvas.classList.add('dn-loaded');
      drawFrame(ctx, canvas, 0);
      updateSyncedWordmark(wrapper, 0);
    });

    function tick(now) {
      const elapsed = now - lastTime;
      if (elapsed >= FRAME_DURATION) {
        const framesToAdvance = elapsed / FRAME_DURATION;
        currentFrame = (currentFrame + framesToAdvance) % TOTAL_FRAMES;
        lastTime = now;

        const progress = currentFrame / (TOTAL_FRAMES - 1);
        drawFrame(ctx, canvas, currentFrame);
        updateSyncedWordmark(wrapper, progress);
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  }

  document.addEventListener('DOMContentLoaded', () => {
    preloadFrames();
    initAutoLoop('dnHeroSequenceCanvas', 'dnHeroSequenceCard');
  });
})();
