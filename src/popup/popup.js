// ============================================================
// Video FrameGrab — Popup Script v2.0
// Controls capture logic, advanced settings, tabs, history.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM elements ---
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const intervalInput = document.getElementById('intervalInput');
    const autoCaptureToggle = document.getElementById('autoCaptureToggle');

    const startRange = document.getElementById('startRange');
    const endRange = document.getElementById('endRange');
    const fileNameTemplate = document.getElementById('fileNameTemplate');
    const includeContactSheetToggle = document.getElementById('includeContactSheetToggle');

    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const counterNumber = document.getElementById('counterNumber');
    const counterDisplay = document.getElementById('counterDisplay');
    const errorMsg = document.getElementById('errorMsg');

    // Tabs
    const tabs = document.querySelectorAll('.tab');
    const views = document.querySelectorAll('.view');

    // History
    const historyList = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');

    let isCapturing = false;
    let statusPollTimer = null;

    // --- Tabs Logic ---
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Remove active from all
            tabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => {
                v.classList.remove('active');
                v.style.display = 'none';
            });

            // Set active
            tab.classList.add('active');
            const viewId = tab.getAttribute('data-tab') + 'View';
            const view = document.getElementById(viewId);
            view.classList.add('active');
            view.style.display = 'block';

            if (viewId === 'historyView') {
                loadHistory();
            }
        });
    });

    // --- Load saved settings ---
    const optionsKeys = [
        'captureInterval', 'autoCapture', 'startRange',
        'endRange', 'fileNameTemplate', 'includeContactSheet'
    ];

    chrome.storage.local.get(optionsKeys, (result) => {
        if (result.captureInterval) intervalInput.value = result.captureInterval;
        if (result.autoCapture !== undefined) autoCaptureToggle.checked = result.autoCapture;
        if (result.startRange) startRange.value = result.startRange;
        if (result.endRange) endRange.value = result.endRange;
        if (result.fileNameTemplate) fileNameTemplate.value = result.fileNameTemplate;
        if (result.includeContactSheet !== undefined) includeContactSheetToggle.checked = result.includeContactSheet;
    });

    // --- Save settings logic ---
    function saveSetting(key, val) {
        chrome.storage.local.set({ [key]: val });
    }

    intervalInput.addEventListener('change', () => {
        let val = parseInt(intervalInput.value, 10);
        if (isNaN(val) || val < 1) val = 1;
        if (val > 120) val = 120;
        intervalInput.value = val;
        saveSetting('captureInterval', val);
    });

    autoCaptureToggle.addEventListener('change', () => saveSetting('autoCapture', autoCaptureToggle.checked));
    startRange.addEventListener('change', () => saveSetting('startRange', startRange.value));
    endRange.addEventListener('change', () => saveSetting('endRange', endRange.value));
    fileNameTemplate.addEventListener('change', () => saveSetting('fileNameTemplate', fileNameTemplate.value));
    includeContactSheetToggle.addEventListener('change', () => saveSetting('includeContactSheet', includeContactSheetToggle.checked));

    // --- Helper: get the active video tab ---
    async function getVideoTab() {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs.length === 0) return null;
        const tab = tabs[0];

        // Ignore internal chrome pages
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('edge://')) return null;
        return tab;
    }

    // --- Helper: send message to content script ---
    function sendToContent(tab, message) {
        return new Promise((resolve, reject) => {
            chrome.tabs.sendMessage(tab.id, message, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                } else {
                    resolve(response);
                }
            });
        });
    }

    // --- Update UI state ---
    function updateUI(capturing, frames) {
        isCapturing = capturing;

        if (capturing) {
            statusDot.className = 'status-dot capturing';
            statusText.textContent = 'Capturing';
            startBtn.disabled = true;
            stopBtn.disabled = false;
            counterDisplay.classList.add('active');
        } else {
            statusDot.className = 'status-dot idle';
            statusText.textContent = 'Idle';
            startBtn.disabled = false;
            stopBtn.disabled = true;
            counterDisplay.classList.remove('active');
        }

        if (frames !== undefined) {
            counterNumber.textContent = frames;
        }

        errorMsg.style.display = 'none';
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.style.display = 'block';
        statusDot.className = 'status-dot error';
        statusText.textContent = 'Error';
    }

    // --- Poll status from content script (real-time counter) ---
    function startStatusPolling(tab) {
        if (statusPollTimer) clearInterval(statusPollTimer);

        statusPollTimer = setInterval(async () => {
            try {
                const response = await sendToContent(tab, { action: 'getStatus' });
                if (response) {
                    updateUI(response.isCapturing, response.frameIndex);
                    if (!response.isCapturing) {
                        clearInterval(statusPollTimer);
                        statusPollTimer = null;
                    }
                }
            } catch (e) {
                clearInterval(statusPollTimer);
                statusPollTimer = null;
                updateUI(false, 0);
            }
        }, 1000);
    }

    // --- Start button ---
    startBtn.addEventListener('click', async () => {
        const tab = await getVideoTab();
        if (!tab) {
            showError('Please open a page with a video first.');
            return;
        }

        const interval = parseInt(intervalInput.value, 10) || 6;

        try {
            const response = await sendToContent(tab, {
                action: 'startCapture',
                interval: interval
            });

            if (response && response.success) {
                updateUI(true, 0);
                startStatusPolling(tab);
            } else {
                showError('Could not start capture. Is a video playing?');
            }
        } catch (e) {
            showError('Cannot communicate with the page. Try reloading it.');
        }
    });

    // --- Stop button ---
    stopBtn.addEventListener('click', async () => {
        const tab = await getVideoTab();
        if (!tab) {
            updateUI(false, 0);
            return;
        }

        statusDot.className = 'status-dot idle';
        statusText.textContent = 'Zipping...';
        stopBtn.disabled = true;

        try {
            const response = await sendToContent(tab, { action: 'stopCapture' });
            updateUI(false, response?.totalFrames || 0);

            if (statusPollTimer) {
                clearInterval(statusPollTimer);
                statusPollTimer = null;
            }
            loadHistory(); // Refresh history immediately
        } catch (e) {
            updateUI(false, 0);
            showError('Error stopping capture or generating ZIP.');
        }
    });

    // --- History Management ---
    function loadHistory() {
        chrome.storage.local.get(['sessionHistory'], (result) => {
            const history = result.sessionHistory || [];
            if (history.length === 0) {
                historyList.innerHTML = '<div style="color:#666; font-size: 12px; text-align: center; padding: 20px;">No captures yet.</div>';
                clearHistoryBtn.style.display = 'none';
                return;
            }

            clearHistoryBtn.style.display = 'block';
            historyList.innerHTML = '';

            history.forEach(item => {
                const d = new Date(item.date);
                const dateStr = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                const el = document.createElement('div');
                el.className = 'history-item';
                el.innerHTML = `
          <div class="history-item-title" title="${item.title}">${item.title || 'Untitled Video'}</div>
          <div class="history-item-meta">
            <span>${dateStr}</span>
            <span style="color:#00e676;">${item.frameCount} frames</span>
          </div>
        `;
                historyList.appendChild(el);
            });
        });
    }

    clearHistoryBtn.addEventListener('click', () => {
        chrome.storage.local.set({ sessionHistory: [] }, () => {
            loadHistory();
        });
    });

    // --- On popup open: check current status ---
    (async () => {
        const tab = await getVideoTab();
        if (!tab) {
            startBtn.disabled = true;
            statusText.textContent = 'No Video';
            statusDot.className = 'status-dot error';
            return;
        }

        try {
            const response = await sendToContent(tab, { action: 'getStatus' });
            if (response) {
                updateUI(response.isCapturing, response.frameIndex);
                if (response.isCapturing) {
                    startStatusPolling(tab);
                } else if (!response.hasVideo) {
                    statusText.textContent = 'No Video Element';
                }
            }
        } catch (e) {
            updateUI(false, 0);
        }
    })();
});
