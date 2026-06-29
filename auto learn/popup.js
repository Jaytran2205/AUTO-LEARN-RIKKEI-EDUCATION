// popup.js - Controller for the EduBot Pro Popup

document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    autoLearn: document.getElementById("autoLearn"),
    autoNext: document.getElementById("autoNext"),
    seekSpeed: document.getElementById("seekSpeed"),
    videoSpeed: document.getElementById("videoSpeed"),
    status: document.getElementById("status"),
    statusBadge: document.getElementById("status-badge"),
    progressBarFill: document.getElementById("progressBarFill"),
    progressPercent: document.getElementById("progressPercent"),
    logTerminal: document.getElementById("log-terminal"),
    clearLogBtn: document.getElementById("clear-log-btn"),
    statsCompleted: document.getElementById("statsCompleted"),
    statsTimeSaved: document.getElementById("statsTimeSaved")
  };

  // Helper to add logs to UI
  function addLog(text, type = "system") {
    if (!elements.logTerminal) return;
    const line = document.createElement("div");
    line.className = `log-line ${type}-msg`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${text}`;
    elements.logTerminal.appendChild(line);
    elements.logTerminal.scrollTop = elements.logTerminal.scrollHeight;
  }

  // Load saved state and settings
  chrome.storage.sync.get(
    {
      autoLearn: true,
      autoNext: true,
      seekSpeed: 10,
      videoSpeed: 2,
      statsCompleted: 0,
      statsTimeSaved: 0,
      botLogs: []
    },
    (settings) => {
      // Set UI control values
      elements.autoLearn.checked = settings.autoLearn;
      elements.autoNext.checked = settings.autoNext;
      elements.seekSpeed.value = settings.seekSpeed;
      elements.videoSpeed.value = settings.videoSpeed;

      // Set statistics values
      elements.statsCompleted.textContent = settings.statsCompleted || 0;
      elements.statsTimeSaved.textContent = (settings.statsTimeSaved || 0) + "m";

      // Load saved logs
      if (settings.botLogs && Array.isArray(settings.botLogs)) {
        elements.logTerminal.innerHTML = ""; // Clear initial message
        settings.botLogs.forEach((log) => {
          const line = document.createElement("div");
          line.className = `log-line ${log.type}-msg`;
          line.textContent = log.text;
          elements.logTerminal.appendChild(line);
        });
        elements.logTerminal.scrollTop = elements.logTerminal.scrollHeight;
      }
    }
  );

  // Sync configuration updates
  const configToggles = ["autoLearn", "autoNext"];
  configToggles.forEach((id) => {
    elements[id].addEventListener("change", function () {
      chrome.storage.sync.set({ [id]: this.checked }, () => {
        addLog(`Cập nhật: ${getLabelText(id)} = ${this.checked ? "BẬT" : "TẮT"}`, "info");
        sendSettingsToActiveTab();
      });
    });
  });

  elements.seekSpeed.addEventListener("input", function () {
    const val = parseInt(this.value) || 10;
    chrome.storage.sync.set({ seekSpeed: val }, () => {
      sendSettingsToActiveTab();
    });
  });

  elements.videoSpeed.addEventListener("change", function () {
    const val = parseFloat(this.value) || 2;
    chrome.storage.sync.set({ videoSpeed: val }, () => {
      addLog(`Cập nhật tốc độ video: ${val}x`, "info");
      sendSettingsToActiveTab();
    });
  });

  function getLabelText(id) {
    if (id === "autoLearn") return "Tự động học";
    if (id === "autoNext") return "Tự động chuyển bài";
    return id;
  }

  // Clear Logs
  elements.clearLogBtn.addEventListener("click", () => {
    elements.logTerminal.innerHTML = "";
    chrome.storage.sync.set({ botLogs: [] });
  });

  // Helper to find the correct target RikkeiEdu or test-harness tab
  function getTargetTab(callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (activeTab && activeTab.url && (activeTab.url.includes("rikkei.edu.vn") || activeTab.url.includes("test-harness.html"))) {
        callback(activeTab);
      } else {
        // Fallback: search all tabs for a match
        chrome.tabs.query({}, (allTabs) => {
          const match = allTabs.find(t => t.url && (t.url.includes("rikkei.edu.vn") || t.url.includes("test-harness.html")));
          if (match) {
            callback(match);
          } else if (activeTab) {
            callback(activeTab);
          }
        });
      }
    });
  }

  // Manual Seek Click
  const manualSeek = document.getElementById("manualSeek");
  if (manualSeek) {
    manualSeek.addEventListener("click", () => {
      getTargetTab((tab) => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "manualSeek" }, (response) => {
            if (chrome.runtime.lastError) {
              elements.status.textContent = "Vui lòng F5 (tải lại trang) RikkeiEdu!";
              elements.status.style.color = "#ff0055";
            } else {
              addLog("Đã gửi yêu cầu tua video đến cuối (oEmbed/API)...", "info");
            }
          });
        }
      });
    });
  }

  // Manual Go To Reading Click
  const manualGoToReading = document.getElementById("manualGoToReading");
  if (manualGoToReading) {
    manualGoToReading.addEventListener("click", () => {
      getTargetTab((tab) => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "manualGoToReading" }, (response) => {
            if (chrome.runtime.lastError) {
              elements.status.textContent = "Vui lòng F5 (tải lại trang) RikkeiEdu!";
              elements.status.style.color = "#ff0055";
            } else {
              addLog("Đang chuyển sang phần bài đọc...", "info");
            }
          });
        }
      });
    });
  }

  // Manual Fill Reading Click
  const manualFillReading = document.getElementById("manualFillReading");
  if (manualFillReading) {
    manualFillReading.addEventListener("click", () => {
      getTargetTab((tab) => {
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "manualFillReading" }, (response) => {
            if (chrome.runtime.lastError) {
              elements.status.textContent = "Vui lòng F5 (tải lại trang) RikkeiEdu!";
              elements.status.style.color = "#ff0055";
            } else {
              addLog("Đã gửi yêu cầu tự động điền bài đọc...", "info");
            }
          });
        }
      });
    });
  }

  // Send settings payload to content script
  function sendSettingsToActiveTab() {
    getTargetTab((tab) => {
      if (tab && tab.id) {
        chrome.tabs.sendMessage(
          tab.id,
          {
            type: "updateSettings",
            settings: {
              autoLearn: elements.autoLearn.checked,
              autoNext: elements.autoNext.checked,
              seekSpeed: parseInt(elements.seekSpeed.value) || 10,
              videoSpeed: parseFloat(elements.videoSpeed.value) || 2
            }
          },
          (response) => {
            if (chrome.runtime.lastError) {
              if (tab.url && tab.url.includes("rikkei.edu.vn")) {
                elements.status.textContent = "Vui lòng F5 trang học tập!";
                elements.status.style.color = "#ff0055";
              } else {
                elements.status.textContent = "Đang chờ trang rikkei.edu.vn...";
                elements.status.style.color = "#9f9baa";
              }
            } else if (response) {
              elements.status.textContent = response.statusText || "Đã kết nối trang học tập.";
              elements.status.style.color = response.color || "#00f3ff";
            }
          }
        );
      }
    });
  }

  // Receive status, progress, and logs updates from Content Script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "statusUpdate") {
      elements.status.textContent = message.text;
      if (message.color) {
        elements.status.style.color = message.color;
      }
    } else if (message.type === "progressUpdate") {
      const percentage = Math.min(100, Math.max(0, Math.round(message.value)));
      elements.progressBarFill.style.width = percentage + "%";
      elements.progressPercent.textContent = percentage + "%";
    } else if (message.action === "logFromBot") {
      addLog(message.text, message.logType);

      // Save log entry to storage history
      chrome.storage.sync.get({ botLogs: [] }, (data) => {
        const logs = data.botLogs || [];
        const time = new Date().toLocaleTimeString();
        const logEntry = {
          text: `[${time}] ${message.text}`,
          type: message.logType
        };
        if (logs.length >= 50) logs.shift();
        logs.push(logEntry);
        chrome.storage.sync.set({ botLogs: logs });
      });
    }
    sendResponse({ status: "ok" });
  });

  // Listen for storage changes to update statistics dynamically
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (changes.statsCompleted) {
      elements.statsCompleted.textContent = changes.statsCompleted.newValue;
    }
    if (changes.statsTimeSaved) {
      elements.statsTimeSaved.textContent = changes.statsTimeSaved.newValue + "m";
    }
  });

  // Query initial status on load
  function queryStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id && tabs[0].url && tabs[0].url.includes("rikkei.edu.vn")) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "requestStatus" }, (response) => {
          if (chrome.runtime.lastError) {
            elements.status.textContent = "Vui lòng F5 trang học tập!";
            elements.status.style.color = "#ff0055";
          } else if (response) {
            elements.status.textContent = response.statusText || "Đã kết nối trang học tập.";
            elements.status.style.color = response.color || "#00ff88";
            const percentage = Math.min(100, Math.max(0, Math.round(response.progressValue || 0)));
            elements.progressBarFill.style.width = percentage + "%";
            elements.progressPercent.textContent = percentage + "%";
          }
        });
      } else {
        elements.status.textContent = "Đang chờ trang rikkei.edu.vn...";
        elements.status.style.color = "#9f9baa";
      }
    });
  }

  sendSettingsToActiveTab();
  setTimeout(queryStatus, 500);
});
