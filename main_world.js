console.warn('[Rikkei Booster Main World] Main world script loaded successfully! Version 3.3');

// Mock native confirm dialog to prevent blocking RikkeiEdu pages
(function() {
  const originalConfirm = window.confirm;
  window.confirm = function(message) {
    if (message && (message.includes('đã được trả lời') || message.includes('xem lại câu trả lời') || message.includes('trả lời'))) {
      console.warn("[Rikkei Booster Mock] Automatically bypassed browser confirm popup:", message);
      return true; // Click OK automatically
    }
    return originalConfirm ? originalConfirm.apply(this, arguments) : true;
  };
})();

// Helper to find question container (same logic as content.js)
function findQuestionContainer(header) {
  if (!header) return null;
  return header.closest('.question-item, [class*="question"], .card, form') || header.parentElement;
}

// Helper to find editor inside container (same logic as content.js)
function findEditor(container) {
  if (!container) return null;
  
  const selectors = [
    '.ck-editor__editable',
    '.ql-editor',
    '[contenteditable]',
    'textarea',
    'input[type="text"]',
    '[class*="editor"]'
  ];
  
  for (let selector of selectors) {
    const el = container.querySelector(selector);
    if (el && el.offsetHeight > 0) {
      return el;
    }
  }
  
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
    } catch (e) {}
  }
  
  for (let selector of selectors) {
    const el = container.querySelector(selector);
    if (el) return el;
  }
  
  return null;
}

window.rikkeiTest = function() {
  console.warn("[Rikkei Booster] Console command intercepted. Relaying diagnostic request to extension context...");
  window.postMessage(JSON.stringify({ type: 'RikkeiBoosterRunTest' }), '*');
  return "Running diagnostics inside extension context... Review console logs below.";
};

// Action Recorder / Event Logger for user demonstrations
window.rikkeiStartRecord = function() {
  console.warn('[Rikkei Recorder] Started recording user actions. Perform your manual actions now...');
  
  const logEvent = (name, details) => {
    console.warn(`[Rikkei Event: ${name}]`, details);
  };
  
  // 1. Log clicks
  document.addEventListener('click', (e) => {
    if (!e.target) return;
    const path = [];
    let el = e.target;
    while (el && el !== document.body) {
      path.push(el.tagName + (el.className ? '.' + el.className.split(' ').join('.') : ''));
      el = el.parentElement;
    }
    logEvent('CLICK', {
      tagName: e.target.tagName,
      id: e.target.id,
      classes: e.target.className,
      text: e.target.textContent ? e.target.textContent.trim().substring(0, 100).normalize('NFC') : '',
      selectorPath: path.reverse().join(' > ')
    });
  }, true);
  
  // 2. Log focus
  document.addEventListener('focusin', (e) => {
    if (!e.target) return;
    logEvent('FOCUS', {
      tagName: e.target.tagName,
      id: e.target.id,
      classes: e.target.className
    });
  }, true);
  
  // 3. Log inputs
  document.addEventListener('input', (e) => {
    if (!e.target) return;
    logEvent('INPUT', {
      tagName: e.target.tagName,
      id: e.target.id,
      classes: e.target.className,
      value: e.target.value || e.target.innerHTML
    });
  }, true);
  
  // 4. Hook into CKEditor instances and log their model changes
  try {
    const editables = Array.from(document.querySelectorAll('.ck-editor__editable'));
    editables.forEach(ed => {
      let ckInstance = ed.ckeditorInstance;
      if (!ckInstance) {
        let parent = ed.parentElement;
        while (parent && parent !== document.body) {
          if (parent.ckeditorInstance) {
            ckInstance = parent.ckeditorInstance;
            break;
          }
          parent = parent.parentElement;
        }
      }
      
      if (ckInstance && ckInstance.model && ckInstance.model.document) {
        console.warn('[Rikkei Recorder] Attached listener to CKEditor 5 model document.');
        ckInstance.model.document.on('change:data', () => {
          logEvent('CKEDITOR_MODEL_CHANGE', {
            data: ckInstance.getData()
          });
        });
      }
    });
  } catch (err) {
    console.warn('[Rikkei Recorder] Failed to bind CKEditor listener:', err);
  }
  
  return "Recording active. Perform your actions in the editor and click submit to record!";
};

// Auto-run the action recorder after 2.5 seconds to capture user actions automatically
setTimeout(() => {
  if (typeof window.rikkeiStartRecord === 'function') {
    window.rikkeiStartRecord();
  }
}, 2500);

// Interactive Auto-Fill on Focus/Click Listener
document.addEventListener('focusin', (e) => {
  if (!e.target) return;
  
  // 1. CKEditor 5
  if (e.target.classList.contains('ck-editor__editable') || e.target.getAttribute('contenteditable') === 'true') {
    let ckInstance = e.target.ckeditorInstance;
    
    // 1. Check parent tree for instance
    if (!ckInstance) {
      let parent = e.target.parentElement;
      while (parent && parent !== document.body) {
        if (parent.ckeditorInstance) {
          ckInstance = parent.ckeditorInstance;
          break;
        }
        parent = parent.parentElement;
      }
    }
    
    // 2. Check globally inside the question container
    if (!ckInstance) {
      const container = e.target.closest('.question-item, [class*="question"], .card, form');
      if (container) {
        const allEls = Array.from(container.querySelectorAll('*'));
        const elWithInstance = allEls.find(el => el.ckeditorInstance);
        if (elWithInstance) {
          ckInstance = elWithInstance.ckeditorInstance;
        }
      }
    }
    
    if (ckInstance) {
      const currentData = ckInstance.getData().trim();
      if (currentData === '' || currentData === '<p>&nbsp;</p>' || currentData === '<p></p>' || currentData === '<p><br></p>') {
        const sampleAnswers = [
          "Path Parameters giúp định vị và quản lý một tài nguyên cụ thể trên hệ thống Web Service, giúp URL gọn gàng hơn.",
          "Ưu điểm lớn nhất của Path Parameters là hỗ trợ tối ưu hóa SEO và định tuyến endpoint tĩnh, giúp bảo mật hơn.",
          "FastAPI sử dụng Pydantic để kiểm tra định dạng và kiểu dữ liệu đầu vào cho Path Parameters tự động.",
          "Sự khác biệt chính là Path Parameters định vị tài nguyên duy nhất còn Query Parameters dùng để lọc dữ liệu.",
          "Tôi đã nắm vững toàn bộ kiến thức lý thuyết về FastAPI Routing và các tham số đường dẫn."
        ];
        const randomAnswer = sampleAnswers[Math.floor(Math.random() * sampleAnswers.length)];
        ckInstance.setData(randomAnswer);
        
        e.target.dispatchEvent(new Event('input', { bubbles: true }));
        e.target.dispatchEvent(new Event('change', { bubbles: true }));
        console.warn("[Rikkei Booster] Auto-filled CKEditor on user focus/click!");
      }
    }
  }
  
  // 2. Textarea / Input
  if (e.target.tagName === 'TEXTAREA' || (e.target.tagName === 'INPUT' && e.target.type === 'text')) {
    const isAnswerField = e.target.closest('.question-item, [class*="question"], .card, form');
    if (isAnswerField && e.target.value.trim() === '') {
      const sampleAnswers = [
        "Path Parameters giúp định vị và quản lý một tài nguyên cụ thể trên hệ thống Web Service, giúp URL gọn gàng hơn.",
        "Ưu điểm lớn nhất của Path Parameters là hỗ trợ tối ưu hóa SEO và định tuyến endpoint tĩnh, giúp bảo mật hơn.",
        "FastAPI sử dụng Pydantic để kiểm tra định dạng và kiểu dữ liệu đầu vào cho Path Parameters tự động.",
        "Sự khác biệt chính là Path Parameters định vị tài nguyên duy nhất còn Query Parameters dùng để lọc dữ liệu.",
        "Tôi đã nắm vững toàn bộ kiến thức lý thuyết về FastAPI Routing và các tham số đường dẫn."
      ];
      const randomAnswer = sampleAnswers[Math.floor(Math.random() * sampleAnswers.length)];
      e.target.value = randomAnswer;
      e.target.dispatchEvent(new Event('input', { bubbles: true }));
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
      console.warn("[Rikkei Booster] Auto-filled Input/Textarea on user focus/click!");
    }
  }
}, true);

// Main context message receiver for CKEditor 5 direct writing
window.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(event.data);
    if (data.type === 'RikkeiBoosterWriteCKEditor') {
      const text = data.text;
      const questionIndex = data.questionIndex;
      
      console.warn(`[Rikkei Booster Main World] Received request to write to Question ${questionIndex}`);
      
      // Locate the specific question container
      const elements = Array.from(document.querySelectorAll('span, button, a, h1, h2, h3, h4, h5, p, div')).reverse();
      const regex = new RegExp(`^câuhỏi${questionIndex}(?:\\D|$)`);
      const targetHeader = elements.find(el => {
        const t = el.textContent.trim().toLowerCase().replace(/\s+/g, '').normalize('NFC');
        return regex.test(t);
      });
      
      if (targetHeader) {
        const container = findQuestionContainer(targetHeader);
        if (container) {
          const ed = findEditor(container);
          if (ed) {
            fillCKEditor(ed, text);
            return;
          }
        }
      }
      
      // Fallback: search globally if targeted search fails
      const editables = Array.from(document.querySelectorAll('.ck-editor__editable, [contenteditable]'));
      for (let ed of editables) {
        if (ed.offsetHeight > 0) {
          if (fillCKEditor(ed, text)) {
            break;
          }
        }
      }
    }
  } catch (e) {
    // Not our message
  }
});

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
                return true;
            }
            // CKEditor 4: instance.setData()
            if (typeof instance.setData === 'function') {
                instance.setData(`<p>${text}</p>`);
                console.log('📝 Dùng CKEditor 4 API: setData()');
                return true;
            }
            // CKEditor 5: instance.data.set()
            if (instance.data && typeof instance.data.set === 'function') {
                instance.data.set(`<p>${text}</p>`);
                console.log('📝 Dùng CKEditor 5 API: data.set()');
                return true;
            }
        } catch (e) {
            console.warn('⚠️ Lỗi khi gọi setData:', e);
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
        return true;
    } catch (e) {
        console.warn('⚠️ execCommand thất bại:', e);
    }

    // 4. Fallback cuối: innerHTML + sự kiện
    editorElement.innerHTML = `<p>${text}</p>`;
    editorElement.dispatchEvent(new Event('input', { bubbles: true }));
    editorElement.dispatchEvent(new Event('change', { bubbles: true }));
    console.log('📝 Dùng innerHTML (cuối cùng)');
    return false;
}
