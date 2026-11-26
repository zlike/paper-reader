# Paper Reader

A self-hosted, touch-first Progressive Web App (PWA) for reading research papers, tracking reading progress, previewing internal citation links in place, and discovering and downloading cited open-access papers in one tap.

## Features

### Touch-First PWA PDF Reader
- **Installable web app**: Add Paper Reader to your home screen on iPad, iPhone, or Android for a standalone, full-screen reading experience.
- **PDF-only pinch-to-zoom & pan**: Smooth touch pinch-zoom and panning (plus toolbar zoom controls) that scale the PDF content without zooming the app chrome.
- **Non-resizing overlay library drawer**: Slide open or swipe closed the library drawer without reflowing or shifting the current page.
- **Safe link handling**: Internal PDF links open in an in-place preview modal, HTTP/HTTPS links open in a new tab, `mailto:` links open your mail app, and unsupported link schemes are blocked.

### Automatic Reading Progress & Resume
- **Hybrid SQLite + `localStorage` sync**: Continuously saves your reading position so progress persists across page reloads and devices on your network.
- **Auto-resume where you left off**: Automatically reopens your last-read paper at your exact scroll position.
- **Unread / Read library organization**: Automatically separates papers into **Unread** and **Read** sections with human-readable timestamps.

### In-Place Citation Link Preview
- **Preview references without losing your place**: Tap an internal PDF citation link to view the target bibliography entry in a modal—including entries that wrap across page breaks—while keeping your main reading position intact.
- **Column-aware target highlighting**: Automatically detects and highlights the cited reference title inside single- or multi-column layouts, with a **Jump to page** option when you want to navigate there directly.

### One-Tap Cited Paper Discovery & Federated Search
- **Find cited papers from anywhere**: Search by title, DOI, arXiv ID, or bibliography entry via **+ Add PDF**, by selecting text in a PDF, or directly from a highlighted citation preview (**Find selected paper**).
- **Add PDFs by URL with built-in safety scanning**: Paste any public `https://` PDF link in **+ Add PDF → From URL** (with an optional custom title). Every ingested PDF is scanned before saving to block polyglot headers, encrypted PDFs, embedded JavaScript, active launch/media/form/auto-trigger actions, and malformed documents.
- **Multi-engine federated search**: Queries [OpenAlex](https://openalex.org/), [arXiv](https://arxiv.org/), and [Crossref](https://www.crossref.org/) simultaneously with live per-provider status indicators and match counts.
- **Word-aware PDF line-wrap dehyphenation**: Automatically repairs hyphenated words split across PDF line or column breaks while preserving true compound hyphens for more accurate search queries.
- **Open-access downloads & duplicate prevention**: Downloads verified open-access PDFs (auto-downloading confident matches when available) and detects papers already in your library so you can open them immediately instead of downloading duplicates.

### Simple Local-Network Self-Hosting
- **Zero-auth personal deployment**: Runs as a single self-hosted container with persistent PDF storage and a SQLite index—no accounts or login setup required on a trusted home or local network.

## Quick Start

Run with Docker Compose and open `http://127.0.0.1:3000`:

```sh
docker compose up -d --build
```

> **Note:** Paper Reader requires internet access for citation searches and open-access PDF downloads, does not include OCR for scanned PDFs without a text layer, and has no built-in authentication—use it only on a trusted local network.

## Deployment & Development

For LAN setup, `.env` configuration (`OPENALEX_API_KEY`, storage limits), backups, security notes, local Node.js 24 development, tests, and accuracy benchmarks, see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).
