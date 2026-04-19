# Video Tools

A native macOS app for merging videos and creating 1-hour loops. All processing runs locally using FFmpeg — no uploads, no cloud.

## Features

**Merge** — Combine multiple video files into a single MP4. Videos without audio automatically get a silent audio track so playback is consistent.

**1-Hour Loop** — Take any video and repeat it until it's at least one hour long. Uses a fast two-pass approach: encodes the source clip once, then stitches copies without re-encoding, so a 30-second clip loops in seconds rather than minutes.

**Output format** — All exports are H.264 MP4, 1080p, 30fps, ≤2000kbps, AAC stereo audio. Compatible with Samsung, LG, Sony, and other smart TVs via USB.

## Download

Download the latest release: [`Video Tools-1.0.0-arm64.dmg`](dist/Video%20Tools-1.0.0-arm64.dmg)

Requires macOS 10.12 or later. Runs natively on Apple Silicon; works on Intel Macs via Rosetta 2.

## Development

**Prerequisites:** Node.js, npm

```bash
npm install
npm start
```

**Build a notarized DMG:**

```bash
export APPLE_ID="your@email.com"
export APPLE_TEAM_ID="XXXXXXXXXX"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
npm run build
```
