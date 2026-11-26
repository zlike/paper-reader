# Deployment & Development

This guide covers deploying Paper Reader with Docker Compose, configuring environment variables, managing storage and backups, and developing or testing locally.

## Docker Compose deployment

Paper Reader builds from the official Node.js 24 image (`node:24-bookworm-slim`) for the host's architecture (including ARM64 and x86_64). On a phone, Raspberry Pi, or server with Docker and Docker Compose installed, run:

```sh
docker compose up -d --build
```

By default, the service binds only to the host's loopback interface (`127.0.0.1:3000`). Open `http://127.0.0.1:3000` on the device running the container.

### Accessing from your local network (LAN)

To allow other devices on your trusted LAN to access Paper Reader, create a `.env` file next to `compose.yaml`:

```dotenv
BIND_ADDRESS=0.0.0.0
HOST_PORT=3000
MAX_PDF_MB=50
MAX_STORAGE_MB=1024
# Optional: free OpenAlex API key for higher daily search quotas
# (get one at https://help.openalex.org/api/authentication/)
# OPENALEX_API_KEY=
```

Restart the service with `docker compose up -d`, then visit `http://<HOST_LAN_IP>:3000` from another device. Choose a different `HOST_PORT` if port `3000` is already in use.

## Environment variables

| Variable | Default | Scope | Description |
| --- | --- | --- | --- |
| `BIND_ADDRESS` | `127.0.0.1` | Docker Compose | Host network interface to bind the published port to (`0.0.0.0` for LAN access). |
| `HOST_PORT` | `3000` | Docker Compose | Host port mapped to container port `3000`. |
| `MAX_PDF_MB` | `50` | App / Compose | Maximum size of a single PDF in MiB (positive whole number). |
| `MAX_STORAGE_MB` | `1024` | App / Compose | Maximum total saved PDF storage in MiB (positive whole number). |
| `OPENALEX_API_KEY` | *(empty)* | App / Compose | Optional free [OpenAlex API key](https://help.openalex.org/api/authentication/) for higher daily search quotas. |
| `DATA_DIR` | `./data` (`/data` in Docker) | Local dev / App | Directory for `library.sqlite` and saved PDF files. |
| `HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Local dev / App | Bind address inside the Node.js server process. |
| `PORT` | `3000` | Local dev / App | Listening port inside the Node.js server process. |

`MAX_PDF_MB` and `MAX_STORAGE_MB` must be positive whole numbers. The storage quota counts saved PDF bytes only—not temporary downloads, SQLite files, or filesystem overhead.

## Storage and backups

- The `papers` named Docker volume persists across container recreations and image rebuilds.
- `docker compose down` keeps the volume; `docker compose down -v` **deletes the entire library**.
- To back up your library consistently, stop the container first, then copy the entire volume contents—including `library.sqlite`, any SQLite WAL files (`library.sqlite-wal`, `library.sqlite-shm`), and the `papers/` directory.
- Run only one app container per volume.
- Ensure the host has free disk space beyond `MAX_STORAGE_MB` to accommodate SQLite, temporary downloads, and filesystem overhead.

## Security and operational notes

- **Trusted networks only**: Do not expose Paper Reader to the public internet. **There is no login, encryption, or user isolation**—anyone who can reach the service can read and add papers and trigger downloads. Use only on a trusted LAN and firewall the port where appropriate.
- **Internet access & open-access sources**: Citation searches and PDF downloads require outbound internet access and query [OpenAlex](https://openalex.org/), [arXiv](https://arxiv.org/), and [Crossref](https://www.crossref.org/). Only PDF locations identified as open access are downloaded; ambiguous, unavailable, blocked, or non-PDF responses are reported rather than downloading paywalled copies.
- **PDF validation & OCR**: Downloaded and uploaded files are checked for a PDF signature, not scanned for malware—keep your browser and device up to date when opening untrusted documents. Scanned PDFs without a text layer cannot be selected; OCR is not included.

## Local development

Requires **Node.js 24** or newer (`engines.node: >=24`).

```sh
npm ci
```

- **Production build + server**: Run `npm run build` to build the React web UI into `dist/`, then start the Express server with `npm start`.
- **Live dev mode**: Run the backend (`npm start`) alongside the Vite dev server (`npm run dev`), which proxies `/api` and `/vendor` to the backend.
- **Local data directory**: Defaults to `./data`. Override with `DATA_DIR`, `HOST`, or `PORT`. Docker sets `HOST=0.0.0.0` inside the container while Compose controls the host bind address via `BIND_ADDRESS`.

## Tests and benchmarks

| Command | Description |
| --- | --- |
| `npm test` | Run backend tests (`npm run test:backend`) and frontend unit tests (`npm run test:unit`). |
| `npm run test:backend` | Run Node.js backend tests (`node --test test/*.test.js`). |
| `npm run test:unit` | Run Vitest unit and component tests (`vitest run`). |
| `npm run test:coverage` | Run Vitest unit tests with V8 coverage reporting. |
| `npm run test:e2e` | Run Playwright end-to-end tests (`playwright test`). |
| `npm run benchmark:dehyphenation` | Evaluate word-aware PDF line-wrap dehyphenation accuracy against real-paper test cases. |
| `npm run benchmark:highlight` | Opt-in benchmark that fetches/caches real academic PDFs into `os.tmpdir()` and verifies citation link-preview highlighting accuracy. |
| `npm run benchmark:search` | Real-API benchmark evaluating federated search accuracy across OpenAlex, arXiv, and Crossref. |
