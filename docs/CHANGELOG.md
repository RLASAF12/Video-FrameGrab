# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - Initial Public Release
### Added
- **Multi-Site Support**: Now works on YouTube, Vimeo, Twitch, and generic `<video>` elements.
- **Badge Counter**: Live frame count on the extension icon.
- **Progress Toast**: Non-intrusive floating overlay on the video page.
- **Time Range Capture**: Specify start and end timestamps.
- **Contact Sheet Generator**: Automatically generates an image grid inside the ZIP.
- **Session History**: Track past captures from the popup UI.
- **Filename Templates**: Customize exported file names using tokens like `{title}`, `{time}`.
- **In-Memory ZIP Compilation**: All frames are kept in memory and delivered as a single ZIP file to eliminate save-dialog fatigue.
