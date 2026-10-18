/**
 * Digital NEXUS — High-End 24 FPS Image Sequence & Scroll-Driven Logo Animation Engine
 * Uses frames: digital_nexus_frames/frame_0001.jpg -> frame_0145.jpg (145 frames @ 24fps)
 */
(function () {
  const TOTAL_FRAMES = 145;
  const FPS = 24;
  const FRAME_DURATION = 1000 / FPS;
  const FRAME_PATH = 'digital_nexus_frames/frame_';

  // Shared in-memory frame cache so multiple canvases (Hero Auto-Loop + Scroll Section) never double-fetch
  const frames = new Array(TOTAL_FRAMES);
  let loadedCount = 0;
  let firstFrameLoaded = false;
  const onFirstFrameCallbacks = [];
  const onProgressCallbacks = [];

  function padFrame(num) {
    return String(num).padStart(4, '0');
  }

  function preloadFrames() {
    for (let i = 1; i <= TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `${FRAME_PATH}${padFrame(i)}.jpg`;
      img.onload = () => {
        loadedCount++;
        if (i === 1 && !firstFrameLoaded) {
          firstFrameLoaded = true;
          onFirstFrameCallbacks.forEach((cb) => cb(img));
        }
        onProgressCallbacks.forEach((cb) => cb(loadedCount, TOTAL_FRAMES));
      };
      frames[i - 1] = img;
    }
  }

  /**
   * Renders a frame index (0-based float) onto a canvas with optional crossfade at loop end
   */
  function drawFrame(ctx, canvas, frameIndexFloat, crossfadeLoop = false) {
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
    if (crossfadeLoop && idx >= TOTAL_FRAMES - 10 && frames[0] && frames[0].complete) {
      const blend = (frameIndexFloat - (TOTAL_FRAMES - 10)) / 10;
      ctx.globalAlpha = Math.max(0, Math.min(1, blend));
      ctx.drawImage(frames[0], 0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Updates synchronized wordmark & HUD elements based on normalized progress (0..1)
   */
  function updateSyncedWordmark(rootEl, progress, frameNumber) {
    if (!rootEl) return;
    const wordmark = rootEl.querySelector('[data-dn-wordmark]');
    const divider = rootEl.querySelector('[data-dn-divider]');
    const subtitle = rootEl.querySelector('[data-dn-subtitle]');
    const frameCounter = rootEl.querySelector('[data-dn-counter]');
    const progressBar = rootEl.querySelector('[data-dn-progress]');

    // Wordmark reveal: ramps cleanly between frames 1 and 55, with luminous gold/cyan peak at frames 95..145
    const reveal = Math.min(1, Math.max(0.15, progress * 1.8));
    const glowIntensity = Math.max(0, (progress - 0.5) * 2);

    if (wordmark) {
      const spacing = (0.36 - reveal * 0.14).toFixed(3);
      const translateY = ((1 - reveal) * 14).toFixed(1);
      wordmark.style.opacity = reveal.toFixed(3);
      wordmark.style.letterSpacing = `${spacing}em`;
      wordmark.style.transform = `translateY(${translateY}px)`;
      wordmark.style.textShadow = `0 0 ${(18 + glowIntensity * 28).toFixed(0)}px rgba(245, 158, 11, ${(0.25 + glowIntensity * 0.45).toFixed(2)}), 0 0 ${(24 + glowIntensity * 36).toFixed(0)}px rgba(56, 189, 248, ${(0.2 + glowIntensity * 0.4).toFixed(2)})`;
    }

    if (divider) {
      const scaleX = (0.35 + reveal * 0.65).toFixed(3);
      divider.style.transform = `scaleX(${scaleX})`;
      divider.style.opacity = reveal.toFixed(3);
    }

    if (subtitle) {
      if (frameNumber < 48) {
        subtitle.textContent = 'NEURAL GOLD ARCHITECTURE • SYNAPSE INITIALIZATION';
      } else if (frameNumber < 98) {
        subtitle.textContent = 'QUANTUM LATTICE CONVERGENCE • DUAL-CORE FUSION';
      } else {
        subtitle.textContent = 'DIGITAL NEXUS SINGULARITY • FULL SPECTRUM IGNITION';
      }
      subtitle.style.opacity = (0.5 + reveal * 0.5).toFixed(2);
    }

    if (frameCounter) {
      frameCounter.textContent = `FRAME ${String(frameNumber).padStart(3, '0')} / ${TOTAL_FRAMES} • 24 FPS`;
    }

    if (progressBar) {
      progressBar.style.width = `${(progress * 100).toFixed(1)}%`;
    }
  }

  /**
   * 1. Hero Auto-Loop Controller (24 FPS continuous playback)
   */
  function initHeroAutoLoop(canvasId, wrapperId) {
    const canvas = document.getElementById(canvasId);
    const wrapper = document.getElementById(wrapperId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let currentFrame = 0;
    let lastTime = performance.now();
    let isPlaying = true;

    onFirstFrameCallbacks.push(() => {
      canvas.classList.add('dn-loaded');
      drawFrame(ctx, canvas, 0, true);
      updateSyncedWordmark(wrapper, 0, 1);
    });

    function tick(now) {
      const elapsed = now - lastTime;
      if (isPlaying && elapsed >= FRAME_DURATION) {
        const framesToAdvance = elapsed / FRAME_DURATION;
        currentFrame = (currentFrame + framesToAdvance) % TOTAL_FRAMES;
        lastTime = now;

        const frameInt = Math.floor(currentFrame) + 1;
        const progress = currentFrame / (TOTAL_FRAMES - 1);
        drawFrame(ctx, canvas, currentFrame, true);
        updateSyncedWordmark(wrapper, progress, frameInt);
      }
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);

    return {
      togglePlay() {
        isPlaying = !isPlaying;
        lastTime = performance.now();
        return isPlaying;
      }
    };
  }

  /**
   * 2. Scroll-Triggered / Scroll-Scrubbed Showcase Controller (with Auto-Loop toggle)
   */
  function initScrollShowcase(sectionId, canvasId, wrapperId) {
    const section = document.getElementById(sectionId);
    const canvas = document.getElementById(canvasId);
    const wrapper = document.getElementById(wrapperId);
    if (!section || !canvas) return;
    const ctx = canvas.getContext('2d');

    let mode = 'scroll'; // 'scroll' | 'autoloop'
    let targetFrame = 0;
    let smoothFrame = 0;
    let lastAutoTime = performance.now();

    onFirstFrameCallbacks.push(() => {
      canvas.classList.add('dn-loaded');
      drawFrame(ctx, canvas, 0, false);
      updateSyncedWordmark(wrapper, 0, 1);
    });

    onProgressCallbacks.push((loaded, total) => {
      const badge = wrapper ? wrapper.querySelector('[data-dn-load-status]') : null;
      if (badge) {
        if (loaded >= total) {
          badge.textContent = '145 / 145 FRAMES READY (24 FPS)';
        } else {
          badge.textContent = `BUFFERING SEQUENCE ${Math.round((loaded / total) * 100)}%`;
        }
      }
    });

    function computeScrollProgress() {
      const rect = section.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const scrollableDistance = rect.height - viewportHeight;
      if (scrollableDistance <= 0) return 0;
      const scrolled = -rect.top;
      return Math.max(0, Math.min(1, scrolled / scrollableDistance));
    }

    window.addEventListener(
      'scroll',
      () => {
        if (mode === 'scroll') {
          const progress = computeScrollProgress();
          targetFrame = progress * (TOTAL_FRAMES - 1);
        }
      },
      { passive: true }
    );

    function renderLoop(now) {
      if (mode === 'scroll') {
        const progress = computeScrollProgress();
        targetFrame = progress * (TOTAL_FRAMES - 1);
        smoothFrame += (targetFrame - smoothFrame) * 0.16;
        if (Math.abs(targetFrame - smoothFrame) < 0.05) {
          smoothFrame = targetFrame;
        }
        const frameInt = Math.min(TOTAL_FRAMES, Math.max(1, Math.round(smoothFrame) + 1));
        drawFrame(ctx, canvas, smoothFrame, false);
        updateSyncedWordmark(wrapper, smoothFrame / (TOTAL_FRAMES - 1), frameInt);
      } else {
        const elapsed = now - lastAutoTime;
        if (elapsed >= FRAME_DURATION) {
          smoothFrame = (smoothFrame + elapsed / FRAME_DURATION) % TOTAL_FRAMES;
          lastAutoTime = now;
          const frameInt = Math.floor(smoothFrame) + 1;
          drawFrame(ctx, canvas, smoothFrame, true);
          updateSyncedWordmark(wrapper, smoothFrame / (TOTAL_FRAMES - 1), frameInt);
        }
      }
      requestAnimationFrame(renderLoop);
    }

    requestAnimationFrame(renderLoop);

    // Expose mode switcher for UI pills
    window.setDigitalNexusAnimationMode = function (newMode) {
      mode = newMode;
      lastAutoTime = performance.now();
      document.querySelectorAll('[data-dn-mode-btn]').forEach((btn) => {
        btn.classList.toggle('active', btn.getAttribute('data-dn-mode-btn') === newMode);
      });
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    preloadFrames();
    initHeroAutoLoop('dnHeroSequenceCanvas', 'dnHeroSequenceCard');
    initScrollShowcase('dnScrollSection', 'dnScrollSequenceCanvas', 'dnScrollStage');
  });
})();
