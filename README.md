# Garage Logbook

Garage Logbook tracks your vehicle's service history from an elegantly simple, self-hosted web interface. It has image and document upload support (think pictures of repairs or receipt PDFs), role-based authentication, CSV import and export for existing maintenance records, and a performant dark-mode interface running in a Docker container for easy deployment.

Built and maintained by [Hyprlab](https://hyprlab.co)

---

## Features

- **Multi-User Support**: Each user has their own garage with isolated vehicles and maintenance records
- **Vehicle Management**: Add, edit, and delete vehicles with year, make, model, VIN, purchase date, and photo
- **Maintenance Records**: Log repairs, maintenance, upgrades, and inspections with date, mileage, vendor, cost, notes, and photo galleries
- **PDF Receipts**: Upload PDF documents (receipts, invoices, estimates) to any maintenance record
- **Service Reminders**: Set an interval per vehicle and see what is due, due soon, or overdue. A toggle picks what each counter counts down: mileage ("transmission fluid every 30,000 miles") or time ("brake fluid every 24 months"). Reminders anchor to your service records, so logging the work rolls the next due point forward automatically, and when adding a record you can tick which counters to restart from its mileage or date
- **Dashboard**: At-a-glance stats for total vehicles, service records, money spent, and service due, with configurable time ranges and an upcoming-service list across all vehicles
- **Search & Sort**: Live search across vehicles and maintenance records with multiple sort options
- **CSV Import & Export**: Import maintenance records from CSV files with field mapping and dry-run preview, or export all records for any vehicle
- **PDF Export**: Export a vehicle's whole history as one printable PDF, or selected records as one PDF each (several arrive together in a zip file), with notes, photos, and the record's receipts attached to the file
- **Duplicate Records**: Quickly duplicate an existing maintenance record as a starting point
- **Role-Based Access**: Two user roles with enforced permissions:
  - **Admin**: Full access to all users' data, user management, and all features
  - **Editor**: Configurable per-user permissions (see below)
- **Granular Permissions**: Admins can toggle individual capabilities for each editor:
  - Add / Edit / Delete vehicles
  - Add / Edit / Delete maintenance records
  - Import CSV / Export records (CSV and PDF)
- **First-Login Security**: Default admin account is forced to change password on first login
- **Image Gallery**: Upload multiple photos per maintenance record with a lightbox viewer
- **Light & Dark Theme**: Light, dark, or follow the system, from Settings or the sidebar, saved per-user
- **Per-User Settings**: Each user can customize their dashboard preferences and theme
- **Mobile Responsive**: Works on desktop, tablet, and mobile
- **Docker Ready**: Ships as a Docker image with persistent volume storage

---

## Requirements

- Docker and Docker Compose

That's it. Everything else is handled by the container.

---

## Quick Start

### 1. Create a project directory

```bash
mkdir ~/garage-logbook && cd ~/garage-logbook
```

### 2. Download the compose file and environment template

```bash
curl -O https://raw.githubusercontent.com/hyprlab/garage-logbook/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/hyprlab/garage-logbook/main/.env.example
```

Or create the files manually:

<details>
<summary><strong>docker-compose.yml</strong></summary>

```yaml
services:
  garage-logbook:
    image: hyprlab/garage-logbook:${IMAGE_TAG:-latest}
    container_name: garage-logbook
    restart: unless-stopped
    ports:
      - "${APP_PORT:-5000}:5000"
    volumes:
      - garage-data:/data
    env_file:
      - .env
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:5000/login')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

volumes:
  garage-data:
    driver: local
```

</details>

<details>
<summary><strong>.env.example</strong></summary>

```bash
# Garage Logbook environment configuration
# Copy this file to .env and update the values below.
#
#   cp .env.example .env
#

# ─── REQUIRED ──────────────────────────────────────────
# Session encryption key. Generate one with:
#   python3 -c "import secrets; print(secrets.token_hex(32))"
# or:
#   openssl rand -hex 32
SECRET_KEY=CHANGE-ME-replace-with-a-random-string

# ─── OPTIONAL ──────────────────────────────────────────
# Port the app is accessible on (default: 5000)
APP_PORT=5000

# Database path inside the container (typically no need to change)
DATABASE_PATH=/data/garage_logbook.db

# Upload folder inside the container (typically no need to change)
UPLOAD_FOLDER=/data/uploads
```

</details>

### 3. Create your environment file

```bash
cp .env.example .env
```

### 4. Generate a secret key and update the .env file

Generate a key:

```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Open `.env` in your editor and replace the `SECRET_KEY` placeholder with the generated value:

```
SECRET_KEY=your-generated-key-here
```

You can also change the port here if `5000` is already in use:

```
APP_PORT=8080
```

### 5. Start the application

```bash
docker compose up -d
```

### 6. Log in

Open your browser to `http://localhost:5000` (or whatever port you configured).

| | |
|---|---|
| **Username** | `admin` |
| **Password** | `admin` |

You will be prompted to set a new password on first login.

---

## Updating

When a new version is released:

```bash
docker compose pull
docker compose up -d
```

Your data is stored in a Docker volume and is not affected by updates. Your `.env` file remains untouched.

### Release channels

`IMAGE_TAG` in `.env` picks which releases you get:

- `latest` (the default): stable releases.
- `beta`: previews of the next stable, published more often and tested less.
- A version such as `0.4.0`: stay on that release until you change it.

After changing it, run `docker compose pull && docker compose up -d`.

---

## Configuration

All configuration is managed through the `.env` file. The `.env.example` file documents every available option.

| Variable | Required | Description | Default |
|---|---|---|---|
| `SECRET_KEY` | **Yes** | Flask session encryption key | None |
| `APP_PORT` | No | Port the app is accessible on | `5000` |
| `IMAGE_TAG` | No | Release channel or version to run: `latest`, `beta` or a version | `latest` |
| `DATABASE_PATH` | No | Database path inside the container | `/data/garage_logbook.db` |
| `UPLOAD_FOLDER` | No | Upload path inside the container | `/data/uploads` |

> **Note:** The `.env` file contains your secret key and should not be committed to version control or shared publicly.

### Running behind a reverse proxy

If you're running behind Nginx, Caddy, Nginx Proxy Manager, or similar, point the proxy to the port specified in `APP_PORT` (default `5000`). No additional configuration is needed in the app itself.

---

## Multi-User Support

Each user has their own isolated garage. Vehicles and maintenance records created by one user are not visible to other users.

**Admin users** can see all vehicles and records across every user, with owner labels displayed on each car card. This makes it easy to manage a shared instance where multiple household members or team members each track their own vehicles.

To create additional users, go to **Settings → Users → Add User** (admin only).

---

## User Roles & Permissions

Garage Logbook uses two roles. The viewer role has been removed in favor of granular permission toggles on the editor role.

### Admin

Full, unrestricted access to everything: all vehicles and records across all users, user management, import, export, and all CRUD operations.

### Editor

Access is limited to the user's own vehicles and records. Admins can configure exactly what each editor is allowed to do by toggling individual permissions:

| Permission | Default | Description |
|---|---|---|
| Add vehicles | ✓ | Create new vehicles |
| Edit vehicles | ✓ | Modify existing vehicles |
| Delete vehicles | ✓ | Remove vehicles and all associated records |
| Add records | ✓ | Create maintenance records |
| Edit records | ✓ | Modify existing records |
| Delete records | ✓ | Remove maintenance records |
| Import CSV | Off | Import records from CSV files |
| Export records | ✓ | Export records to CSV and PDF files |

Permissions are configured per-user from **Settings → Users → Edit**.

---

## Backup & Restore

### Backup

```bash
docker compose stop
docker run --rm \
  -v garage-logbook_garage-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/garage-logbook-backup.tar.gz -C /data .
docker compose up -d
```

This creates `garage-logbook-backup.tar.gz` in your current directory containing the database and all uploaded images and documents.

### Restore

```bash
docker compose stop
docker run --rm \
  -v garage-logbook_garage-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "rm -rf /data/* && tar xzf /backup/garage-logbook-backup.tar.gz -C /data"
docker compose up -d
```

---

## Building from Source

If you prefer to build the Docker image yourself rather than pulling from Docker Hub:

```bash
git clone https://github.com/hyprlab/garage-logbook.git
cd garage-logbook
cp .env.example .env
# Edit .env and set your SECRET_KEY
```

Create a `docker-compose.override.yml` alongside it. Compose merges this file automatically, so you get a local build without editing the tracked `docker-compose.yml`:

```yaml
services:
  garage-logbook:
    build: .
    image: garage-logbook-dev:latest
```

The separate `image:` tag keeps your local build from overwriting the published `hyprlab/garage-logbook:latest` in your image cache. This file is gitignored, so your local setup never ends up in a commit.

```bash
docker compose up -d --build
```

### Running without Docker

Garage Logbook can also run directly on a Linux system with Python 3.10+:

```bash
git clone https://github.com/hyprlab/garage-logbook.git
cd garage-logbook
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

export SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
python app.py
```

The app will be available at `http://localhost:5000`. The database and uploads will be stored in the project directory.

---

## Project Structure

```
garage-logbook/
├── app.py                    # Flask application
├── requirements.txt          # Python dependencies
├── Dockerfile                # Container build instructions
├── docker-compose.yml        # Compose configuration (pulls the published image)
├── .env.example              # Environment variable template
├── CONTRIBUTING.md           # Commit, versioning and release conventions
├── tools/                    # Release scripts and git hooks (see CONTRIBUTING.md)
├── static/
│   ├── css/style.css         # Stylesheet (dark + light themes)
│   ├── js/app.js             # Frontend JavaScript
│   ├── garage-logbook_logo.svg
│   ├── hyprlab_logo.png
│   └── favicon.png
└── templates/
    ├── index.html            # Main application template
    └── login.html            # Login page
```

---

## AI notice

Garage Logbook is built by a human maintainer working with generative AI as a development tool:

- **Code**: the large majority of the Python, JavaScript, and CSS in this repository was written with Anthropic's Claude (via Claude Code), working from the maintainer's direction. The maintainer decides what gets built, reviews the results, tests every release, and signs off on everything that ships.
- **Text**: documentation, release notes, and in-app copy are largely AI-drafted and human-edited.
- **The app itself contains no AI.** Garage Logbook has no AI features and makes no requests to AI services. Your vehicle records stay in your own database. AI was used to *build* the app, not to run it.

Bug reports and pull requests are welcome from humans and their AI tools alike; everything merged gets the same human review. See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions.

## License

Garage Logbook is free software, licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**. You are free to use, study, share, and modify it under the terms of that license. Because the AGPL covers network use, if you run a modified version of Garage Logbook as a service accessible over a network, you must also make the corresponding source code available to its users.

See the [LICENSE](LICENSE) file for the full text.

---

## About

Garage Logbook is developed by [Hyprlab](https://hyprlab.co)

Current version: **1.0.0**
