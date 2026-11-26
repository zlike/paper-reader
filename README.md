# Paper Reader

A phone-friendly PDF library and citation finder. PDFs and a SQLite index are stored in a Docker volume on the device running the container. Citation searches query [OpenAlex](https://openalex.org/), [arXiv](https://arxiv.org/), [Crossref](https://www.crossref.org/), and [DBLP](https://dblp.org/); only PDF locations identified as open access are downloaded. The service needs internet access for citation searches and downloads.

## Run on your phone

The phone must already run Docker and Docker Compose. The image is built from the official Node image for the phone's architecture (including ARM64); no particular architecture is assumed. Copy this folder to the phone, then run in that folder:

```sh
docker compose up -d --build
```

By default the port is bound only to the phone's loopback interface. On the phone, open `http://127.0.0.1:3000`. To allow other devices on your trusted LAN, create a `.env` file next to `compose.yaml`:

```dotenv
BIND_ADDRESS=0.0.0.0
HOST_PORT=3000
MAX_PDF_MB=50
MAX_STORAGE_MB=1024
# Optional: free OpenAlex API key for higher daily search quotas
# (get one at https://help.openalex.org/api/authentication/)
# OPENALEX_API_KEY=
```

Run `docker compose up -d` again, then visit `http://PHONE_LAN_IP:3000` from another device. Choose a different `HOST_PORT` if needed. Do not expose this service to the public internet: **there is no login, encryption, or user isolation**. Anyone who can reach it can read and add papers and trigger downloads. Use only a trusted network; firewall the port where appropriate.

The `papers` named volume persists across container recreation and image rebuilds. `docker compose down` keeps the volume; `docker compose down -v` **deletes the library**. Back up the entire volume, including `library.sqlite`, any SQLite WAL files, and `papers/`; stop the container before copying it for a consistent backup. Disk usage includes SQLite, temporary downloads and filesystem overhead in addition to the configured library limit. Ensure the phone has free disk space. `MAX_PDF_MB` and `MAX_STORAGE_MB` are positive whole numbers; storage quota counts saved PDF bytes, not temporary files or database overhead. Keep one app container per volume.

## Use

Tap **Add PDF** to search for a paper by title or DOI, then choose the correct result to download its open-access PDF. Select a saved title in the library to read it. The library closes when you open a paper; use the menu button to show or hide it, and the plus and minus buttons to zoom. Select text in the PDF, tap **Find cited paper**, and check or edit the selected text. An exact DOI match with an open-access PDF is downloaded automatically; otherwise choose a candidate. Once downloaded, use **Open paper** to read it immediately. Searches send the entered text to OpenAlex. A numbered citation such as `[12]` does not identify a paper by itself: select its full bibliography entry or title instead. Scanned PDFs without a text layer cannot be selected; OCR is not included.

PDF links can jump to another location in the paper. HTTP and HTTPS links open in a new tab, and email links open your email application. Other external link schemes are not opened.

Results depend on OpenAlex's coverage and its open-access PDF links. A match may be ambiguous, unavailable, blocked by the source, or not actually a PDF; the app reports these cases rather than downloading a paywalled copy. PDFs are checked for a PDF signature, not scanned for malware. For untrusted documents, keep your browser and device up to date.

## Development

Install Node.js 24 and run `npm ci`. Use `npm run build` to build the React web UI into `dist/` before `npm start`, or run the backend (`npm start`) alongside `npm run dev` (Vite dev server with `/api` and `/vendor` proxying). Run `npm test` for backend and unit tests, `npm run test:coverage` for unit coverage, and `npm run test:e2e` for Playwright end-to-end tests. The default local data directory is `./data`; set `DATA_DIR`, `HOST`, or `PORT` to change it. Docker sets `HOST=0.0.0.0` inside the container while Compose controls the host bind address.
