// State Variables
let currentCourse = null;
let activeItem = null; // s2-l1-video, s2-l1-reading, s2-l1-quiz
let playSource = null; // 'external' or 'native'
let isDragging = false;
let dragOffset = { x: 0, y: 0 };

// Extension settings matching storage defaults
const settings = {
  autoLearn: true,
  autoSub: true,
  autoNext: true,
  seekSpeed: 10,
  videoSpeed: 2
};

// UI Elements
const els = {
  homeView: document.getElementById('home-view'),
  learningView: document.getElementById('learning-view'),
  welcomeBanner: document.getElementById('welcome-banner'),
  videoBlock: document.getElementById('video-block'),
  readingBlock: document.getElementById('reading-block'),
  quizBlock: document.getElementById('quiz-block'),
  
  // Video player
  video: document.getElementById('sim-video'),
  nativeOverlay: document.getElementById('native-play-overlay'),
  btnPlayExt: document.getElementById('btn-play-external'),
  timeDisplay: document.getElementById('time-display'),
  timelineFill: document.getElementById('timeline-fill'),
  timelineContainer: document.getElementById('timeline-container'),
  bypassToast: document.getElementById('bypass-toast'),
  
  // Sidebar items
  itemVideo: document.getElementById('item-s2-l1-video'),
  itemReading: document.getElementById('item-s2-l1-reading'),
  itemQuiz: document.getElementById('item-s2-l1-quiz'),
  
  // Ext elements
  extPanel: document.getElementById('extension-simulator'),
  extStatus: document.getElementById('ext-status-text'),
  extProgressPct: document.getElementById('ext-progress-pct'),
  extProgressBarFill: document.getElementById('ext-progress-bar-fill'),
  extLogs: document.getElementById('ext-logs-list'),
  extBtnManualNext: document.getElementById('ext-btn-manual-next'),
  
  // Ext inputs
  chkAutoLearn: document.getElementById('ext-autoLearn'),
  chkAutoSub: document.getElementById('ext-autoSub'),
  chkAutoNext: document.getElementById('ext-autoNext'),
  numSeekSpeed: document.getElementById('ext-seekSpeed'),
  selVideoSpeed: document.getElementById('ext-videoSpeed')
};

// ==========================================================================
// INITIALIZATION & EXTENSION INPUT SYNC
// ==========================================================================
function init() {
  // Sync checkboxes
  els.chkAutoLearn.checked = settings.autoLearn;
  els.chkAutoSub.checked = settings.autoSub;
  els.chkAutoNext.checked = settings.autoNext;
  els.numSeekSpeed.value = settings.seekSpeed;
  els.selVideoSpeed.value = settings.videoSpeed || 2;

  // Listeners for switches
  els.chkAutoLearn.addEventListener('change', (e) => {
    settings.autoLearn = e.target.checked;
    addLog(`Cài đặt: Tự động học = ${settings.autoLearn ? 'BẬT' : 'TẮT'}`, 'system');
    if (settings.autoLearn) handleReadingAutoFill();
  });

  els.selVideoSpeed.addEventListener('change', (e) => {
    settings.videoSpeed = parseFloat(e.target.value) || 2;
    addLog(`Cài đặt: Tốc độ phát video = ${settings.videoSpeed}x`, 'system');
  });
  els.chkAutoSub.addEventListener('change', (e) => {
    settings.autoSub = e.target.checked;
    addLog(`Cài đặt: Tự động phụ đề = ${settings.autoSub ? 'BẬT' : 'TẮT'}`, 'system');
  });
  els.chkAutoNext.addEventListener('change', (e) => {
    settings.autoNext = e.target.checked;
    addLog(`Cài đặt: Chuyển bài tự động = ${settings.autoNext ? 'BẬT' : 'TẮT'}`, 'system');
  });
  
  // Handle click on IT-215 course card
  document.getElementById('it215-card').addEventListener('click', selectFastAPICourse);
  
  // Home Navigation
  document.getElementById('btn-home-nav').addEventListener('click', showHome);
  
  // Sidebar items selection
  els.itemVideo.addEventListener('click', () => selectSubItem('video'));
  els.itemReading.addEventListener('click', () => selectSubItem('reading'));
  els.itemQuiz.addEventListener('click', () => selectSubItem('quiz'));

  // Video logic listeners
  setupVideoPlayer();

  // Reading answers submission
  document.getElementById('btn-submit-reading').addEventListener('click', submitReadingAnswers);
  document.getElementById('btn-submit-quiz').addEventListener('click', submitQuizAnswers);

  // Manual next
  els.extBtnManualNext.addEventListener('click', triggerManualNext);

  // Dragging handler for simulator UI
  setupDraggable();
  
  addLog("Chờ người dùng chọn khoá học...", "system");
}

// Logger utility
function addLog(text, type = 'entry') {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `[${time}] ${text}`;
  els.extLogs.appendChild(entry);
  els.extLogs.scrollTop = els.extLogs.scrollHeight;
  
  // Update status bar on simulated extension too
  els.extStatus.textContent = text;
}

// Dragging panel helper
function setupDraggable() {
  const handle = document.getElementById('ext-drag-handle');
  handle.addEventListener('mousedown', (e) => {
    isDragging = true;
    dragOffset.x = e.clientX - els.extPanel.offsetLeft;
    dragOffset.y = e.clientY - els.extPanel.offsetTop;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    els.extPanel.style.left = `${e.clientX - dragOffset.x}px`;
    els.extPanel.style.top = `${e.clientY - dragOffset.y}px`;
    els.extPanel.style.bottom = 'auto';
    els.extPanel.style.right = 'auto';
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
  });
}

function toggleExtMinimize() {
  els.extPanel.classList.toggle('minimized');
}

// ==========================================================================
// NAVIGATION ACTIONS
// ==========================================================================
function selectFastAPICourse() {
  currentCourse = 'FastAPI';
  els.homeView.style.display = 'none';
  els.learningView.style.display = 'block';
  addLog("Đang truy cập môn IT-215: FastAPI", "system");
  addLog("Hãy chọn bài học trong sidebar danh sách để bắt đầu", "warning");
}

function showHome(e) {
  if (e) e.preventDefault();
  els.video.pause();
  els.learningView.style.display = 'none';
  els.homeView.style.display = 'block';
  currentCourse = null;
  addLog("Đã quay về Trang chủ", "system");
  updateProgressUI(0);
}

function selectSubItem(type) {
  // Reset active classes
  els.itemVideo.classList.remove('active');
  els.itemReading.classList.remove('active');
  els.itemQuiz.classList.remove('active');

  // Stop video
  els.video.pause();
  
  // Hide all blocks
  els.welcomeBanner.style.display = 'none';
  els.videoBlock.style.display = 'none';
  els.readingBlock.style.display = 'none';
  els.quizBlock.style.display = 'none';

  activeItem = type;

  if (type === 'video') {
    els.itemVideo.classList.add('active');
    els.videoBlock.style.display = 'block';
    addLog("Đã mở Video: Tổng quan kiến trúc Web", "system");
    
    // Reset video state
    els.video.currentTime = 0;
    delete els.video.dataset.autoSeeked;
    els.nativeOverlay.classList.remove('playing');
    playSource = null;
    updateProgressUI(0);
    
  } else if (type === 'reading') {
    els.itemReading.classList.add('active');
    els.readingBlock.style.display = 'block';
    addLog("Đã mở Bài đọc tham khảo", "system");
    updateProgressUI(0);
    
    // Trigger auto-fill if autoLearn is enabled
    handleReadingAutoFill();

  } else if (type === 'quiz') {
    els.itemQuiz.classList.add('active');
    els.quizBlock.style.display = 'block';
    addLog("Đã mở Bài trắc nghiệm", "system");
    updateProgressUI(0);
  }
}

// Progress UI update (Updates simulated extension progress bar)
function updateProgressUI(percentage) {
  const rounded = Math.min(100, Math.max(0, Math.round(percentage)));
  els.extProgressPct.textContent = rounded + '%';
  els.extProgressBarFill.style.width = rounded + '%';
}

// ==========================================================================
// VIDEO PLAYER LOGIC (CRITICAL BYPASS LOGIC)
// ==========================================================================
function setupVideoPlayer() {
  const video = els.video;

  // External (Portal UI) Play Button
  els.btnPlayExt.addEventListener('click', () => {
    if (video.paused) {
      video.play();
      playSource = 'external';
      els.btnPlayExt.textContent = '⏸';
      els.nativeOverlay.classList.add('playing');
      addLog("Phát bằng nút giao diện ngoài (KHOÁ TUA)", "warning");
    } else {
      video.pause();
      els.btnPlayExt.textContent = '▶';
      addLog("Tạm dừng Video", "system");
    }
  });

  // Native Play Button (Overlay mimicking YouTube native controls)
  els.nativeOverlay.addEventListener('click', () => {
    video.play();
    playSource = 'native';
    els.btnPlayExt.textContent = '⏸';
    els.nativeOverlay.classList.add('playing');
    addLog("Phát bằng trình phát Native. Cho phép tua phím cứng!", "success");
    video.focus();
  });

  // Video time update event
  video.addEventListener('timeupdate', () => {
    if (!video.duration) return;

    // Simulate auto-seek in simulator if autoLearn is enabled
    if (settings.autoLearn && !video.dataset.autoSeeked && video.duration > 5) {
      // Auto mute
      video.muted = true;
      // Auto set playback rate
      video.playbackRate = settings.videoSpeed || 2;
      
      const targetTime = video.duration - 5;
      if (video.currentTime < targetTime) {
        video.currentTime = targetTime;
        video.dataset.autoSeeked = 'true';
        addLog(`Bypass (Tự động): Đã tự động tua video đến 5s cuối (${formatTime(targetTime)}) ở tốc độ ${video.playbackRate}x!`, "success");
      }
    }

    const progress = (video.currentTime / video.duration) * 100;
    
    // Update timeline bar UI
    els.timelineFill.style.width = progress + '%';
    
    // Update time display text
    els.timeDisplay.textContent = formatTime(video.currentTime) + ' / ' + formatTime(video.duration);
    
    // Sync progress bar on extension
    updateProgressUI(progress);
  });

  // Timeline click (scrubbing check)
  els.timelineContainer.addEventListener('click', (e) => {
    // Check if seek is blocked
    if (playSource === 'external') {
      addLog("Lỗi: Không thể tua khi phát bằng nút giao diện!", "warning");
      
      // Flash the warning text
      const tooltip = document.getElementById('timeline-tooltip');
      tooltip.style.display = 'block';
      setTimeout(() => tooltip.style.display = 'none', 2500);
      return;
    }
    
    // If native play, allow scrubbing
    if (playSource === 'native') {
      const rect = els.timelineContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = clickX / rect.width;
      video.currentTime = video.duration * pct;
      addLog(`Đã tua thủ công tới ${Math.round(pct * 100)}%`, "system");
    }
  });

  // Handle video ended
  video.addEventListener('ended', () => {
    els.btnPlayExt.textContent = '▶';
    els.nativeOverlay.classList.remove('playing');
    addLog("Video bài học hoàn thành 100%!", "success");
    
    // Checkmark in sidebar list
    document.getElementById('status-s2-l1-video').textContent = '✔';
    document.getElementById('status-s2-l1-video').className = 'item-status done';
    
    // Auto next
    if (settings.autoNext) {
      addLog("Chuẩn bị chuyển sang bài tiếp theo (Bài đọc) sau 2 giây...", "system");
      setTimeout(() => {
        selectSubItem('reading');
      }, 2000);
    }
  });

  // Keyboard shortcut Hook: ArrowRight bypass (Requested)
  window.addEventListener('keydown', (e) => {
    if (activeItem !== 'video') return;
    
    if (e.key === 'ArrowRight') {
      if (!settings.autoLearn) {
        addLog("Tự động học đang TẮT, phím tua vật lý bị bỏ qua", "system");
        return;
      }

      if (playSource === 'native') {
        e.preventDefault();
        
        // Bypass jump: Set to 96% duration
        const bypassTime = video.duration * 0.96;
        video.currentTime = bypassTime;
        
        // Show success animation overlay toast
        els.bypassToast.classList.add('show');
        setTimeout(() => els.bypassToast.classList.remove('show'), 2000);
        
        addLog("Bypass: Đã bấm phím mũi tên phải! Video tua nhanh lên 96%", "success");
      } else {
        addLog("Phím tua bị chặn: Video đang phát qua nút giao diện ngoài!", "warning");
      }
    }
  });
}

function formatTime(secs) {
  const minutes = Math.floor(secs / 60);
  const seconds = Math.floor(secs % 60);
  return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
}

// ==========================================================================
// READING AUTOMATION LOGIC (READING MATERIAL AUTO ANSWER)
// ==========================================================================
let readingAutoFillTimer = null;
let readingSubmitTimer = null;

function handleReadingAutoFill() {
  // Clear any existing timers
  clearTimeout(readingAutoFillTimer);
  clearTimeout(readingSubmitTimer);

  if (activeItem !== 'reading') return;
  
  const textareas = [document.getElementById('ans1'), document.getElementById('ans2')];
  
  // If questions are already completed/submitted, do not refill
  const isDone = document.getElementById('status-s2-l1-reading').textContent === '✔';
  if (isDone) return;

  if (settings.autoLearn) {
    addLog("Nhận diện bài đọc! Chuẩn bị tự động điền câu hỏi trong 1.5 giây...", "system");
    
    // Step 1: Auto fill in 1.5 seconds
    readingAutoFillTimer = setTimeout(() => {
      document.getElementById('q1-status').textContent = 'Đang điền...';
      document.getElementById('q1-status').className = 'q-badge badge-success';
      document.getElementById('q2-status').textContent = 'Đang điền...';
      document.getElementById('q2-status').className = 'q-badge badge-success';
      
      const t1 = textareas[0];
      const t2 = textareas[1];
      
      const txt1 = "FastAPI là một Python web framework hiện đại, hiệu năng cực cao được xây dựng trên Starlette và Pydantic. Khác biệt chính: SSR render HTML từ server còn Web Service trả về dữ liệu thuần JSON/XML.";
      const txt2 = "ASGI server như Uvicorn cho phép xử lý không đồng bộ (asynchronous) đa luồng cực nhanh, tận dụng được tính năng async/await của FastAPI, điều mà các WSGI truyền thống không hỗ trợ.";
      
      // Insert txt1 at t1 cursor
      const start1 = t1.selectionStart;
      const end1 = t1.selectionEnd;
      t1.value = t1.value.substring(0, start1) + txt1 + t1.value.substring(end1);
      t1.selectionStart = t1.selectionEnd = start1 + txt1.length;
      
      // Insert txt2 at t2 cursor
      const start2 = t2.selectionStart;
      const end2 = t2.selectionEnd;
      t2.value = t2.value.substring(0, start2) + txt2 + t2.value.substring(end2);
      t2.selectionStart = t2.selectionEnd = start2 + txt2.length;
      
      // Update progress
      updateProgressUI(50);
      addLog("Đã điền xong câu trả lời tại vị trí con trỏ. Chuẩn bị tự động NỘP (Lưu) trong 1.5 giây nữa...", "success");
      
      // Step 2: Auto submit in another 1.5 seconds
      readingSubmitTimer = setTimeout(() => {
        submitReadingAnswers();
      }, 1500);

    }, 1500);
  }
}

function toggleAccordion(id) {
  const body = document.getElementById(id);
  body.classList.toggle('active');
}

function toggleSession(id) {
  const body = document.getElementById(id);
  const isVisible = body.style.display === 'block';
  body.style.display = isVisible ? 'none' : 'block';
}

function toggleLessonItems(id) {
  const body = document.getElementById(id);
  const isVisible = body.style.display === 'block';
  body.style.display = isVisible ? 'none' : 'block';
}

function submitReadingAnswers() {
  const ans1 = document.getElementById('ans1').value.trim();
  const ans2 = document.getElementById('ans2').value.trim();

  if (ans1 === '' || ans2 === '') {
    addLog("Lỗi: Vui lòng điền đầy đủ đáp án trước khi nộp!", "warning");
    return;
  }

  // Update status labels
  document.getElementById('q1-status').textContent = 'Đã trả lời';
  document.getElementById('q1-status').className = 'q-badge badge-success';
  document.getElementById('q2-status').textContent = 'Đã trả lời';
  document.getElementById('q2-status').className = 'q-badge badge-success';

  addLog("Đã nộp bài đọc! Hệ thống ghi nhận hoàn thành học phần này.", "success");
  
  // Set progress on simulated extension to 100%
  updateProgressUI(100);

  // Sidebar item checkmark
  document.getElementById('status-s2-l1-reading').textContent = '✔';
  document.getElementById('status-s2-l1-reading').className = 'item-status done';

  // Check if session 2 is completely done
  checkSession2Completion();

  // Auto Next
  if (settings.autoNext) {
    addLog("Chuẩn bị chuyển sang bài trắc nghiệm sau 2 giây...", "system");
    setTimeout(() => {
      selectSubItem('quiz');
    }, 2000);
  }
}

// ==========================================================================
// QUIZ & MANUAL NAVIGATION
// ==========================================================================
function submitQuizAnswers() {
  // Select option B automatically if none selected
  const options = document.getElementsByName('qopt');
  let selected = false;
  for (let opt of options) {
    if (opt.checked) selected = true;
  }
  
  if (!selected) {
    options[1].checked = true; // Select Starlette and Pydantic
    addLog("Tự động chọn đáp án đúng: Starlette và Pydantic", "success");
  }

  addLog("Đã hoàn thành bài trắc nghiệm!", "success");
  updateProgressUI(100);
  
  document.getElementById('status-s2-l1-quiz').textContent = '✔';
  document.getElementById('status-s2-l1-quiz').className = 'item-status done';

  checkSession2Completion();
}

function checkSession2Completion() {
  const vidDone = document.getElementById('status-s2-l1-video').textContent === '✔';
  const readDone = document.getElementById('status-s2-l1-reading').textContent === '✔';
  const quizDone = document.getElementById('status-s2-l1-quiz').textContent === '✔';

  if (vidDone && readDone && quizDone) {
    document.getElementById('icon-lesson-2-1').className = 'check-icon done';
    document.getElementById('icon-lesson-2-1').textContent = '✔';
    document.getElementById('icon-session-2').className = 'check-icon done';
    document.getElementById('icon-session-2').textContent = '✔';
    
    // Update total completed counter
    document.getElementById('sidebar-progress-text').textContent = '25/25 Bài học';
    addLog("🎉 Chúc mừng! Bạn đã hoàn thành toàn bộ khoá học IT-215!", "success");
  }
}

// Manual Next button triggered from Extension popup simulator
function triggerManualNext() {
  addLog("Yêu cầu chuyển bài thủ công từ Extension panel...", "system");
  
  if (!activeItem) {
    selectSubItem('video');
  } else if (activeItem === 'video') {
    selectSubItem('reading');
  } else if (activeItem === 'reading') {
    selectSubItem('quiz');
  } else if (activeItem === 'quiz') {
    addLog("Đã ở bài học cuối cùng của Session!", "warning");
  }
}

// Load
window.onload = init;
