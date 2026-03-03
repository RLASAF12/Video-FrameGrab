// ============================================================
// Video FrameGrab — Content Script v2.0
// Features: Auto-capture, Time Range, File Templates,
// On-Screen Toast, Multi-Site support, Contact Sheet.
// ============================================================

(() => {
    'use strict';

    // --- State ---
    let captureInterval = null;
    let intervalMs = 6000;
    let frameIndex = 0;
    let isCapturing = false;
    let autoCapture = false;
    let autoStarted = false;
    let options = {
        startRange: null,
        endRange: null,
        fileNameTemplate: '{title}_{time}_{index}',
        includeContactSheet: true
    };
    let capturedFrames = []; // Array of { name, dataUrl, time }

    // --- Toast Overlay UI ---
    let toastEl = null;
    function initToast() {
        if (toastEl) return;
        toastEl = document.createElement('div');
        toastEl.id = 'ytfg-toast';
        toastEl.innerHTML = `
      <div class="ytfg-dot"></div>
      <div>Capturing... <span class="ytfg-counter" id="ytfg-counter">0</span> frames</div>
    `;
        document.body.appendChild(toastEl);
    }

    function updateToast(count) {
        if (!toastEl) initToast();
        toastEl.classList.add('ytfg-active');
        const counterEl = document.getElementById('ytfg-counter');
        if (counterEl) counterEl.textContent = count;
    }

    function hideToast() {
        if (toastEl) {
            toastEl.classList.remove('ytfg-active');
        }
    }

    // --- Video Discovery (Multi-Site) ---
    function getVideoElement() {
        // 1. YouTube specific
        const ytVideo = document.querySelector('video.html5-main-video') || document.querySelector('ytd-player video');
        if (ytVideo) return ytVideo;

        // 2. Vimeo specific
        const vimeoVideo = document.querySelector('div.vp-video-wrapper video');
        if (vimeoVideo) return vimeoVideo;

        // 3. Generic fallback (largest video by area or just the first video)
        const videos = Array.from(document.querySelectorAll('video'));
        if (videos.length === 0) return null;

        // Pick the largest visible video
        let maxArea = 0;
        let bestVideo = videos[0];
        for (const v of videos) {
            const rect = v.getBoundingClientRect();
            const area = rect.width * rect.height;
            if (area > maxArea && !v.paused) {
                maxArea = area;
                bestVideo = v;
            }
        }
        return bestVideo;
    }

    function getVideoTitle() {
        // Try meta title
        const metaTitle = document.querySelector('meta[name="title"], meta[property="og:title"]');
        if (metaTitle && metaTitle.content) return metaTitle.content;

        // YouTube specific
        const ytHeading = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
        if (ytHeading && ytHeading.textContent) return ytHeading.textContent;

        // Vimeo / Generic
        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent) return h1.textContent.trim();

        // Fallback document title
        return document.title.replace(/ - YouTube$/i, '').replace(/ - Vimeo$/i, '').trim() || 'Untitled';
    }

    function sanitize(name) {
        return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .trim() || 'Video';
    }

    function formatTimeTokens(totalSeconds) {
        const total = Math.floor(totalSeconds);
        const hrs = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;

        const mm_ss = `${String(mins).padStart(2, '0')}m_${String(secs).padStart(2, '0')}s`;
        const hh_mm_ss = hrs > 0
            ? `${String(hrs).padStart(2, '0')}h_${mm_ss}`
            : mm_ss;

        return hh_mm_ss;
    }

    function dataUrlToUint8Array(dataUrl) {
        const base64 = dataUrl.split(',')[1];
        const binary = atob(base64);
        const array = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            array[i] = binary.charCodeAt(i);
        }
        return array;
    }

    // --- Filename Formatting ---
    function generateFilename(title, timeSecs, index) {
        let tpl = options.fileNameTemplate || '{title}_{time}_{index}';
        const dateStr = new Date().toISOString().split('T')[0];

        tpl = tpl.replace(/{title}/g, sanitize(title));
        tpl = tpl.replace(/{time}/g, formatTimeTokens(timeSecs));
        tpl = tpl.replace(/{index}/g, String(index).padStart(4, '0'));
        tpl = tpl.replace(/{date}/g, dateStr);

        // Ensure .png extension
        if (!tpl.toLowerCase().endsWith('.png')) {
            tpl += '.png';
        }
        return sanitize(tpl);
    }

    // --- Contact Sheet Generator ---
    async function generateContactSheet(frames) {
        if (frames.length === 0) return null;

        // Thumbnail size
        const THUMB_W = 320;
        const padding = 10;
        const textHeight = 30;

        // Calculate Grid
        const columns = Math.ceil(Math.sqrt(frames.length));
        const rows = Math.ceil(frames.length / columns);

        // Load first image to get aspect ratio
        const img = new Image();
        await new Promise(r => { img.onload = r; img.src = frames[0].dataUrl; });
        const ratio = img.height / img.width;
        const THUMB_H = Math.floor(THUMB_W * ratio);

        const cellW = THUMB_W + padding * 2;
        const cellH = THUMB_H + padding * 2 + textHeight;

        const canvas = document.createElement('canvas');
        canvas.width = columns * cellW;
        canvas.height = rows * cellH;
        const ctx = canvas.getContext('2d');

        // Background
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Font settings
        ctx.fillStyle = '#ffffff';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';

        // Draw all
        for (let i = 0; i < frames.length; i++) {
            const f = frames[i];
            const col = i % columns;
            const row = Math.floor(i / columns);

            const x = col * cellW + padding;
            const y = row * cellH + padding;

            const thumb = new Image();
            await new Promise(r => { thumb.onload = r; thumb.src = f.dataUrl; });

            ctx.drawImage(thumb, x, y, THUMB_W, THUMB_H);

            // Draw time label
            const timeStr = formatTimeTokens(f.time);
            ctx.fillText(timeStr, x + (THUMB_W / 2), y + THUMB_H + 20);
        }

        return canvas.toDataURL('image/png');
    }

    // --- Capture Engine ---
    function captureFrame() {
        const video = getVideoElement();
        if (!video) return;

        if (video.paused || video.ended) return;
        if (video.videoWidth === 0 || video.videoHeight === 0) return;

        // Time Range Check
        if (options.startRange !== null && video.currentTime < options.startRange) return;
        if (options.endRange !== null && video.currentTime > options.endRange) {
            stopCapture(true); // Auto-stop because we passed the end range
            return;
        }

        // Skip ads (YouTube specific)
        const adOverlay = document.querySelector('.ad-showing, .ytp-ad-player-overlay');
        if (adOverlay) return;

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const imageData = canvas.toDataURL('image/png');
        frameIndex++;

        const title = getVideoTitle();
        const fileName = generateFilename(title, video.currentTime, frameIndex);

        capturedFrames.push({
            name: fileName,
            dataUrl: imageData,
            time: video.currentTime
        });

        console.log(`[FrameGrab] Frame ${frameIndex} captured at ${video.currentTime}s`);

        // Update Badge and Toast
        updateToast(frameIndex);
        chrome.runtime.sendMessage({ action: 'updateBadge', text: String(frameIndex) });
    }

    function startCapture(interval) {
        if (isCapturing) return true;

        const video = getVideoElement();
        if (!video) {
            console.warn('[FrameGrab] Cannot start — no video element found.');
            return false;
        }

        // Reload settings from storage
        chrome.storage.local.get(['captureInterval', 'startRange', 'endRange', 'fileNameTemplate', 'includeContactSheet'], (res) => {
            intervalMs = (res.captureInterval || 6) * 1000;
            options.startRange = (res.startRange && res.startRange.toString().trim() !== '') ? timeToSeconds(res.startRange) : null;
            options.endRange = (res.endRange && res.endRange.toString().trim() !== '') ? timeToSeconds(res.endRange) : null;
            options.fileNameTemplate = res.fileNameTemplate || '{title}_{time}_{index}';
            options.includeContactSheet = res.includeContactSheet !== false; // default true

            frameIndex = 0;
            capturedFrames = [];
            isCapturing = true;

            captureFrame(); // Capture first immediately
            captureInterval = setInterval(captureFrame, intervalMs);

            initToast();
            updateToast(0);
        });

        return true;
    }

    // Parse "MM:SS" or "HH:MM:SS" into seconds
    function timeToSeconds(str) {
        if (!str) return null;
        const parts = str.split(':').map(Number);
        if (parts.length === 2) return parts[0] * 60 + parts[1]; // MM:SS
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS
        if (parts.length === 1) return parts[0]; // Just seconds
        return null;
    }

    async function stopCapture(autoInitiated = false) {
        if (captureInterval) {
            clearInterval(captureInterval);
            captureInterval = null;
        }
        const totalFrames = frameIndex;
        isCapturing = false;
        autoStarted = false;
        hideToast();

        if (capturedFrames.length === 0) {
            frameIndex = 0;
            return { totalFrames: 0, zipReady: false };
        }

        const title = getVideoTitle();

        // Check if Contact Sheet is requested
        if (options.includeContactSheet) {
            try {
                const csDataUrl = await generateContactSheet(capturedFrames);
                if (csDataUrl) {
                    capturedFrames.push({
                        name: '_ContactSheet.png',
                        dataUrl: csDataUrl,
                        time: 0
                    });
                }
            } catch (e) {
                console.error('[FrameGrab] Failed to make contact sheet', e);
            }
        }

        // Build ZIP using MiniZip
        const files = capturedFrames.map(f => ({
            name: f.name,
            data: dataUrlToUint8Array(f.dataUrl)
        }));

        const zipBlob = MiniZip.createZip(files);
        const zipBlobUrl = URL.createObjectURL(zipBlob);

        capturedFrames = [];
        frameIndex = 0;

        // Send the ZIP to background to download (if auto-stopped, tell background directly)
        const downloadMsg = {
            action: 'downloadZip',
            zipBlobUrl: zipBlobUrl,
            videoTitle: sanitize(title),
            totalFrames: totalFrames,
            videoUrl: window.location.href
        };

        if (autoInitiated) {
            chrome.runtime.sendMessage(downloadMsg);
        }

        return { totalFrames, zipReady: true, zipBlobUrl, downloadMsg };
    }

    // --- Auto-capture logic ---
    function setupAutoCapture() {
        const observer = new MutationObserver(() => {
            const video = getVideoElement();
            if (video && !video._ytfgListenerAttached) {
                video._ytfgListenerAttached = true;
                video.addEventListener('playing', () => {
                    if (autoCapture && !isCapturing && !autoStarted) {
                        autoStarted = true;
                        chrome.storage.local.get(['captureInterval'], (result) => {
                            const interval = result.captureInterval || 6;
                            startCapture(interval);
                        });
                    }
                });
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

        const video = getVideoElement();
        if (video && !video._ytfgListenerAttached) {
            video._ytfgListenerAttached = true;
            video.addEventListener('playing', () => {
                if (autoCapture && !isCapturing && !autoStarted) {
                    autoStarted = true;
                    chrome.storage.local.get(['captureInterval'], (result) => {
                        const interval = result.captureInterval || 6;
                        startCapture(interval);
                    });
                }
            });
        }
    }

    chrome.storage.local.get(['autoCapture'], (result) => {
        autoCapture = !!result.autoCapture;
        if (autoCapture) setupAutoCapture();
    });

    chrome.storage.onChanged.addListener((changes) => {
        if (changes.autoCapture) {
            autoCapture = !!changes.autoCapture.newValue;
            if (autoCapture) setupAutoCapture();
            else autoStarted = false;
        }
    });

    // --- External Messaging ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
            case 'startCapture': {
                const success = startCapture(message.interval);
                sendResponse({ success, isCapturing: true });
                break;
            }

            case 'stopCapture': {
                stopCapture().then(result => {
                    if (result.zipReady) {
                        chrome.runtime.sendMessage(result.downloadMsg);
                    }
                    sendResponse({
                        success: true,
                        isCapturing: false,
                        totalFrames: result.totalFrames
                    });
                });
                return true; // async response
            }

            case 'getStatus': {
                sendResponse({
                    isCapturing,
                    frameIndex,
                    hasVideo: !!getVideoElement()
                });
                break;
            }
        }
        return false;
    });

})();
