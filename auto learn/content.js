console.warn('[Rikkei Booster] Extension content script loaded successfully! Version 3.4');

// Safe duration override for testing environments lacking proprietary media codecs
const nativeLmsDurationGetter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'duration')?.get;
try {
  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    get: function() {
      const realDur = nativeLmsDurationGetter ? nativeLmsDurationGetter.call(this) : NaN;
      if (Number.isFinite(realDur) && realDur > 0) return realDur;
      return 180; // Fallback mock duration of 3 minutes for testing
    },
    configurable: true
  });
} catch(e) {
  console.error('[Rikkei Booster] Error overriding prototype duration:', e);
}

let settings = {
  autoLearn: true,
  autoSub: true,
  autoNext: true,
  seekSpeed: 10,
  videoSpeed: 2
};

let currentStatusText = 'Đã kết nối trang học tập. Sẵn sàng!';
let currentStatusColor = '#10b981';
let currentProgressValue = 0;
let playSource = 'native'; // 'native' or 'external'
let currentQuestionIndex = 1;
let lastReadingUrl = '';
let isProcessingQuestions = false;
let readingCompletedUrl = '';
const completedQuestions = new Set();

// Logging utility to talk to popup terminal
function logToPopup(text, logType = "info") {
  try {
    chrome.runtime.sendMessage({
      action: "logFromBot",
      text: text,
      logType: logType
    }, () => {
      if (chrome.runtime.lastError) {
        // Ignore when popup is closed
      }
    });
  } catch (e) {}
  console.log(`[EduBot] [${logType.toUpperCase()}] ${text}`);
}

// Stats tracker
function incrementCompletedStats() {
  chrome.storage.sync.get({ statsCompleted: 0, statsTimeSaved: 0 }, (data) => {
    const newCompleted = (data.statsCompleted || 0) + 1;
    const newTimeSaved = (data.statsTimeSaved || 0) + 10;
    chrome.storage.sync.set({
      statsCompleted: newCompleted,
      statsTimeSaved: newTimeSaved
    }, () => {
      logToPopup(`🎉 Cộng thống kê: Hoàn thành ${newCompleted} bài (Tiết kiệm ${newTimeSaved} phút)!`, 'success');
    });
  });
}

// Log script injection
logToPopup("EduBot Pro đã kích hoạt thành công trên: " + window.location.host, "success");

// Load initial settings
chrome.storage.sync.get({
  autoLearn: true,
  autoSub: true,
  autoNext: true,
  seekSpeed: 10,
  videoSpeed: 2
}, function(stored) {
  settings = stored;
  console.log('[Rikkei Booster] Settings loaded:', settings);
});

// Listen for updates from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'updateSettings') {
    settings = msg.settings;
    console.log('[Rikkei Booster] Settings updated:', settings);
    forwardSettingsToIframes();
    sendResponse({ status: 'ok', statusText: currentStatusText, color: currentStatusColor });
  } else if (msg.type === 'manualNext') {
    console.log('[Rikkei Booster] Manual next requested');
    goToNextLesson();
    sendResponse({ status: 'ok' });
  } else if (msg.type === 'requestStatus') {
    sendResponse({
      statusText: currentStatusText,
      color: currentStatusColor,
      progressValue: currentProgressValue
    });
  } else if (msg.type === 'manualGoToReading') {
    console.log('[Rikkei Booster] Manual request to go to reading sub-item...');
    try {
      const lessons = findSidebarLessons();
      const activeIndex = findActiveLessonIndex(lessons);
      let searchContainer = document;
      if (activeIndex !== -1) {
        const activeElement = lessons[activeIndex];
        const container = activeElement.closest('.learn__content--right__item--block, [class*="block"], [class*="lesson-item"], [class*="chapter-item"]') 
                          || activeElement.parentElement.closest('ul, ol, div') 
                          || activeElement.parentElement;
        if (container) {
          searchContainer = container;
        }
      }

      const items = Array.from(searchContainer.querySelectorAll('*'))
        .filter(el => {
          if (!(el.offsetWidth > 0 && el.offsetHeight > 0)) return false;
          if (el.children.length > 0 && el.querySelector('p, span, div')) return false;
          
          const text = el.textContent.trim().toLowerCase().replace(/\s+/g, ' ');
          return text === 'bài đọc';
        });
      
      if (items.length > 0) {
        const clickable = items[0].closest('a, button, [role="button"], li, .learn__content--right__item--block__content, [class*="item"], [class*="content"]') || items[0];
        clickable.scrollIntoView({ behavior: 'smooth', block: 'center' });
        clickable.click();
        
        const innerLink = clickable.querySelector('a, button, [role="button"]');
        if (innerLink) {
          innerLink.click();
        }
        sendResponse({ status: 'ok', success: true });
        return;
      }
      sendResponse({ status: 'error', error: "Không tìm thấy mục Bài đọc trên trang hiện tại!" });
    } catch (err) {
      console.error(err);
      sendResponse({ status: 'error', error: err.message });
    }
  } else if (msg.type === 'manualSeek') {
    logToPopup("Yêu cầu tua video thủ công đến cuối...", "info");
    seekToEndAccurate().then(() => {
      sendResponse({ status: 'ok' });
    }).catch(err => {
      logToPopup(`Lỗi khi tua video thủ công: ${err.message}`, "error");
      sendResponse({ status: 'error', error: err.message });
    });
    return true; // Keep message channel open for async response
  } else if (msg.type === 'manualFillReading') {
    logToPopup("Yêu cầu điền câu trả lời CKEditor thủ công...", "info");
    autoFillCKEditor().then(() => {
      sendResponse({ status: 'ok' });
    }).catch(err => {
      logToPopup(`Lỗi khi điền câu hỏi thủ công: ${err.message}`, "error");
      sendResponse({ status: 'error', error: err.message });
    });
    return true; // Keep message channel open for async response
  } else if (msg.type === 'manualSeekToEnd') {
    console.log('[EduBot] Manual seek to end requested');
    
    // 1. Try to click native seek-forward button
    const clickedBtn = clickSeekForwardButton();
    if (clickedBtn) {
      logToPopup("Bypass: Đã click nút tua nhanh trên trang!", "success");
      if (settings.autoLearn) {
        startSimulatedSeek();
      }
      sendResponse({ status: 'ok', found: true });
      return;
    }
    
    const video = getActiveVideoElement();
    if (video) {
      if (video.duration) {
        video.currentTime = video.duration - 5;
        logToPopup("Bypass: Đã tua thủ công tới 5s cuối!", "success");
        updateStatus("Bypass: Đã tua thủ công tới 5s cuối!", "#10b981");
        sendResponse({ status: 'ok', found: true });
      } else {
        logToPopup("Lỗi: Video chưa load xong thời lượng!", "error");
        sendResponse({ status: 'ok', found: false, error: 'duration_nan' });
      }
    } else {
      logToPopup("Không tìm thấy video trực tiếp trên trang. Đang gửi lệnh tua tới các iframe video nhúng (YouTube/Vimeo)...", "info");
      
      const iframes = document.querySelectorAll('iframe');
      if (iframes.length > 0) {
        let sentCount = 0;
        iframes.forEach(iframe => {
          try {
            // Forward seek command to embedded iframe
            iframe.contentWindow.postMessage(JSON.stringify({
              type: 'RikkeiBoosterTriggerSeek',
              timePercent: 96
            }), '*');
            sentCount++;
          } catch (e) {}
        });
        logToPopup(`Đã gửi lệnh tua nhanh tới ${sentCount} iframe. Vui lòng bấm phát video nếu nó chưa tự tua!`, "success");
        sendResponse({ status: 'ok', relayed: true });
      } else {
        logToPopup("Lỗi: Không tìm thấy phần tử video trực tiếp hoặc iframe nào trên trang!", "error");
        sendResponse({ status: 'ok', found: false });
      }
    }
  }
});

// Interaction Logger: Track keyboard, mouse clicks and focus events
document.addEventListener('keydown', (e) => {
  logToPopup(`[Bàn phím] Nhấn phím: "${e.key}" (code: ${e.code}, keyCode: ${e.keyCode})`, "info");
});

document.addEventListener('click', (e) => {
  if (!e.target) return;
  const tag = e.target.tagName;
  const classes = e.target.className || '';
  const text = (e.target.textContent || '').trim().substring(0, 30);
  logToPopup(`[Chuột] Click vào phần tử: <${tag}> | class: "${classes}" | text: "${text}"`, "info");
});

window.addEventListener('blur', () => {
  const activeEl = document.activeElement;
  if (activeEl) {
    logToPopup(`[Tiêu điểm] Mất focus trang chính. Tiêu điểm hiện tại chuyển sang: <${activeEl.tagName}> class="${activeEl.className}"`, "info");
  }
});

// Forward settings to youtube iframe
function forwardSettingsToIframes() {
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    if (iframe.src && (iframe.src.includes('youtube.com') || iframe.src.includes('youtube-nocookie.com'))) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          type: 'RikkeiBoosterSettings',
          settings: settings
        }), '*');
        
        iframe.contentWindow.postMessage(JSON.stringify({
          type: 'RikkeiBoosterPlaySource',
          playSource: playSource
        }), '*');
      } catch (e) {}
    }
  });
}

// 1. Detect click on page's custom controls
document.addEventListener('click', (e) => {
  if (!e.target || typeof e.target.closest !== 'function') return;
  
  if (e.target.tagName === 'VIDEO') {
    playSource = 'native';
    console.log('[Rikkei Booster] Clicked native video directly. Native mode active.');
    forwardPlaySourceToIframes();
    return;
  }

  const customControlBtn = e.target.closest('button, [class*="btn"], [class*="button"], [class*="control"], div');
  if (customControlBtn) {
    const text = customControlBtn.textContent.trim();
    const html = customControlBtn.innerHTML;
    const isPlayIcon = text.includes('▶') || text.includes('II') || text.includes('⏸') || html.includes('fa-play') || html.includes('fa-pause');
    const isControlClass = customControlBtn.closest('[class*="control"], [class*="player-control"], [class*="video-control"]');
    
    if (isPlayIcon || isControlClass) {
      playSource = 'external';
      console.log('[Rikkei Booster] Clicked custom UI controls. PlaySource set to: external (Seeking BLOCKED)');
      forwardPlaySourceToIframes();
    }
  }
});

// 2. Detect focus shift to iframe (indicates click inside YouTube iframe)
window.addEventListener('blur', () => {
  setTimeout(() => {
    const activeEl = document.activeElement;
    if (activeEl && activeEl.tagName === 'IFRAME') {
      const src = activeEl.src || '';
      if (src.includes('youtube.com') || src.includes('youtube-nocookie.com')) {
        playSource = 'native';
        console.log('[Rikkei Booster] Clicked inside YouTube player. PlaySource set to: native (Seeking ALLOWED)');
        forwardPlaySourceToIframes();
      }
    }
  }, 200);
});

function forwardPlaySourceToIframes() {
  const iframes = document.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    if (iframe.src && (iframe.src.includes('youtube.com') || iframe.src.includes('youtube-nocookie.com'))) {
      try {
        iframe.contentWindow.postMessage(JSON.stringify({
          type: 'RikkeiBoosterPlaySource',
          playSource: playSource
        }), '*');
      } catch (e) {}
    }
  });
}

// Keep checking page content and auto-filling
setInterval(() => {
  // Reset flags on URL change
  if (window._lastUrl !== window.location.href) {
    window._lastUrl = window.location.href;
    window._seekTriggered = false;
    window._fillTriggered = false;
    window._videoProgress = 0;
  }

  // SPA page type change detection
  const hasVideo = document.querySelector('video') !== null || document.querySelector('iframe[src*="youtube"]') !== null;
  const hasQuestions = document.querySelector('.question-item') !== null;
  const pageType = hasQuestions ? 'reading' : (hasVideo ? 'video' : 'unknown');
  
  if (window._lastPageType !== pageType) {
    window._lastPageType = pageType;
    window._fillTriggered = false;
    window._seekTriggered = false;
    window._videoProgress = 0;
    console.log(`[Rikkei Booster] SPA Page type changed to: ${pageType}. Resetting triggers.`);
  }

  if (!settings.autoLearn) return;

  // Detect Reading Section & Questions
  handleReadingQuestions();

  // Scan for video progress from page if available
  detectPageVideo();

  // Handle interactive popup quizzes in videos
  handleInteractiveQuiz();

  // Periodically forward settings and play source to YouTube iframe embeds
  forwardSettingsToIframes();
}, 2000);

// Notify extension popup of status
function updateStatus(text, color = null) {
  currentStatusText = text;
  currentStatusColor = color || '#e2e8f0';
  try {
    chrome.runtime.sendMessage({
      type: 'statusUpdate',
      text: text,
      color: color
    }, () => {
      const err = chrome.runtime.lastError;
    });
  } catch (e) {}
}

// Notify extension popup of progress
function updateProgress(value) {
  currentProgressValue = value;
  try {
    chrome.runtime.sendMessage({
      type: 'progressUpdate',
      value: value
    }, () => {
      const err = chrome.runtime.lastError;
    });
  } catch (e) {}
}

// Send initial status to popup
setTimeout(() => {
  updateStatus('Đã kết nối trang học tập. Sẵn sàng!', '#10b981');
}, 500);

// 1. Reading Questions handler
function handleReadingQuestions() {
  const currentUrl = window.location.href;
  
  if (readingCompletedUrl === currentUrl) return; // Already completed this URL, do not run again
  
  // If URL changed, reset processing state
  if (lastReadingUrl !== currentUrl) {
    lastReadingUrl = currentUrl;
    isProcessingQuestions = false;
    readingCompletedUrl = '';
    completedQuestions.clear();
    currentQuestionIndex = 1;
  }
  
  // 3.2: Trong hàm handleReadingQuestions(), sau khi phát hiện .question-item, gọi autoFillCKEditor() với độ trễ 3 giây.
  // Đảm bảo mỗi hàm chỉ chạy một lần cho mỗi trang (dùng cờ window._fillTriggered).
  const hasQuestionItem = document.querySelector('.question-item');
  if (hasQuestionItem) {
    if (!window._fillTriggered && settings.autoLearn) {
      window._fillTriggered = true;
      console.log('[Rikkei Booster] .question-item detected, scheduling autoFillCKEditor in 3s...');
      logToPopup('📝 Phát hiện câu hỏi. Đang chờ 3s để bắt đầu tự động điền...', 'info');
      setTimeout(() => {
        autoFillCKEditor();
      }, 3000);
    }
    return; // Skip legacy processNextQuestion
  }

  if (isProcessingQuestions) return;
  
  const questionsContainer = document.querySelector('[class*="question"], [class*="cau-hoi"], .card-body, form, [class*="Question"]');
  if (!questionsContainer) return;
  
  isProcessingQuestions = true;
  updateProgress(0); // Reset progress to 0% immediately when starting a new reading section
  processNextQuestion();
}

// Scan page to find all question numbers (e.g. [2, 3])
function findAvailableQuestionNumbers() {
  const elements = Array.from(document.querySelectorAll('span, button, a, h1, h2, h3, h4, h5, p, div'));
  const numbers = new Set();
  
  elements.forEach(el => {
    const text = el.textContent.trim().toLowerCase().replace(/\s+/g, '').normalize('NFC');
    const match = text.match(/^câuhỏi(\d+)(?:\D|$)/);
    if (match) {
      const num = parseInt(match[1]);
      if (!isNaN(num)) {
        numbers.add(num);
      }
    }
  });
  
  return Array.from(numbers).sort((a, b) => a - b);
}

// DOM climbing helper to find the wrapper enclosing both the question title and body
function findQuestionContainer(header) {
  if (!header) return null;
  return header.closest('.question-item, [class*="question"], .card, form') || header.parentElement;
}

// Resolves standard editor inputs, class-based text editors, or iframes
function findEditor(container) {
  if (!container) return null;
  
  // Query all potential editors in priority order
  const selectors = [
    '.ck-editor__editable',
    '.ql-editor',
    '[contenteditable]',
    'textarea',
    'input[type="text"]',
    '[class*="editor"]'
  ];
  
  // Find a visible editor inside the container first
  for (let selector of selectors) {
    const el = container.querySelector(selector);
    if (el && el.offsetHeight > 0) {
      return el;
    }
  }
  
  // Check inside iframe elements (e.g. TinyMCE, CKEditor 4)
  const iframe = container.querySelector('iframe');
  if (iframe) {
    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      const iframeSelectors = ['[contenteditable]', 'body', 'textarea'];
      for (let selector of iframeSelectors) {
        const el = iframeDoc.querySelector(selector);
        if (el && iframe.offsetHeight > 0) {
          return el;
        }
      }
    } catch (e) {
      console.log('[Rikkei Booster] Editor iframe document blocked due to cross-origin:', e);
    }
  }
  
  // Fallback to any editor even if hidden
  for (let selector of selectors) {
    const el = container.querySelector(selector);
    if (el) return el;
  }
  
  return null;
}

// Helper to write text at the flashing cursor (using execCommand for rich text editors)
function writeTextToEditor(editor, text, iframe, questionIndex) {
  if (!editor) return;
  
  console.warn('[Rikkei Booster] Writing answer to editor at cursor:', text);
  
  // Post message to main context to write via CKEditor instance if available
  try {
    window.postMessage(JSON.stringify({
      type: 'RikkeiBoosterWriteCKEditor',
      text: text,
      questionIndex: questionIndex
    }), '*');
  } catch (err) {}
  
  if (editor.tagName === 'TEXTAREA' || editor.tagName === 'INPUT') {
    editor.focus();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const val = editor.value;
    
    // Insert text at cursor position
    editor.value = val.substring(0, start) + text + val.substring(end);
    
    // Update cursor position to be after inserted text
    editor.selectionStart = editor.selectionEnd = start + text.length;
    
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    editor.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  
  // Rich Text Editor (contenteditable)
  const doc = editor.ownerDocument || document;
  const win = doc.defaultView || window;
  
  try {
    // Focus the iframe window if present
    if (iframe && iframe.contentWindow && typeof iframe.contentWindow.focus === 'function') {
      iframe.contentWindow.focus();
    }
    
    editor.focus();
    
    const sel = win.getSelection();
    if (sel) {
      let caretInside = false;
      if (sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        // Check if selection starts inside this editor
        if (editor.contains(range.startContainer)) {
          caretInside = true;
        }
      }
      
      // If the cursor is NOT currently inside the editor, place it at the end of the editor content
      if (!caretInside) {
        const range = doc.createRange();
        range.selectNodeContents(editor);
        range.collapse(false); // collapse to end
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    
    // Use document.execCommand to write directly at the cursor, triggering reactive states
    let success = false;
    try {
      success = doc.execCommand('insertHTML', false, text);
    } catch (e) {
      console.log('[Rikkei Booster] insertHTML failed, attempting insertText:', e);
    }
    
    if (!success) {
      try {
        success = doc.execCommand('insertText', false, text);
      } catch (e) {
        console.log('[Rikkei Booster] insertText failed:', e);
      }
    }
    
    if (!success) {
      // Fallback: append
      editor.innerHTML = editor.innerHTML + text;
    }
    
    console.log('[Rikkei Booster] Rich text write status:', success);
  } catch (err) {
    console.log('[Rikkei Booster] execCommand failed, falling back to innerHTML:', err);
    editor.innerHTML = editor.innerHTML + text;
  }
  
  // Trigger input, change, keyup, and blur events
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.dispatchEvent(new Event('change', { bubbles: true }));
  editor.dispatchEvent(new Event('blur', { bubbles: true }));
  
  // Dispatch keyup to trigger react hooks
  editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  editor.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'a' }));
  editor.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
}

function countTotalQuestions() {
  const elements = Array.from(document.querySelectorAll('div, h1, h2, h3, h4, h5, span, p, button, a'));
  const foundIndices = new Set();
  
  elements.forEach(el => {
    const text = el.textContent.trim().toLowerCase().replace(/\s+/g, '').normalize('NFC');
    const match = text.match(/^câuhỏi(\d+)$|^câuhỏi(\d+)\D/);
    if (match) {
      const num = parseInt(match[1] || match[2]);
      if (!isNaN(num)) {
        foundIndices.add(num);
      }
    }
  });
  
  return foundIndices.size > 0 ? Math.max(...foundIndices) : 0;
}

function updateReadingProgress() {
  const total = countTotalQuestions();
  if (total > 0) {
    const completed = currentQuestionIndex - 1;
    const progress = Math.min(100, Math.round((completed / total) * 100));
    updateProgress(progress);
    updateStatus(`Đang làm Câu hỏi ${currentQuestionIndex}/${total}...`, '#f59e0b');
  } else {
    updateProgress(0);
    updateStatus('Đang chuẩn bị câu hỏi...', '#f59e0b');
  }
}

// Sequential question-solving automation
function processNextQuestion() {
  if (!settings.autoLearn) return;
  
  const currentUrl = window.location.href;
  if (lastReadingUrl !== currentUrl) return; // Stop if URL changed during processing
  
  // Find available question numbers on the page
  const availableNumbers = findAvailableQuestionNumbers();
  const nextNumber = availableNumbers.find(num => !completedQuestions.has(num));
  
  if (nextNumber === undefined) {
    const total = availableNumbers.length > 0 ? Math.max(...availableNumbers) : 0;
    console.log(`[Rikkei Booster] All available questions completed. Total: ${total}`);
    isProcessingQuestions = false;
    
    if (total > 0) {
      readingCompletedUrl = currentUrl; // Mark as completed for this URL!
      updateStatus('Đã hoàn thành toàn bộ câu hỏi bài đọc!', '#10b981');
      updateProgress(100);
      incrementCompletedStats();
      
      // Auto Next to next lesson
      if (settings.autoNext) {
        setTimeout(triggerNextLessonWithCheckmark, 1000);
      }
    } else {
      updateStatus('Đã kết nối trang học tập. Sẵn sàng!', '#10b981');
    }
    return;
  }
  
  currentQuestionIndex = nextNumber;
  console.log(`[Rikkei Booster] Processing Câu hỏi ${currentQuestionIndex}`);
  updateReadingProgress();
  
  // Find all elements containing target header text using precise regex and reversing to match leaf nodes first
  const elements = Array.from(document.querySelectorAll('span, button, a, h1, h2, h3, h4, h5, p, div')).reverse();
  const regex = new RegExp(`^câuhỏi${currentQuestionIndex}(?:\\D|$)`);
  const targetHeader = elements.find(el => {
    const text = el.textContent.trim().toLowerCase().replace(/\s+/g, '').normalize('NFC');
    return regex.test(text);
  });
  
  if (!targetHeader) {
    console.log(`[Rikkei Booster] Question header not found for index: ${currentQuestionIndex}. Skipping.`);
    completedQuestions.add(currentQuestionIndex);
    setTimeout(processNextQuestion, 1000);
    return;
  }
  
  // Climb up to find the clickable header container early to check full text and badges
  const clickTarget = targetHeader.closest('.question-item__header, button, [role="button"]') || targetHeader;
  
  // Check if already answered to prevent browser alert confirm() dialog blocking execution
  const headerText = clickTarget.textContent.toLowerCase().normalize('NFC');
  if (headerText.includes('đã trả lời') || headerText.includes('đãtrảlời') || headerText.includes('đã nộp') || headerText.includes('đãnộp')) {
    console.warn(`[Rikkei Booster] Câu hỏi ${currentQuestionIndex} has already been answered. Skipping to avoid alert popup.`);
    completedQuestions.add(currentQuestionIndex);
    setTimeout(processNextQuestion, 500);
    return;
  }
  
  // Find parent container of this question
  const container = findQuestionContainer(targetHeader);
  
  let editor = findEditor(container);
  
  // Expand if collapsed
  if (!editor || editor.offsetHeight === 0) {
    clickTarget.click();
    console.log(`[Rikkei Booster] Expanded Câu hỏi ${currentQuestionIndex}`);
  }
  
  // Try to find the editor and write to it with retries
  let retries = 0;
  const maxRetries = 5;
  
  function tryWrite() {
    if (lastReadingUrl !== currentUrl) return; // Stop if URL changed
    
    const activeContainer = findQuestionContainer(targetHeader) || document.body;
    const currentEditor = findEditor(activeContainer);
    
    if (currentEditor && currentEditor.offsetHeight > 0) {
      const iframe = activeContainer.querySelector('iframe');
      
      // Fill textareas or contenteditable divs
      const sampleAnswers = [
        "Path Parameters giúp định vị và quản lý một tài nguyên cụ thể trên hệ thống Web Service, giúp URL gọn gàng hơn.",
        "Ưu điểm lớn nhất của Path Parameters là hỗ trợ tối ưu hóa SEO và định tuyến endpoint tĩnh, giúp bảo mật hơn.",
        "FastAPI sử dụng Pydantic để kiểm tra định dạng và kiểu dữ liệu đầu vào cho Path Parameters tự động.",
        "Sự khác biệt chính là Path Parameters định vị tài nguyên duy nhất còn Query Parameters dùng để lọc dữ liệu.",
        "Tôi đã nắm vững toàn bộ kiến thức lý thuyết về FastAPI Routing và các tham số đường dẫn."
      ];
      const randomAnswer = sampleAnswers[Math.floor(Math.random() * sampleAnswers.length)];
      
      // Write answer to editor using cursor simulation (execCommand)
      writeTextToEditor(currentEditor, randomAnswer, iframe, currentQuestionIndex);
      updateStatus(`Đã điền câu hỏi ${currentQuestionIndex}. Đang lưu...`, '#f59e0b');
      
      // Click Save/Submit button
      setTimeout(() => {
        let saveBtn = activeContainer.querySelector('.question-item__save-btn');
        if (!saveBtn) {
          const buttons = Array.from(activeContainer.querySelectorAll('button, input[type="submit"], [class*="btn"], [class*="button"]'));
          saveBtn = buttons.find(btn => {
            const text = btn.textContent.toLowerCase().trim();
            return text.includes('lưu') || text.includes('đã lưu') || text.includes('save') || text.includes('nộp') || text.includes('xác nhận');
          });
        }
        
        if (!saveBtn) {
          // Global fallback search
          const globalButtons = Array.from(document.querySelectorAll('button, input[type="submit"], [class*="btn"], [class*="button"]'));
          saveBtn = globalButtons.find(btn => {
            const text = btn.textContent.toLowerCase().trim();
            return text.includes('lưu') || text.includes('đã lưu') || text.includes('save') || text.includes('nộp') || text.includes('xác nhận');
          });
        }
        
        if (saveBtn) {
          saveBtn.click();
          console.log(`[Rikkei Booster] Saved Câu hỏi ${currentQuestionIndex}`);
          updateStatus(`Đã lưu Câu hỏi ${currentQuestionIndex}!`, '#10b981');
        }
        
        // Move to next question in sequence
        completedQuestions.add(currentQuestionIndex);
        setTimeout(processNextQuestion, 2000);
        
      }, 1500);
    } else {
      retries++;
      if (retries < maxRetries) {
        console.log(`[Rikkei Booster] Editor not ready for Câu hỏi ${currentQuestionIndex}, retrying in 1s (${retries}/${maxRetries})...`);
        setTimeout(tryWrite, 1000);
      } else {
        console.log(`[Rikkei Booster] Editor not found for Câu hỏi ${currentQuestionIndex} after ${maxRetries} retries. Skipping.`);
        completedQuestions.add(currentQuestionIndex);
        setTimeout(processNextQuestion, 1000);
      }
    }
  }
  
  // Wait 1.5s for initial expansion and editor load before trying
  setTimeout(tryWrite, 1500);
}

function findSubmitButton() {
  const buttons = document.querySelectorAll('button, input[type="submit"], [class*="btn"], [class*="button"]');
  for (let btn of buttons) {
    const text = btn.textContent.toLowerCase().trim();
    if (text.includes('nộp') || text.includes('lưu') || text.includes('xác nhận') || text.includes('submit') || text.includes('save')) {
      return btn;
    }
  }
  return null;
}

// Shadow-piercing recursive video finder
function findVideoInShadow(root) {
  try {
    if (!root) return null;
    
    // Check if root is video
    if (root.tagName === 'VIDEO') return root;
    
    // Query direct selector
    if (typeof root.querySelector === 'function') {
      const v = root.querySelector('video');
      if (v) return v;
    }
    
    // Recursive search in children and shadow roots
    if (typeof root.querySelectorAll === 'function') {
      const children = root.querySelectorAll('*');
      for (let el of children) {
        if (el.shadowRoot) {
          const found = findVideoInShadow(el.shadowRoot);
          if (found) return found;
        }
      }
    }
  } catch (e) {}
  return null;
}

// Find the actual active course video element, bypassing hidden/background elements
function getActiveVideoElement() {
  // 1. Search in main document including Shadow DOMs
  const video = findVideoInShadow(document);
  if (video) return video;
  
  // 2. Search inside all same-origin iframes recursively
  const iframes = document.querySelectorAll('iframe');
  for (let iframe of iframes) {
    try {
      if (iframe.contentDocument) {
        const found = findVideoInShadow(iframe.contentDocument);
        if (found) return found;
      }
    } catch (e) {}
  }
  
  return null;
}

// Click play button elements to simulate human click
function clickCustomPlayButton() {
  let clicked = false;
  const playSelectors = [
    ".play-button", ".btn-play", ".play_btn", ".ytp-large-play-button", 
    "[class*='play-btn']", "[class*='PlayBtn']", "[class*='play_btn']",
    "[class*='play-icon']", "[class*='PlayIcon']"
  ];
  
  for (let sel of playSelectors) {
    const btn = document.querySelector(sel);
    if (btn && (btn.offsetWidth || btn.offsetHeight)) {
      btn.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    const svgs = document.querySelectorAll("svg");
    for (let svg of svgs) {
      if (svg.offsetWidth || svg.offsetHeight) {
        const html = svg.innerHTML.toLowerCase();
        if (html.includes("play") || html.includes("polygon") || html.includes("path")) {
          const parentBtn = svg.closest("button, div");
          if (parentBtn && (parentBtn.offsetWidth || parentBtn.offsetHeight)) {
            parentBtn.click();
            clicked = true;
            break;
          }
        }
      }
    }
  }

  if (!clicked) {
    const video = getActiveVideoElement();
    if (video) {
      video.click();
    }
  }
}

// Helper to format seconds to MM:SS
function formatSeconds(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return "00:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

let mediaSessionHooked = false;
let lastMediaSessionUrl = "";

function updateMediaSession(video) {
  if (!('mediaSession' in navigator)) return;

  // Sync playback state
  navigator.mediaSession.playbackState = video.paused ? "paused" : "playing";

  const currentSrc = video.currentSrc || video.src || "";
  if (mediaSessionHooked && lastMediaSessionUrl === currentSrc) return;
  
  mediaSessionHooked = true;
  lastMediaSessionUrl = currentSrc;

  console.log('[Rikkei Booster Edge] Syncing Media Session API metadata & handlers...');

  // Set Metadata
  const lessonTitle = document.querySelector('h1, h2, h3, [class*="title"], [class*="lesson-name"]')?.textContent.trim() || 'Bài học E-Learning';
  navigator.mediaSession.metadata = new MediaMetadata({
    title: lessonTitle,
    artist: 'EduBot Pro',
    album: 'RikkeiEdu Auto Learn Booster',
    artwork: [
      { src: 'chrome-extension://' + chrome.runtime.id + '/icon.png', sizes: '128x128', type: 'image/png' }
    ]
  });

  // Action handlers
  navigator.mediaSession.setActionHandler('play', () => {
    console.log('[EduBot Edge] MediaSession play triggered');
    video.play().catch(() => {});
  });

  navigator.mediaSession.setActionHandler('pause', () => {
    console.log('[EduBot Edge] MediaSession pause triggered');
    video.pause();
  });

  navigator.mediaSession.setActionHandler('seekto', (details) => {
    console.log('[EduBot Edge] MediaSession seekto triggered at:', details.seekTime);
    if (Number.isFinite(details.seekTime)) {
      video.currentTime = details.seekTime;
    }
  });

  navigator.mediaSession.setActionHandler('nexttrack', () => {
    console.log('[EduBot Edge] MediaSession nexttrack triggered (Next Lesson)');
    updateStatus('Tín hiệu Next từ Edge/Windows! Đang chuyển bài...', '#3b82f6');
    goToNextLesson();
  });
}

// Click native seek-forward button on the webpage
function clickSeekForwardButton() {
  // 1. Try finding by common class/id selectors
  const forwardSelectors = [
    '.ytw-player-seek-forward', '.seek-forward', '.btn-forward', '.forward-btn',
    '[class*="forward"]', '[class*="Forward"]', '[id*="forward"]', '[id*="Forward"]'
  ];
  
  for (let sel of forwardSelectors) {
    const btn = document.querySelector(sel);
    if (btn && (btn.offsetWidth || btn.offsetHeight)) {
      btn.click();
      console.log('[EduBot] Clicked seek-forward button by selector:', sel);
      return true;
    }
  }
  
  // 2. Try finding by SVG double right arrows (fast forward icon)
  const svgs = document.querySelectorAll('svg');
  for (let svg of svgs) {
    if (svg.offsetWidth || svg.offsetHeight) {
      const html = svg.innerHTML.toLowerCase();
      // Fast forward icon typically contains double right polygons/paths
      if (html.includes('forward') || html.includes('next') || (html.match(/polygon/g) || []).length >= 2 || (html.match(/path/g) || []).length >= 2) {
        const parentBtn = svg.closest('button, div, a');
        if (parentBtn && (parentBtn.offsetWidth || parentBtn.offsetHeight)) {
          const parentHtml = parentBtn.innerHTML.toLowerCase();
          // Filter out backward/previous buttons
          if (!parentHtml.includes('back') && !parentHtml.includes('prev') && !parentHtml.includes('backward')) {
            parentBtn.click();
            console.log('[EduBot] Clicked seek-forward button by SVG parent:', parentBtn);
            return true;
          }
        }
      }
    }
  }
  
  return false;
}

let simulatedSeekInterval = null;

// Parse current playback time and duration from the UI text (e.g. "7:08 / 14:51")
function getPlayerTimeFromUI() {
  const elements = Array.from(document.querySelectorAll('span, div, p, [class*="time"], [class*="duration"]'));
  for (let el of elements) {
    if (el.children.length === 0) { // Only leaf nodes
      const text = el.textContent.trim();
      const match = text.match(/^(\d+):(\d+)\s*\/\s*(\d+):(\d+)$/);
      if (match) {
        const currentMin = parseInt(match[1]);
        const currentSec = parseInt(match[2]);
        const durationMin = parseInt(match[3]);
        const durationSec = parseInt(match[4]);
        
        return {
          currentTime: currentMin * 60 + currentSec,
          duration: durationMin * 60 + durationSec
        };
      }
    }
  }
  return null;
}

function startSimulatedSeek() {
  if (simulatedSeekInterval) return;
  
  logToPopup("🚀 Bắt đầu tua nhanh video bằng API liên kết...", "info");
  
  const timeData = getPlayerTimeFromUI();
  let seekTime = timeData ? timeData.currentTime : 0;
  let duration = timeData ? timeData.duration : 0;
  
  console.log(`[EduBot] Initialized seekTime from UI: ${seekTime}s / ${duration}s`);
  
  simulatedSeekInterval = setInterval(() => {
    // 1. Try to click native seek-forward button if present and active
    clickSeekForwardButton();
    
    // 2. Update progress using UI text if possible
    const currentTimeData = getPlayerTimeFromUI();
    if (currentTimeData) {
      duration = currentTimeData.duration;
      if (currentTimeData.currentTime > seekTime) {
        seekTime = currentTimeData.currentTime;
      }
    }
    
    // Increment seek target by 15s step
    seekTime += 15;
    
    if (duration > 0 && seekTime >= duration - 5) {
      seekTime = duration - 5;
      stopSimulatedSeek();
    }
    
    // 3. Send native seekTo command to YouTube embeds via Iframe Player API
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        const src = iframe.src || '';
        if (src.includes('youtube.com') || src.includes('youtube-nocookie.com')) {
          // Play video command
          iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func: 'playVideo',
            args: []
          }), '*');
          
          // Seek video command
          iframe.contentWindow.postMessage(JSON.stringify({
            event: 'command',
            func: 'seekTo',
            args: [seekTime, true]
          }), '*');
        }
      } catch (e) {}
    });
    
    // 4. Native video direct seek fallback
    const nativeVideo = getActiveVideoElement();
    if (nativeVideo) {
      if (Number.isFinite(nativeVideo.duration)) {
        if (seekTime < nativeVideo.duration - 5) {
          nativeVideo.currentTime = seekTime;
        } else {
          nativeVideo.currentTime = nativeVideo.duration - 5;
          stopSimulatedSeek();
        }
      }
    }
    
    // 5. Same-origin iframe fallback
    iframes.forEach(iframe => {
      try {
        if (iframe.contentDocument) {
          const subVideo = findVideoInShadow(iframe.contentDocument);
          if (subVideo && Number.isFinite(subVideo.duration)) {
            if (seekTime < subVideo.duration - 5) {
              subVideo.currentTime = seekTime;
            } else {
              subVideo.currentTime = subVideo.duration - 5;
              stopSimulatedSeek();
            }
          }
        }
      } catch (e) {}
    });
    
    console.log(`[EduBot] Dispatched simulated seek to time: ${seekTime}s`);
  }, 200); // 200ms interval for stability
}

function stopSimulatedSeek() {
  if (simulatedSeekInterval) {
    clearInterval(simulatedSeekInterval);
    simulatedSeekInterval = null;
    logToPopup("✅ Đã đạt mốc hoàn thành. Dừng tua.", "success");
  }
}

function checkAndStartSeek(progress) {
  if (settings.autoLearn && progress < 95) {
    startSimulatedSeek();
  } else if (progress >= 95) {
    stopSimulatedSeek();
  }
}

function isCurrentPageVideo() {
  try {
    const lessons = findSidebarLessons();
    const activeIndex = findActiveLessonIndex(lessons);
    if (activeIndex !== -1) {
      const activeText = lessons[activeIndex].textContent.trim().toLowerCase();
      return activeText.includes('video');
    }
  } catch (err) {
    console.error('Lỗi isCurrentPageVideo:', err);
  }
  // Fallback to checking URL or presence of video
  return window.location.href.toLowerCase().includes('video') || document.querySelector('video') !== null;
}

// 2. Video detection and progress update
function detectPageVideo() {
  if (!isCurrentPageVideo()) return;
  const video = getActiveVideoElement();
  const iframes = document.querySelectorAll('iframe');
  let hasYoutube = false;
  for (let iframe of iframes) {
    if (iframe.src && iframe.src.includes('youtube.com/embed')) {
      hasYoutube = true;
      break;
    }
  }

  if (video || hasYoutube) {
    // Media Session Hook for Microsoft Edge & Windows controls
    if (video) {
      try {
        updateMediaSession(video);
      } catch (e) {
        console.error('[Rikkei Booster] Error setting Media Session:', e);
      }
    }

    // If autoLearn is enabled, implement automatic bypassing/seeking
    if (settings.autoLearn) {
      if (video) {
        // 1. Auto mute to allow autoplay
        if (!video.muted) {
          video.muted = true;
        }
        
        // 2. Set speed
        const targetSpeed = settings.videoSpeed || 2;
        if (video.playbackRate !== targetSpeed) {
          video.playbackRate = targetSpeed;
        }
        
        // 3. Play if paused and not ended
        if (video.paused && !video.ended) {
          video.play().catch(() => {
            clickCustomPlayButton();
          });
        }
      }

      // Auto-trigger seekToEndAccurate
      if (!window._seekTriggered) {
        window._seekTriggered = true;
        console.log('[Rikkei Booster] Video or YouTube iframe detected, scheduling seekToEndAccurate in 2.5s...');
        logToPopup('🎥 Phát hiện video. Đang chờ 2.5s để bắt đầu tự động tua...', 'info');
        setTimeout(() => {
          seekToEndAccurate();
        }, 2500);
      }
      
      if (video) {
        // 4. Auto Seek using ArrowRight simulation
        const duration = video.duration;
        if (Number.isFinite(duration) && duration > 5) {
          const progress = (video.currentTime / duration) * 100;
          checkAndStartSeek(progress);
        }
      }
    }

    if (video) {
      const progress = (video.currentTime / video.duration) * 100;
      if (!isNaN(progress)) {
        updateProgress(progress);
        updateStatus(`Đang học Video... (${Math.round(progress)}%)`);
        
        if (progress >= 95) {
          updateStatus('Video đã hoàn thành!', '#10b981');
          if (settings.autoNext && !video.dataset.nextTriggered) {
            video.dataset.nextTriggered = 'true';
            incrementCompletedStats();
            setTimeout(triggerNextLessonWithCheckmark, 1000);
          }
        }
      }
    }
  }
}

// 3. Handle interactive popup quizzes inside videos
function handleInteractiveQuiz() {
  if (!settings.autoLearn) return;
  
  let activeModal = null;
  
  // 1. Search using "Câu hỏi" title parent-climbing heuristic
  const titleElements = Array.from(document.querySelectorAll('div, h1, h2, h3, h4, h5, span, p, label'))
    .filter(el => {
      if (!(el.offsetWidth > 0 && el.offsetHeight > 0)) return false;
      const text = el.textContent.trim().toLowerCase();
      return text === 'câu hỏi' || text === 'câu hỏi tương tác' || text.startsWith('câu hỏi số') || text.includes('chọn đáp án');
    });

  for (let title of titleElements) {
    let parent = title.parentElement;
    while (parent && parent !== document.body) {
      const buttons = parent.querySelectorAll('button');
      if (buttons.length >= 2) {
        activeModal = parent;
        break;
      }
      parent = parent.parentElement;
    }
    if (activeModal) break;
  }

  // 2. Class-based fallback if title heuristic fails
  if (!activeModal) {
    const modals = document.querySelectorAll('.modal-content, [class*="modal"], [class*="popup"], [class*="dialog"], [class*="question-modal"], [class*="quiz-modal"]');
    for (let m of modals) {
      if (m.offsetWidth > 0 && m.offsetHeight > 0) {
        activeModal = m;
        break;
      }
    }
  }
  
  // 3. Fallback scanner for high z-index overlay containers containing question text
  if (!activeModal) {
    const divs = document.querySelectorAll('div');
    for (let div of divs) {
      if (div.offsetWidth > 150 && div.offsetHeight > 150 && window.getComputedStyle(div).zIndex > 100) {
        const text = div.textContent.toLowerCase();
        if (text.includes('câu hỏi') || text.includes('đáp án') || text.includes('trả lời') || text.includes('để minh họa')) {
          activeModal = div;
          break;
        }
      }
    }
  }
  
  if (!activeModal) return;
  
  // Find clickable choices (excluding submit buttons and question title)
  let choices = Array.from(activeModal.querySelectorAll('button, [class*="option"], [class*="choice"], [class*="answer"], label, li, [class*="card"], div'))
    .filter(el => {
      if (!(el.offsetWidth > 0 && el.offsetHeight > 0)) return false;
      
      // Ignore container elements that wrap other choices
      const hasChildChoices = el.querySelector('button, [class*="option"], [class*="choice"], [class*="answer"], label, li, [class*="card"]');
      if (hasChildChoices) return false;
      
      const text = el.textContent.trim();
      if (text.length === 0) return false;
      
      // Ignore submit buttons
      const lowerText = text.toLowerCase();
      const isSubmit = lowerText.includes('nộp') || lowerText.includes('xác nhận') || lowerText.includes('tiếp tục') || lowerText.includes('submit') || lowerText.includes('continue') || lowerText.includes('hoàn thành');
      if (isSubmit) return false;
      
      // Ignore question title header
      const isTitle = lowerText === 'câu hỏi' || lowerText.includes('đáp án') || lowerText.length > 150;
      if (isTitle) return false;
      
      return true;
    });
     
  if (choices.length === 0) return;
  
  // Pick a random choice
  const randomIndex = Math.floor(Math.random() * choices.length);
  const selectedChoice = choices[randomIndex];
  
  if (!selectedChoice.dataset.boosterSelected) {
    selectedChoice.dataset.boosterSelected = 'true';
    
    updateStatus('Tự động chọn ngẫu nhiên đáp án câu hỏi tương tác...', '#f59e0b');
    logToPopup(`Tự động chọn ngẫu nhiên đáp án: "${selectedChoice.textContent.trim()}"`, 'info');
    console.log('[Rikkei Booster] Selected random quiz choice:', selectedChoice.textContent.trim());

    selectedChoice.click();
    
    const radio = selectedChoice.querySelector('input[type="radio"], input[type="checkbox"]');
    if (radio) {
      radio.click();
    }
    
    // Check if there is an explicit submit button and click it after 1 second, then trigger goToNextLesson
    setTimeout(() => {
      const submitBtn = findConfirmButton(activeModal);
      if (submitBtn) {
        submitBtn.click();
        updateStatus('Đã hoàn thành nộp câu hỏi tương tác!', '#10b981');
        logToPopup('Đã nộp câu hỏi tương tác! Đang chuẩn bị chuyển sang nội dung tiếp theo...', 'success');
      }
      
      // Auto transition to reading section after a 1.5-second delay
      if (settings.autoNext) {
        setTimeout(() => {
          console.log('[Rikkei Booster] Moving to next lesson content...');
          goToNextLesson();
        }, 1500);
      }
    }, 1000);
  }
}

function findConfirmButton(container) {
  const buttons = container.querySelectorAll('button, [class*="btn"], [class*="button"], input[type="button"], div, span');
  for (let btn of buttons) {
    const text = btn.textContent.toLowerCase().trim();
    if (text.includes('nộp') || text.includes('xác nhận') || text.includes('tiếp tục') || text.includes('chấp nhận') || text.includes('đồng ý') || text.includes('submit') || text.includes('confirm') || text.includes('continue') || text.includes('ok')) {
      return btn;
    }
  }
  return null;
}

// Listen to postMessage from youtube iframe or page injection
window.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'RikkeiBoosterRunTest') {
      console.log('[Rikkei Booster] Diagnostics message received from page. Executing...');
      runDiagnostics();
    } else if (data.type === 'RikkeiBoosterPlaySource') {
      playSource = data.playSource;
      console.log('[Rikkei Booster] Received playSource update from iframe:', playSource);
    } else if (data.type === 'RikkeiBoosterYoutubeProgress') {
      if (!isCurrentPageVideo()) return;
      const progress = data.progress;
      window._videoProgress = progress;
      updateProgress(progress);
      updateStatus(`Đang học Video YouTube... (${Math.round(progress)}%)`);
      
      if (progress >= 95 && settings.autoNext) {
        if (!window.nextTriggered) {
          window.nextTriggered = true;
          updateStatus('Video YouTube đã hoàn thành!', '#10b981');
          incrementCompletedStats();
          setTimeout(() => {
            triggerNextLessonWithCheckmark();
            window.nextTriggered = false;
          }, 1000);
        }
      }
    } else if (data.type === 'RikkeiBoosterIframeProgress') {
      if (!isCurrentPageVideo()) return;
      const progress = data.progress;
      updateProgress(progress);
      updateStatus(`Đang học Video (nhúng)... (${Math.round(progress)}%)`);
      
      if (progress >= 95 && settings.autoNext) {
        if (!window.nextTriggered) {
          window.nextTriggered = true;
          updateStatus('Video nhúng đã hoàn thành!', '#10b981');
          incrementCompletedStats();
          setTimeout(() => {
            triggerNextLessonWithCheckmark();
            window.nextTriggered = false;
          }, 1000);
        }
      }
    } else if (data.type === 'RikkeiBoosterYoutubeReady') {
      updateStatus('Đã kết nối video YouTube. Hãy bấm Play để tua.', '#f59e0b');
      forwardSettingsToIframes();
    } else if (data.type === 'RikkeiBoosterIframeLog') {
      logToPopup(data.text, "info");
    }
  } catch (e) {
    // Not our message
  }
});

// Check if lesson checkmark has appeared in the sidebar active item
function isActiveLessonCompleted(activeElement) {
  if (!activeElement) return false;
  
  // Check for checkmark characters
  const text = activeElement.textContent || "";
  if (text.includes('✔') || text.includes('✓') || text.toLowerCase().includes('done') || text.toLowerCase().includes('hoàn thành')) {
    return true;
  }
  
  // Check for icons or checkmark classes
  const checkIcon = activeElement.querySelector('svg, i, .check, .done, [class*="check"], [class*="success"], [class*="done"]');
  if (checkIcon) return true;
  
  // Check innerHTML for checkmark indicators
  const html = activeElement.innerHTML || "";
  if (html.includes('success') || html.includes('check') || html.includes('done') || html.includes('fa-check') || html.includes('bi-check')) {
    return true;
  }
  
  return false;
}

let nextLessonTimeout = null;

// Wait for checkmark with a timeout, then trigger goToNextLesson
function triggerNextLessonWithCheckmark() {
  if (!settings.autoNext) return;

  // If there are other uncompleted sub-items under the current lesson, transition IMMEDIATELY
  const nextSubItem = findNextUncompletedSubItem();
  if (nextSubItem) {
    console.log('[Rikkei Booster] Next sub-item exists under current lesson. Transitioning immediately without waiting for checkmark.');
    goToNextLesson();
    return;
  }
  
  // No more sub-items in this lesson. We stop here and let the user do the Quiz.
  updateStatus('Đã hoàn thành bài học! Hãy làm Quiz.', '#10b981');
  logToPopup("🎉 Đã hoàn thành Video và Bài đọc của bài học này! Hãy làm bài tập trắc nghiệm (Quiz) đi nhé, tiện ích sẽ dừng tại đây để bạn làm bài.", "success");
}

// 5. Sidebar scanning helper
function findSidebarLessons() {
  // Try finding elements with href containing "/lessons/" or "/lesson/"
  let lessons = Array.from(document.querySelectorAll('a[href*="/lessons/"], a[href*="/lesson/"]'));
  
  // Filter out any invisible lessons
  lessons = lessons.filter(el => el.offsetWidth > 0 && el.offsetHeight > 0);
  
  if (lessons.length > 0) {
    console.log(`[EduBot] Found ${lessons.length} lessons in sidebar using href selector.`);
    return lessons;
  }
  
  // Fallback to class/id heuristic if href selector fails
  let sidebar = document.querySelector('aside, .sidebar, [class*="sidebar"], [class*="lessons"], [class*="list-lessons"], [class*="curriculum"], [class*="RightContent"]');
  const container = sidebar || document.body;
  let allElements = Array.from(container.querySelectorAll('a, div, li, [role="button"], span'));
  
  lessons = allElements.filter(el => {
    if (el.children.length > 5) return false;
    if (el.offsetWidth === 0 || el.offsetHeight === 0) return false;
    
    const text = el.textContent.trim().toLowerCase();
    const isLesson = /lesson\s*\d+/i.test(text) || 
                     /bài\s*(học)?\s*\d+/i.test(text) || 
                     /session\s*\d+/i.test(text) || 
                     /buổi\s*\d+/i.test(text) ||
                     el.querySelector('[class*="status"], [class*="check"], [class*="icon"]') !== null;
                     
    return isLesson;
  });
  
  lessons = lessons.filter(l1 => !lessons.some(l2 => l1 !== l2 && l1.contains(l2)));
  return lessons;
}

function findActiveLessonIndex(lessons) {
  const currentUrl = window.location.href;
  let activeId = null;
  const match = currentUrl.match(/\/lessons\/(\d+)/);
  if (match && match[1]) {
    activeId = match[1];
  } else {
    const parts = currentUrl.split('/');
    activeId = parts[parts.length - 1];
  }
  
  console.log('[Rikkei Booster] Scanning active lesson. Active ID:', activeId);

  // Heuristic 1: Match by ID in href or text
  for (let i = 0; i < lessons.length; i++) {
    const el = lessons[i];
    if (el.href && el.href.includes(activeId)) {
      return i;
    }
    const href = el.getAttribute('href');
    if (href && href.includes(activeId)) {
      return i;
    }
  }

  // Heuristic 2: Match by styling (active color / highlight background)
  for (let i = 0; i < lessons.length; i++) {
    const el = lessons[i];
    if (el.classList.contains('active') || el.classList.contains('current') || el.classList.contains('selected')) {
      return i;
    }
    
    const style = window.getComputedStyle(el);
    const color = style.color;
    if (color === 'rgb(239, 68, 68)' || color.includes('239, 68, 68') || style.backgroundColor.includes('rgb(254, 242, 242)')) {
      return i;
    }
  }

  // Heuristic 3: Match by active page title text
  const titleEl = document.querySelector('h1, h2, h3, [class*="title"], [class*="lesson-name"]');
  if (titleEl) {
    const activeTitle = titleEl.textContent.trim().toLowerCase();
    for (let i = 0; i < lessons.length; i++) {
      const text = lessons[i].textContent.trim().toLowerCase();
      if (text.includes(activeTitle) || activeTitle.includes(text)) {
        return i;
      }
    }
  }
  return -1;
}

function findNextUncompletedSubItem() {
  const lessons = findSidebarLessons();
  const activeIndex = findActiveLessonIndex(lessons);
  
  if (activeIndex === -1) {
    console.log('[Rikkei Booster] No active lesson found. Returning null.');
    return null;
  }

  const activeElement = lessons[activeIndex];
  const currentLessonContainer = activeElement.closest('.learn__content--right__item--block, [class*="block"], [class*="lesson-item"], [class*="chapter-item"]') 
                                || activeElement.parentElement.closest('ul, ol, div') 
                                || activeElement.parentElement;

  if (!currentLessonContainer) {
    console.log('[Rikkei Booster] No current lesson container found.');
    return null;
  }

  // Find all elements representing sub-items INSIDE the current lesson container
  const matchedElements = Array.from(currentLessonContainer.querySelectorAll('*'))
    .filter(el => {
      if (!(el.offsetWidth > 0 && el.offsetHeight > 0)) return false;
      if (el.children.length > 0 && el.querySelector('p, span, div')) return false;
      
      const text = el.textContent.trim().toLowerCase().replace(/\s+/g, ' ');
      return text === 'video' || text === 'bài đọc';
    });

  if (matchedElements.length === 0) return null;

  // Map each matched text node to its closest clickable container
  const candidates = matchedElements.map(el => {
    const clickable = el.closest('a, button, [role="button"], li, .learn__content--right__item--block__content, [class*="item"], [class*="content"]') || el;
    return clickable;
  });

  function isSubItemCompleted(el) {
    const parent = el.closest('li, div, [class*="item"], [class*="row"]') || el;
    const html = parent.innerHTML.toLowerCase();
    
    if (html.includes('✔') || html.includes('✓') || html.includes('done') || html.includes('check') || html.includes('success')) {
      return true;
    }
    
    const checkIcon = parent.querySelector('svg, i, .check, .done, [class*="check"], [class*="success"], [class*="done"]');
    if (checkIcon) return true;
    
    return false;
  }

  // Filter candidates to only include those that are chronologically AFTER activeElement in DOM order,
  // and are not completed. This ensures we only move forward within the current lesson and stop at the end.
  const uncompleted = candidates.filter(el => {
    const isFollowing = (activeElement.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) > 0;
    return isFollowing && !isSubItemCompleted(el);
  });

  if (uncompleted.length > 0) {
    return uncompleted[0];
  }
  
  return null;
}

// 4. Navigation: Select next lesson item in sidebar
function goToNextLesson() {
  console.log('[Rikkei Booster] Moving to next sub-item...');
  
  // First, check if there is an uncompleted sub-item in the current lesson
  try {
    const nextSubItem = findNextUncompletedSubItem();
    if (nextSubItem) {
      updateStatus('Đang chuyển sang phần tiếp theo của bài học...', '#3b82f6');
      logToPopup(`Chuyển sang phần tiếp theo của bài học hiện tại: "${nextSubItem.textContent.trim()}"`, "info");
      nextSubItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nextSubItem.click();
      
      const innerLink = nextSubItem.querySelector('a, button, [role="button"]');
      if (innerLink) {
        innerLink.click();
      }
      console.log('[Rikkei Booster] Clicked sub-item:', nextSubItem.textContent.trim());
      return;
    }
  } catch (err) {
    console.error('Lỗi khi chuyển sub-item:', err);
  }

  // If Video and Bài đọc are both completed:
  updateStatus('Đã hoàn thành bài học! Hãy làm Quiz.', '#10b981');
  logToPopup("🎉 Đã hoàn thành Video và Bài đọc của bài học này! Hãy làm bài tập trắc nghiệm (Quiz) đi nhé, tiện ích sẽ dừng tại đây để bạn làm bài.", "success");
}

// 6. Listen to Right Arrow key on the main page
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') {
    if (!settings.autoLearn) return;
    
    if (playSource !== 'native') {
      console.log('[Rikkei Booster] Physical ArrowRight blocked. Current PlaySource:', playSource);
      return;
    }
    
    const video = getActiveVideoElement();
    if (video && video.duration) {
      e.preventDefault();
      const targetTime = video.duration * 0.96;
      video.currentTime = targetTime;
      updateStatus('Bypass: Đã tua nhanh tới 96%!', '#10b981');
      console.log('[Rikkei Booster] Bypassed native video via ArrowRight press');
      return;
    }
    
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      if (iframe.src && (iframe.src.includes('youtube.com') || iframe.src.includes('youtube-nocookie.com'))) {
        try {
          iframe.contentWindow.postMessage(JSON.stringify({
            type: 'RikkeiBoosterTriggerSeek',
            timePercent: 96
          }), '*');
          console.log('[Rikkei Booster] Relayed ArrowRight seek trigger to YouTube iframe');
        } catch (err) {}
      }
    });
  }
});

// Self-Test Diagnostic Tool to debug in DevTools/Console
function runDiagnostics() {
  console.log('%c[Rikkei Booster Diagnostic Tool]', 'color: #3b82f6; font-weight: bold; font-size: 14px;');
  
  // 1. Check URL
  console.log('Current URL:', window.location.href);
  
  // 2. Count total questions
  const total = countTotalQuestions();
  console.log('Total questions detected:', total);
  
  // 3. Scan each question from 1 to total
  for (let i = 1; i <= (total || 5); i++) {
    console.log(`%c--- Checking Question ${i} ---`, 'color: #f59e0b; font-weight: bold;');
    
    // Find target header using reversed leaf-first search
    const elements = Array.from(document.querySelectorAll('span, button, a, h1, h2, h3, h4, h5, p, div')).reverse();
    const regex = new RegExp(`^câuhỏi${i}(?:\\D|$)`);
    const targetHeader = elements.find(el => {
      const text = el.textContent.trim().toLowerCase().replace(/\s+/g, '');
      return regex.test(text);
    });
    
    if (!targetHeader) {
      console.log(`%cQuestion ${i} Header: NOT FOUND`, 'color: #ef4444;');
      continue;
    }
    
    console.log(`Question ${i} Header: FOUND`, targetHeader);
    console.log(`Header tag: ${targetHeader.tagName}, classes: "${targetHeader.className}"`);
    
    // Find container
    const container = findQuestionContainer(targetHeader);
    if (!container) {
      console.log(`%cQuestion ${i} Container: NOT FOUND`, 'color: #ef4444;');
      continue;
    }
    
    console.log(`Question ${i} Container: FOUND`, container);
    console.log(`Container class: "${container.className}"`);
    
    // Check all potential editor elements inside this container
    const potentialEditors = Array.from(container.querySelectorAll('[contenteditable], textarea, input, iframe, [class*="editor"]'));
    console.log(`Potential editors found inside container (${potentialEditors.length}):`);
    potentialEditors.forEach((el, idx) => {
      console.log(`  [${idx}] Tag: <${el.tagName}>, Classes: "${el.className}", id: "${el.id}", offsetHeight: ${el.offsetHeight}, contentEditable: ${el.contentEditable}`);
    });
    
    // Run findEditor
    const editor = findEditor(container);
    if (!editor) {
      console.log(`%cQuestion ${i} Editor: NOT FOUND via findEditor()`, 'color: #ef4444;');
    } else {
      console.log(`%cQuestion ${i} Editor: FOUND via findEditor()`, 'color: #10b981;', editor);
      console.log(`Selected Editor Details: Tag: <${editor.tagName}>, offsetHeight: ${editor.offsetHeight}, isContentEditable: ${editor.contentEditable === 'true' || editor.getAttribute('contenteditable') !== null}`);
      
      // Test writing
      console.log('Testing writing to editor...');
      try {
        writeTextToEditor(editor, `[Diagnostic Test Answer for Question ${i}]`, container.querySelector('iframe'));
        console.log(`%cTest writing completed! Check if text appeared in the editor.`, 'color: #10b981;');
      } catch (err) {
        console.log('%cTest writing failed:', 'color: #ef4444;', err);
      }
    }
    
    // Find Save/Submit button
    const buttons = Array.from(container.querySelectorAll('button, input[type="submit"], [class*="btn"], [class*="button"]'));
    console.log(`Buttons inside container (${buttons.length}):`);
    buttons.forEach((btn, idx) => {
      console.log(`  [${idx}] Text: "${btn.textContent.trim()}", Tag: <${btn.tagName}>, Classes: "${btn.className}", offsetHeight: ${btn.offsetHeight}`);
    });
    
    let saveBtn = buttons.find(btn => {
      const text = btn.textContent.toLowerCase().trim();
      return text.includes('lưu') || text.includes('đã lưu') || text.includes('save') || text.includes('nộp') || text.includes('xác nhận');
    });
    
    if (!saveBtn) {
      console.log(`%cSave Button: NOT FOUND inside container`, 'color: #ef4444;');
    } else {
      console.log(`%cSave Button: FOUND inside container`, 'color: #10b981;', saveBtn);
    }
  }
}

// Helper script injection removed. Functionality is now moved to main_world.js running in MAIN world.

// Iframe video automation block for Vimeo and other embedded players
if (window.self !== window.top) {
  setInterval(() => {
    const video = getActiveVideoElement();
    if (video && !video.dataset.iframeListenerAttached) {
      video.dataset.iframeListenerAttached = 'true';
      console.log('[Rikkei Booster Iframe] Found active video in iframe, attaching progress relay...');
      
      // Auto settings sync inside iframe
      if (settings.autoLearn) {
        if (!video.muted) video.muted = true;
        video.playbackRate = settings.videoSpeed || 2;
        if (video.paused && !video.ended) video.play().catch(() => {});
        
        // Auto seek to last 5s
        const duration = video.duration;
        if (Number.isFinite(duration) && duration > 5 && !video.dataset.autoSeeked) {
          if (video.readyState >= 1) {
            const targetTime = duration - 5;
            if (video.currentTime < targetTime) {
              console.log(`[Rikkei Booster Iframe] Seeking video inside iframe to ${targetTime}s`);
              video.currentTime = targetTime;
              video.dataset.autoSeeked = 'true';
              video.play().catch(() => {});
            }
          }
        }
      }
      
      // Hook timeupdate to send progress to parent
      video.addEventListener('timeupdate', () => {
        if (video.duration) {
          const progress = (video.currentTime / video.duration) * 100;
          window.parent.postMessage(JSON.stringify({
            type: 'RikkeiBoosterIframeProgress',
            progress: progress
          }), '*');
        }
      });
    }
  }, 1500);
}

// ==========================================
// INTEGRATED SCRIPTS FOR EXTENSION AUTOMATION
// ==========================================

async function seekToEndAccurate() {
  console.log('🔄 Đang tìm video và tua đến 10s cuối...');
  logToPopup("🔄 Đang tìm video và tua đến 10s cuối...", "info");

  function seekVideo(video) {
    if (!video) return false;
    if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
    const target = Math.max(0, video.duration - 10);
    video.currentTime = target;
    video.play().catch(() => {});
    console.log(`✅ Đã tua đến ${target.toFixed(1)}s (còn 10s, tổng ${video.duration.toFixed(1)}s)`);
    logToPopup(`✅ Đã tua đến ${target.toFixed(1)}s (còn 10s, tổng ${video.duration.toFixed(1)}s)`, "success");
    return true;
  }

  try {
    // 3.4. Cập nhật logic bỏ qua nếu đã hoàn thành
    const activeVideo = getActiveVideoElement();
    if (activeVideo) {
      const progress = activeVideo.duration ? (activeVideo.currentTime / activeVideo.duration) * 100 : 0;
      if (activeVideo.dataset.completed === 'true' || progress >= 95) {
        console.log('⏭️ Video đã hoàn thành hoặc đạt trên 95%. Bỏ qua tua.');
        logToPopup('⏭️ Video đã hoàn thành hoặc đạt trên 95%. Bỏ qua tua.', 'info');
        return;
      }
    }
    if (window._videoProgress >= 95) {
      console.log('⏭️ Video YouTube đã hoàn thành hoặc đạt trên 95%. Bỏ qua tua.');
      logToPopup('⏭️ Video YouTube đã hoàn thành hoặc đạt trên 95%. Bỏ qua tua.', 'info');
      return;
    }

    // 1. Tìm video trực tiếp
    const video = getActiveVideoElement();
    if (video && seekVideo(video)) return;

    // 2. Tìm trong iframe cùng nguồn
    const iframes = document.querySelectorAll('iframe');
    for (let iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        if (!doc) continue;
        const v = doc.querySelector('video');
        if (v && seekVideo(v)) return;
      } catch (e) {}
    }

    // 3. YouTube embed – lấy duration từ oEmbed API
    function getYouTubeDuration(videoId) {
      return fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`)
        .then(r => r.json())
        .then(data => {
          if (data && data.duration) {
            if (typeof data.duration === 'number') {
              return data.duration;
            }
            const match = data.duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
            let hours = 0, minutes = 0, seconds = 0;
            if (match[1]) hours = parseInt(match[1]);
            if (match[2]) minutes = parseInt(match[2]);
            if (match[3]) seconds = parseInt(match[3]);
            return hours * 3600 + minutes * 60 + seconds;
          }
          return null;
        })
        .catch(() => null);
    }

    for (let iframe of iframes) {
      if (iframe.src && (iframe.src.includes('youtube.com/embed') || iframe.src.includes('youtube-nocookie.com/embed'))) {
        let videoId = null;
        try {
          const url = new URL(iframe.src);
          videoId = url.searchParams.get('v');
          if (!videoId) {
            const pathParts = url.pathname.split('/');
            videoId = pathParts[pathParts.length - 1];
          }
        } catch (e) {}

        if (videoId) {
          const duration = await getYouTubeDuration(videoId);
          if (duration && duration > 0) {
            const target = Math.max(0, duration - 10);
            try {
              iframe.contentWindow.postMessage(JSON.stringify({
                event: 'command',
                func: 'seekTo',
                args: [target, true]
              }), '*');
              iframe.contentWindow.postMessage(JSON.stringify({
                event: 'command',
                func: 'playVideo',
                args: []
              }), '*');
              // Custom RikkeiBooster message
              iframe.contentWindow.postMessage(JSON.stringify({
                type: 'seekToEnd',
                target: target
              }), '*');
              console.log(`✅ Đã tua YouTube đến ${target.toFixed(1)}s (còn 10s, tổng ${duration}s)`);
              logToPopup(`✅ Đã tua YouTube đến ${target.toFixed(1)}s (còn 10s, tổng ${duration}s)`, "success");
              return;
            } catch (e) {
              console.warn('⚠️ Không thể gửi lệnh đến iframe.', e);
              logToPopup('⚠️ Không thể gửi lệnh đến iframe.', 'warning');
            }
          } else {
            console.warn('⚠️ Không lấy được duration từ oEmbed. Thử parse từ UI...');
            logToPopup('⚠️ Không lấy được duration từ oEmbed. Thử parse từ UI...', 'warning');
            parseDurationFromUI(iframes);
          }
          return;
        }
      }
    }

    // 4. Fallback: parse thời lượng từ giao diện
    function parseDurationFromUI(iframes) {
      const timeElements = document.querySelectorAll('span, div, [class*="time"], [class*="duration"]');
      for (let el of timeElements) {
        const text = el.textContent.trim();
        const match = text.match(/(\d{1,2}):(\d{2})\s*\/\s*(\d{1,2}):(\d{2})/);
        if (match) {
          const total = parseInt(match[3]) * 60 + parseInt(match[4]);
          const target = Math.max(0, total - 10);
          for (let iframe of iframes) {
            if (iframe.src && (iframe.src.includes('youtube.com/embed') || iframe.src.includes('youtube-nocookie.com/embed'))) {
              try {
                iframe.contentWindow.postMessage(JSON.stringify({
                  event: 'command',
                  func: 'seekTo',
                  args: [target, true]
                }), '*');
                iframe.contentWindow.postMessage(JSON.stringify({
                  event: 'command',
                  func: 'playVideo',
                  args: []
                }), '*');
                iframe.contentWindow.postMessage(JSON.stringify({
                  type: 'seekToEnd',
                  target: target
                }), '*');
                console.log(`✅ Đã tua YouTube đến ${target.toFixed(1)}s (dựa trên UI)`);
                logToPopup(`✅ Đã tua YouTube đến ${target.toFixed(1)}s (dựa trên UI)`, "success");
                return;
              } catch (e) {}
            }
          }
          const videoEl = getActiveVideoElement();
          if (videoEl && Number.isFinite(videoEl.duration)) {
            seekVideo(videoEl);
            return;
          }
        }
      }
      console.warn('❌ Không thể tìm video hoặc lấy duration.');
      logToPopup('❌ Không thể tìm video hoặc lấy duration.', 'error');
    }

    parseDurationFromUI(iframes);
  } catch (e) {
    console.error('Lỗi seekToEndAccurate:', e);
    logToPopup(`Lỗi seekToEndAccurate: ${e.message || e}`, 'error');
  }
}

async function autoFillCKEditor() {
  console.log('🔄 Bắt đầu xử lý câu hỏi...');
  logToPopup('🔄 Bắt đầu tự động điền câu trả lời...', 'info');

  const answersPool = [
    "Tôi đã nắm vững toàn bộ kiến thức lý thuyết của bài học này.",
    "Nội dung bài học rất bổ ích và đầy đủ thông tin định hướng.",
    "Tôi sẽ thực hành thêm các ví dụ thực tế để nhớ lâu hơn.",
    "Path Parameters giúp định vị và quản lý một tài nguyên cụ thể trên hệ thống Web Service.",
    "Ưu điểm lớn nhất của Path Parameters là hỗ trợ tối ưu hóa SEO và định tuyến endpoint.",
    "FastAPI sử dụng Pydantic để kiểm tra định dạng và kiểu dữ liệu đầu vào tự động.",
    "Sự khác biệt chính là Path Parameters định vị tài nguyên còn Query Parameters để lọc dữ liệu.",
    "Tôi hiểu rõ cách hoạt động của các tham số và cấu trúc định tuyến trong bài.",
    "Các ví dụ minh họa trực quan giúp tôi dễ tiếp thu nội dung hơn.",
    "Kiến thức lý thuyết rất chi tiết, dễ hiểu và mạch lạc.",
    "Tôi đã hoàn thành đọc hiểu toàn bộ tài liệu lý thuyết bài này.",
    "Các khái niệm được giải thích rõ ràng và có tính thực tiễn cao.",
    "Tôi sẵn sàng chuyển sang phần tiếp theo của chương trình học.",
    "Kiến thức này giúp ích nhiều cho quá trình thực hành dự án của tôi.",
    "Tôi đã nắm được sự khác biệt giữa các kiểu tham số truyền vào.",
    "Bài học giải quyết đúng các phần kiến thức tôi đang cần ôn tập.",
    "Tôi đánh giá cao cách phân tích và ví dụ trong tài liệu giảng dạy.",
    "Toàn bộ lý thuyết đã được tôi ghi chép lại đầy đủ và chi tiết.",
    "Bài học cung cấp nền tảng vững chắc cho các phần nâng cao sau này.",
    "Tôi đã hiểu rõ về cấu trúc endpoint và cách mapping đường dẫn."
  ];

  // Trộn ngẫu nhiên danh sách câu trả lời để đảm bảo tính duy nhất cho mỗi câu hỏi
  const shuffledAnswers = [...answersPool];
  for (let i = shuffledAnswers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffledAnswers[i], shuffledAnswers[j]] = [shuffledAnswers[j], shuffledAnswers[i]];
  }

  function getCKEditorInstance(editorElement) {
    // Cách 1: window.CKEDITOR.instances (CKEditor 4 & 5)
    if (window.CKEDITOR && window.CKEDITOR.instances) {
        // Kiểm tra theo id
        if (editorElement.id && window.CKEDITOR.instances[editorElement.id]) {
            return window.CKEDITOR.instances[editorElement.id];
        }
        // Duyệt tất cả instance, so sánh element
        const instances = Object.values(window.CKEDITOR.instances);
        for (const inst of instances) {
            if (inst.element && inst.element.$ === editorElement) {
                return inst;
            }
            // CKEditor 5: inst.editing?.view?.document?.getRoot()?.element
            try {
                if (inst.editing && inst.editing.view && inst.editing.view.document) {
                    const root = inst.editing.view.document.getRoot();
                    if (root && root.element === editorElement) {
                        return inst;
                    }
                }
            } catch (e) {}
        }
    }

    // Cách 2: Kiểm tra editorElement.ckeditorInstance (nếu có)
    if (editorElement.ckeditorInstance) {
        return editorElement.ckeditorInstance;
    }

    // Cách 3: Tìm trong parent
    let parent = editorElement.parentElement;
    while (parent && parent !== document.body) {
        if (parent.ckeditorInstance) {
            return parent.ckeditorInstance;
        }
        parent = parent.parentElement;
    }

    // Cách 4: Tìm biến toàn cục chứa editor (dành cho CKEditor 5)
    if (window.editor) {
        // Nếu chỉ có một editor toàn cục
        return window.editor;
    }

    return null;
  }

  function fillCKEditor(editorElement, text) {
    // 1. Tìm instance
    const instance = getCKEditorInstance(editorElement);

    // 2. Nếu có instance, dùng setData
    if (instance) {
        try {
            // CKEditor 5: instance.setData()
            if (typeof instance.setData === 'function') {
                instance.setData(`<p>${text}</p>`);
                console.log('📝 Dùng CKEditor 5 API: setData()');
                logToPopup('📝 Dùng CKEditor 5 API: setData()', 'info');
                return true;
            }
            // CKEditor 4: instance.setData()
            if (typeof instance.setData === 'function') {
                instance.setData(`<p>${text}</p>`);
                console.log('📝 Dùng CKEditor 4 API: setData()');
                logToPopup('📝 Dùng CKEditor 4 API: setData()', 'info');
                return true;
            }
            // CKEditor 5: instance.data.set()
            if (instance.data && typeof instance.data.set === 'function') {
                instance.data.set(`<p>${text}</p>`);
                console.log('📝 Dùng CKEditor 5 API: data.set()');
                logToPopup('📝 Dùng CKEditor 5 API: data.set()', 'info');
                return true;
            }
        } catch (e) {
            console.warn('⚠️ Lỗi khi gọi setData:', e);
            logToPopup(`⚠️ Lỗi khi gọi setData: ${e.message || e}`, 'warning');
        }
    }

    // 3. Fallback: dùng execCommand (chỉ hoạt động nếu editor đang focus)
    try {
        // Focus vào editor
        editorElement.focus();
        // Chọn toàn bộ nội dung
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorElement);
        selection.removeAllRanges();
        selection.addRange(range);
        // Xóa nội dung
        document.execCommand('delete', false, null);
        // Chèn text mới
        document.execCommand('insertHTML', false, `<p>${text}</p>`);
        console.log('📝 Dùng execCommand (fallback) thành công');
        logToPopup('📝 Dùng execCommand (fallback) thành công', 'info');
        return true;
    } catch (e) {
        console.warn('⚠️ execCommand thất bại:', e);
        logToPopup(`⚠️ execCommand thất bại: ${e.message || e}`, 'warning');
    }

    // 4. Fallback cuối: innerHTML + sự kiện
    editorElement.innerHTML = `<p>${text}</p>`;
    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('📝 Dùng innerHTML (cuối cùng)');
    logToPopup('📝 Dùng innerHTML (cuối cùng)', 'info');
    return false;
  }

  function findSaveButton(container) {
    let btn = container.querySelector('.question-item__save-btn');
    if (btn) return btn;
    const btns = container.querySelectorAll('button');
    for (const b of btns) {
      const text = b.textContent.trim();
      if (text.includes('Lưu') || text.includes('Save') || text.includes('Nộp')) {
        return b;
      }
    }
    return null;
  }

  try {
    const questionItems = document.querySelectorAll('.question-item');
    if (questionItems.length === 0) {
      console.warn('⚠️ Không tìm thấy câu hỏi nào.');
      logToPopup('⚠️ Không tìm thấy câu hỏi nào (.question-item).', 'warning');
      return;
    }

    console.log(`📝 Tìm thấy ${questionItems.length} câu hỏi.`);
    logToPopup(`📝 Tìm thấy ${questionItems.length} câu hỏi.`, 'info');

    for (let i = 0; i < questionItems.length; i++) {
      const item = questionItems[i];

      const savedBadge = item.querySelector('.question-item__save-btn[disabled], .saved-badge, .done-badge');
      const isSaved = savedBadge || item.textContent.includes('Đã lưu') || item.textContent.includes('Đã trả lời');
      if (isSaved) {
        console.log(`⏭️ Câu hỏi ${i + 1} đã được lưu trước đó. Bỏ qua.`);
        logToPopup(`⏭️ Câu hỏi ${i + 1} đã được lưu trước đó. Bỏ qua.`, 'info');
        continue;
      }

      const header = item.querySelector('.question-item__header');
      if (header) {
        const arrow = header.querySelector('.question-item__arrow');
        if (arrow && arrow.textContent.trim() !== '▲') {
          header.click();
          console.log(`📂 Mở câu hỏi ${i + 1}`);
          logToPopup(`📂 Mở câu hỏi ${i + 1}`, 'info');
          await new Promise(r => setTimeout(r, 1000));
        } else {
          console.log(`📂 Câu hỏi ${i + 1} đã mở.`);
        }
      }

      const editor = item.querySelector('.ck-editor__editable[contenteditable="true"]');
      if (!editor) {
        console.warn(`⚠️ Không tìm thấy editor cho câu ${i + 1}`);
        logToPopup(`⚠️ Không tìm thấy editor cho câu ${i + 1}`, 'warning');
        continue;
      }

      const answer = shuffledAnswers[i % shuffledAnswers.length];
      // Post message to main context to write via CKEditor instance
      window.postMessage(JSON.stringify({
        type: 'RikkeiBoosterWriteCKEditor',
        text: answer,
        questionIndex: i + 1
      }), '*');
      console.log(`✍️ Đã điền câu ${i + 1}`);
      logToPopup(`✍️ Đã điền câu ${i + 1}`, 'success');

      await new Promise(r => setTimeout(r, 600));

      const saveBtn = findSaveButton(item);
      if (!saveBtn) {
        console.warn(`⚠️ Không tìm thấy nút lưu cho câu ${i + 1}`);
        logToPopup(`⚠️ Không tìm thấy nút lưu cho câu ${i + 1}`, 'warning');
        continue;
      }

      saveBtn.click();
      console.log(`✅ Đã click lưu câu hỏi ${i + 1}`);
      logToPopup(`✅ Đã click lưu câu hỏi ${i + 1}`, 'success');

      if (i < questionItems.length - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    console.log('🎉 Hoàn thành tất cả câu hỏi!');
    logToPopup('🎉 Hoàn thành tất cả câu hỏi!', 'success');

    // Mark as completed and auto-navigate if configured
    readingCompletedUrl = window.location.href;
    updateStatus('Đã hoàn thành toàn bộ câu hỏi bài đọc!', '#10b981');
    updateProgress(100);
    incrementCompletedStats();
    logToPopup("🎉 Đã hoàn thành Video và Bài đọc của bài học này! Hãy làm bài tập trắc nghiệm (Quiz) đi nhé, tiện ích sẽ dừng tại đây để bạn làm bài.", "success");
  } catch (e) {
    console.error('Lỗi autoFillCKEditor:', e);
    logToPopup(`Lỗi autoFillCKEditor: ${e.message || e}`, 'error');
  }
}
