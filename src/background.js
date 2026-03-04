// ============================================================
// Video FrameGrab — Background Service Worker
// Handles the ZIP download, updating the action badge,
// and storing session history when capture stops.
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab ? sender.tab.id : null;

    switch (message.action) {
        case 'updateBadge':
            if (tabId) {
                chrome.action.setBadgeText({ text: message.text || '', tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#00e676', tabId: tabId });
            }
            sendResponse({ success: true });
            break;

        case 'clearBadge':
            if (tabId) {
                chrome.action.setBadgeText({ text: '', tabId: tabId });
            }
            sendResponse({ success: true });
            break;

        case 'downloadZip':
            const { zipBlobUrl, videoTitle, totalFrames, videoUrl } = message;
            const fileName = `FrameGrab_${videoTitle}_${totalFrames}frames.zip`;

            // 1. Download
            chrome.downloads.download(
                {
                    url: zipBlobUrl,
                    filename: `Video_FrameGrab/${fileName}`,
                    saveAs: false,
                    conflictAction: 'uniquify'
                },
                (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error('[FrameGrab] Download error:', chrome.runtime.lastError.message);
                    } else {
                        console.log('[FrameGrab] ZIP download started, ID:', downloadId);
                    }
                }
            );

            // 2. Save Session History
            chrome.storage.local.get(['sessionHistory'], (result) => {
                let history = result.sessionHistory || [];
                history.unshift({
                    id: Date.now(),
                    title: videoTitle,
                    url: videoUrl || '',
                    frameCount: totalFrames,
                    date: new Date().toISOString()
                });

                // Keep max 50 recent sessions
                if (history.length > 50) history = history.slice(0, 50);

                chrome.storage.local.set({ sessionHistory: history });
            });

            // Clear badge after stop
            if (tabId) {
                chrome.action.setBadgeText({ text: '', tabId: tabId });
            }

            sendResponse({ success: true });
            return true; // Keep message channel open if needed
    }
});
