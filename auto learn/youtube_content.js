console.log('[Rikkei Booster YT] Youtube Content Script Loaded');

// Safe duration override for testing environments lacking proprietary media codecs
const nativeYtDurationGetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')?.get;
try {
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    get: function() {
      const realDur = nativeYtDurationGetter ? nativeYtDurationGetter.call(this) : NaN;
      if (Number.isFinite(realDur) && realDur > 0) return realDur;
      return 180; // Fallback mock duration of 3 minutes for testing
    },
    configurable: true
  });
} catch(e) {
  console.error('[Rikkei Booster YT] Error overriding prototype duration:', e);
}

let settings = {
  autoLearn: true,
  autoSub: true,
  autoNext: true,
  seekSpeed: 10,
  videoSpeed: 2
};

let playSource = 'native'; // Default

// Listen for settings and commands from the parent page
window.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'RikkeiBoosterSettings') {
      settings = data.settings;
      console.log('[Rikkei Booster YT] Received settings:', settings);
      applyYoutubeSubtitles();
    } else if (data.type === 'RikkeiBoosterPlaySource') {
      playSource = data.playSource;
      console.log('[Rikkei Booster YT] Play source synchronized from parent:', playSource);
    } else if (data.type === 'RikkeiBoosterTriggerSeek') {
      console.log('[Rikkei Booster YT] Received remote seek command. Triggering step-seek...');
      startSimulatedSeek();
    } else if (data.type === 'seekToEnd') {
      console.log('[Rikkei Booster YT] Received custom seekToEnd message. Targeting:', data.target);
      const video = document.querySelector('video');
      if (video) {
        video.currentTime = data.target;
        video.play().catch(() => {});
      }
    }
  } catch (e) {
    // Ignore non-JSON messages
  }
});

// Notify parent page that YouTube script is ready
let readyInterval = setInterval(() => {
  window.parent.postMessage(JSON.stringify({ type: 'RikkeiBoosterYoutubeReady' }), '*');
}, 1000);

// Hook video elements
let videoHooked = false;
function hookYoutubeVideo() {
  const video = document.querySelector('video');
  if (!video) return;
  
  if (videoHooked) return;
  videoHooked = true;
  clearInterval(readyInterval);

  console.log('[Rikkei Booster YT] Found video player, hooking events...');

  // 1. Report playback progress
  video.addEventListener('timeupdate', () => {
    if (video.duration) {
      const progress = (video.currentTime / video.duration) * 100;
      window.parent.postMessage(JSON.stringify({
        type: 'RikkeiBoosterYoutubeProgress',
        progress: progress
      }), '*');
    }
  });

  // 2. Capture native play event to distinguish from external play
  // Click on the player area or play button indicates native play
  document.addEventListener('click', (e) => {
    if (!e.target || typeof e.target.closest !== 'function') return;
    const playBtn = document.querySelector('.ytp-play-button');
    const largePlayBtn = document.querySelector('.ytp-large-play-button');
    const isPlayer = e.target.closest('.html5-video-player');
    
    if (e.target.closest('.ytp-play-button') || e.target.closest('.ytp-large-play-button') || isPlayer) {
      playSource = 'native';
      console.log('[Rikkei Booster YT] Played via Native Video Player. Physical keyboard seek allowed.');
      
      // Notify parent page
      window.parent.postMessage(JSON.stringify({
        type: 'RikkeiBoosterPlaySource',
        playSource: 'native'
      }), '*');
    }
  });

  // 3. Intercept Right Arrow keypress to jump to the end (Bypass Hook)
  window.addEventListener('keydown', (e) => {
    // Relay all keydowns inside iframe to parent for logs
    try {
      window.parent.postMessage(JSON.stringify({
        type: 'RikkeiBoosterIframeLog',
        text: `[Iframe Bàn phím] Nhấn phím: "${e.key}" (code: ${e.code}, keyCode: ${e.keyCode})`
      }), '*');
    } catch(err) {}

    if (e.key === 'ArrowRight') {
      if (!settings.autoLearn) return;
      
      // Check if focus is inside the YouTube window
      // and if we are in native play mode
      if (document.hasFocus() || playSource === 'native') {
        if (playSource !== 'native') {
          console.log('[Rikkei Booster YT] Keyboard Right Arrow blocked. PlaySource:', playSource);
          return;
        }
        
        e.preventDefault();
        e.stopPropagation();
        
        const targetTime = video.duration * 0.96; // Seek to 96%
        console.log(`[Rikkei Booster YT] Physical Right Arrow pressed. Seeking from ${video.currentTime}s to ${targetTime}s (96%)`);
        video.currentTime = targetTime;
        
        // Temporarily show a notice on the YouTube player
        showNoticeOnPlayer(`Bypass: Đã tua nhanh tới 96%`);
      }
    }
  }, true); // Capture phase

  // Capture click events inside YouTube player iframe
  document.addEventListener('click', (e) => {
    if (!e.target) return;
    try {
      const tag = e.target.tagName;
      const classes = e.target.className || '';
      window.parent.postMessage(JSON.stringify({
        type: 'RikkeiBoosterIframeLog',
        text: `[Iframe Chuột] Click vào phần tử: <${tag}> class="${classes}"`
      }), '*');
    } catch(err) {}
  });
}

// Show a small overlay on the YouTube player for user feedback
function showNoticeOnPlayer(text) {
  let notice = document.getElementById('rikkei-booster-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'rikkei-booster-notice';
    notice.style.position = 'absolute';
    notice.style.top = '15px';
    notice.style.left = '15px';
    notice.style.background = 'rgba(239, 68, 68, 0.9)';
    notice.style.color = '#fff';
    notice.style.padding = '8px 12px';
    notice.style.borderRadius = '6px';
    notice.style.fontFamily = 'sans-serif';
    notice.style.fontSize = '12px';
    notice.style.fontWeight = 'bold';
    notice.style.zIndex = '99999';
    notice.style.transition = 'opacity 0.5s';
    document.body.appendChild(notice);
  }
  notice.textContent = text;
  notice.style.opacity = '1';
  
  setTimeout(() => {
    notice.style.opacity = '0';
  }, 2000);
}

// 4. Auto Subtitles
function applyYoutubeSubtitles() {
  if (!settings.autoSub) return;
  const subBtn = document.querySelector('.ytp-subtitles-button');
  if (subBtn && subBtn.getAttribute('aria-pressed') === 'false') {
    subBtn.click();
    console.log('[Rikkei Booster YT] Auto enabled subtitles');
  }
}

let simulatedSeekInterval = null;

function startSimulatedSeek() {
  if (simulatedSeekInterval) return;
  
  console.log('[Rikkei Booster YT] Starting optimized step-seeking...');
  
  simulatedSeekInterval = setInterval(() => {
    const video = document.querySelector('video');
    if (!video) return;
    
    // Direct step-seeking on the HTML5 video inside iframe
    const duration = video.duration;
    if (Number.isFinite(duration)) {
      const step = 15; // Seek forward 15 seconds every 200ms
      const targetTime = video.currentTime + step;
      
      if (targetTime < duration - 5) {
        video.currentTime = targetTime;
        console.log(`[Rikkei Booster YT] Seeking to: ${targetTime}s / ${duration}s`);
      } else {
        video.currentTime = duration - 5;
        stopSimulatedSeek();
      }
    }
  }, 200); // 200ms interval for stability
}

function stopSimulatedSeek() {
  if (simulatedSeekInterval) {
    clearInterval(simulatedSeekInterval);
    simulatedSeekInterval = null;
    console.log('[Rikkei Booster YT] Stopped simulated seek.');
  }
}

function checkAndStartSeek(progress) {
  if (settings.autoLearn && progress < 95) {
    startSimulatedSeek();
  } else if (progress >= 95) {
    stopSimulatedSeek();
  }
}

// Periodically automate YouTube video (autoplay, speed, seek) if autoLearn is enabled
function automateYoutubeVideo() {
  if (!settings.autoLearn) return;
  
  const video = document.querySelector('video');
  if (!video) return;

  // 1. Auto mute to allow autoplay
  if (!video.muted) {
    video.muted = true;
  }
  
  // 2. Set playback speed
  const targetSpeed = settings.videoSpeed || 2;
  if (video.playbackRate !== targetSpeed) {
    video.playbackRate = targetSpeed;
  }
  
  // 3. Auto play if paused and not ended
  if (video.paused && !video.ended) {
    video.play().catch(() => {
      const playBtn = document.querySelector('.ytp-play-button');
      if (playBtn) playBtn.click();
    });
  }

  // 4. Auto Seek using ArrowRight keys
  if (video.duration) {
    const progress = (video.currentTime / video.duration) * 100;
    checkAndStartSeek(progress);
  }
}

// Periodically check for video element (in case it loads late)
setInterval(hookYoutubeVideo, 1000);
setInterval(applyYoutubeSubtitles, 3000);
setInterval(automateYoutubeVideo, 1000);
