# Garage Logbook - self-hosted vehicle maintenance tracker
# Copyright (C) 2026 Hyprlab
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import os, uuid, sqlite3, hashlib, secrets, csv, io, json, re, calendar, unicodedata, zipfile
from urllib.parse import urlsplit
from datetime import date
try:
    import fcntl
except ImportError:  # non-POSIX; single-process only
    fcntl = None
from functools import wraps
from flask import (Flask, render_template, request, jsonify,
                   redirect, url_for, session, g, Response, send_from_directory,
                   has_request_context)

APP_VERSION = '1.1.0'

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'change-this-to-a-random-secret-key-in-production')
app.config['UPLOAD_FOLDER'] = os.environ.get('UPLOAD_FOLDER', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'static', 'uploads'))
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024

ALLOWED_EXTENSIONS = {'png','jpg','jpeg','gif','webp','heic','heif','pdf'}
# Photos most browsers cannot show, saved as JPEG instead.
CONVERT_TO_JPEG = {'heic','heif'}
ROLES = {'admin','editor'}
DATABASE = os.environ.get('DATABASE_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'garage_logbook.db'))

# Default editor permissions
DEFAULT_PERMS = {'can_add_cars':True,'can_edit_cars':True,'can_delete_cars':True,
                 'can_add_records':True,'can_edit_records':True,'can_delete_records':True,
                 'can_import':False,'can_export':True}

def allowed_file(fn):
    return '.' in fn and fn.rsplit('.',1)[1].lower() in ALLOWED_EXTENSIONS

def hash_password(pw, salt=None):
    if not salt: salt = secrets.token_hex(16)
    return f"{salt}${hashlib.pbkdf2_hmac('sha256', pw.encode(), salt.encode(), 260000).hex()}"

def verify_password(pw, stored):
    return hash_password(pw, stored.split('$',1)[0]) == stored

def get_db():
    conn = sqlite3.connect(DATABASE, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    # Track the connection so teardown_request can roll back and close it even if
    # the view raises before reaching its own conn.close(). Without this, a failed
    # write leaves an open transaction pinned by the logged traceback, and every
    # later write fails with "database is locked" until the worker recycles.
    if has_request_context():
        if '_db_conns' not in g: g._db_conns = []
        g._db_conns.append(conn)
    return conn

def init_db():
    """Serialized across worker processes: gunicorn imports this module once per
    worker, so without a lock all of them run the migrations concurrently and can
    interleave the table-rebuild steps."""
    lock_path = DATABASE + '.init.lock'
    try:
        os.makedirs(os.path.dirname(os.path.abspath(lock_path)), exist_ok=True)
    except Exception:
        pass
    if fcntl is None:
        return _init_db()
    with open(lock_path, 'w') as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            return _init_db()
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)

def _init_db():
    conn = get_db()
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password TEXT NOT NULL, display_name TEXT,
            role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin','editor')),
            permissions TEXT NOT NULL DEFAULT '{}',
            must_change_password INTEGER NOT NULL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS cars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            year INTEGER NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL,
            vin TEXT, image TEXT, purchase_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS maintenance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            car_id INTEGER NOT NULL, title TEXT NOT NULL,
            maintenance_type TEXT NOT NULL CHECK(maintenance_type IN ('Repair','Maintenance','Upgrade','Inspection')),
            service_date TEXT NOT NULL, odometer INTEGER,
            parts_vendor TEXT, cost REAL, notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS maintenance_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_id INTEGER NOT NULL, filename TEXT NOT NULL,
            original_name TEXT, file_type TEXT NOT NULL DEFAULT 'image',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS maintenance_parts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
            name TEXT NOT NULL, vendor TEXT, cost REAL,
            FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_parts_maintenance ON maintenance_parts(maintenance_id);
        CREATE TABLE IF NOT EXISTS maintenance_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
            url TEXT NOT NULL, label TEXT,
            FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_links_maintenance ON maintenance_links(maintenance_id);
        CREATE TABLE IF NOT EXISTS service_reminders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            car_id INTEGER NOT NULL, title TEXT NOT NULL,
            interval_type TEXT NOT NULL DEFAULT 'miles',
            interval_miles INTEGER NOT NULL DEFAULT 0,
            interval_months INTEGER,
            last_done_odometer INTEGER, last_done_date TEXT, notes TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reminder_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reminder_id INTEGER NOT NULL, position INTEGER NOT NULL DEFAULT 0,
            url TEXT NOT NULL, label TEXT,
            FOREIGN KEY (reminder_id) REFERENCES service_reminders(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_links_reminder ON reminder_links(reminder_id);
        CREATE TABLE IF NOT EXISTS vendors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL, match_key TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE (user_id, match_key),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id INTEGER PRIMARY KEY,
            settings TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    ''')
    if conn.execute('SELECT COUNT(*) as c FROM users').fetchone()['c'] == 0:
        # OR IGNORE: gunicorn runs several workers, each importing this module.
        # Without it the losers of the race crash on the UNIQUE username.
        cur = conn.execute('INSERT OR IGNORE INTO users (username,password,display_name,role,permissions,must_change_password) VALUES (?,?,?,?,?,?)',
                     ('admin', hash_password('admin'), 'Administrator', 'admin', '{}', 1))
        if cur.rowcount:
            print("\n  Default admin: admin / admin — change immediately!\n")
    conn.commit()
    # Migrations
    try:
        cols = [r['name'] for r in conn.execute("PRAGMA table_info(users)").fetchall()]
        if 'must_change_password' not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0")
        if 'permissions' not in cols:
            conn.execute("ALTER TABLE users ADD COLUMN permissions TEXT NOT NULL DEFAULT '{}'")
        conn.commit()
    except Exception as e:
        print(f"Migration users columns: {e}")
    # Migration: add user_id to cars if missing
    try:
        cols = [r['name'] for r in conn.execute("PRAGMA table_info(cars)").fetchall()]
        if 'user_id' not in cols:
            admin = conn.execute("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1").fetchone()
            admin_id = int(admin['id']) if admin else 1
            conn.execute(f"ALTER TABLE cars ADD COLUMN user_id INTEGER NOT NULL DEFAULT {admin_id}")
            conn.commit()
    except Exception as e:
        print(f"Migration user_id: {e}")
    # Migration: update viewer role to editor
    try:
        conn.execute("UPDATE users SET role='editor' WHERE role='viewer'")
        conn.commit()
    except Exception as e:
        print(f"Migration viewer->editor: {e}")
    # Migration: add file_type to maintenance_images
    try:
        cols = [r['name'] for r in conn.execute("PRAGMA table_info(maintenance_images)").fetchall()]
        if 'file_type' not in cols:
            conn.execute("ALTER TABLE maintenance_images ADD COLUMN file_type TEXT NOT NULL DEFAULT 'image'")
            conn.commit()
    except Exception as e:
        print(f"Migration file_type: {e}")
    # Migration: repair maintenance_images FK left dangling by the pre-0.2.x
    # Inspection-CHECK migration. That version renamed `maintenance` to a temp
    # table without disabling foreign keys first; SQLite >=3.25 rewrites
    # REFERENCES clauses in other tables to follow a rename, so this table ended
    # up pointing at the temp table, which was then dropped. Result: every insert
    # here fails with "no such table: main._maint_old".
    try:
        row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance_images'").fetchone()
        if row and ('_maint_old' in (row['sql'] or '') or '_m_old' in (row['sql'] or '')):
            conn.executescript("""PRAGMA foreign_keys=OFF;
                BEGIN;
                CREATE TABLE maintenance_images_new (id INTEGER PRIMARY KEY AUTOINCREMENT,
                maintenance_id INTEGER NOT NULL,filename TEXT NOT NULL,original_name TEXT,
                file_type TEXT NOT NULL DEFAULT 'image',created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE);
                INSERT INTO maintenance_images_new (id,maintenance_id,filename,original_name,file_type,created_at)
                SELECT id,maintenance_id,filename,original_name,file_type,created_at FROM maintenance_images;
                DROP TABLE maintenance_images;
                ALTER TABLE maintenance_images_new RENAME TO maintenance_images;
                COMMIT;""")
            conn.commit()
            print("Migration: repaired dangling maintenance_images foreign key")
    except Exception as e:
        print(f"Migration maintenance_images FK: {e}")
    # Migration: add Inspection CHECK
    try:
        tbl = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='maintenance'").fetchone()
        if tbl and 'Inspection' not in (tbl['sql'] or ''):
            conn.executescript("""PRAGMA foreign_keys=OFF;ALTER TABLE maintenance RENAME TO _m_old;
                CREATE TABLE maintenance (id INTEGER PRIMARY KEY AUTOINCREMENT,car_id INTEGER NOT NULL,title TEXT NOT NULL,
                maintenance_type TEXT NOT NULL CHECK(maintenance_type IN ('Repair','Maintenance','Upgrade','Inspection')),
                service_date TEXT NOT NULL,odometer INTEGER,parts_vendor TEXT,cost REAL,notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),FOREIGN KEY (car_id) REFERENCES cars(id) ON DELETE CASCADE);
                INSERT INTO maintenance SELECT * FROM _m_old;DROP TABLE _m_old;PRAGMA foreign_keys=ON;""")
            conn.commit()
    except Exception as e:
        print(f"Migration Inspection CHECK: {e}")
    # Migration: reminders gained a time-based mode, so interval_miles is no
    # longer the only interval. Pre-0.3.2 rows are all mileage-based.
    try:
        cols = [r['name'] for r in conn.execute("PRAGMA table_info(service_reminders)").fetchall()]
        if 'interval_type' not in cols:
            conn.execute("ALTER TABLE service_reminders ADD COLUMN interval_type TEXT NOT NULL DEFAULT 'miles'")
        if 'interval_months' not in cols:
            conn.execute("ALTER TABLE service_reminders ADD COLUMN interval_months INTEGER")
        if 'last_done_date' not in cols:
            conn.execute("ALTER TABLE service_reminders ADD COLUMN last_done_date TEXT")
        conn.commit()
    except Exception as e:
        print(f"Migration reminder interval columns: {e}")
    # Migration: records gained labor, shipping and tax, which add up with their parts.
    try:
        cols = [r['name'] for r in conn.execute("PRAGMA table_info(maintenance)").fetchall()]
        for col in ('labor', 'shipping', 'tax'):
            if col not in cols:
                conn.execute(f"ALTER TABLE maintenance ADD COLUMN {col} REAL")
        conn.commit()
    except Exception as e:
        print(f"Migration labor, shipping and tax columns: {e}")
    # One-time: fill each user's vendor list from the vendors already on their
    # records. Recorded in app_meta so vendors removed later stay removed.
    try:
        if not conn.execute("SELECT 1 FROM app_meta WHERE key='vendors_seeded'").fetchone():
            n = seed_vendors_from_records(conn)
            conn.execute("INSERT INTO app_meta (key,value) VALUES ('vendors_seeded',datetime('now'))")
            conn.commit()
            if n: print(f"Migration: saved {n} vendor(s) from existing records")
    except Exception as e:
        conn.rollback()
        print(f"Migration vendors from records: {e}")
    conn.close()

def clean_vendor_name(name):
    """Trim and collapse inner whitespace: how a vendor name is stored."""
    return ' '.join((name or '').split())

def vendor_key(name):
    """Matching key for vendor names. Ignores case, accents, spacing and
    punctuation, and treats '&' as 'and', so 'AutoZone', 'Auto Zone' and
    'autozone.' are one vendor. static/js/app.js has the same rule."""
    s = unicodedata.normalize('NFKD', name or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower().replace('&', 'and')
    return ''.join(c for c in s if c.isalnum())

def seed_vendors_from_records(conn):
    """Save the vendors found on each user's records to that user's list,
    one per matching key. The spelling used most often wins; ties go to the
    most recent record. Returns how many vendors were added."""
    rows = conn.execute('''SELECT c.user_id, m.parts_vendor, COUNT(*) AS uses,
            MAX(m.service_date || '|' || printf('%010d', m.id)) AS latest
        FROM maintenance m JOIN cars c ON c.id=m.car_id
        WHERE m.parts_vendor IS NOT NULL AND TRIM(m.parts_vendor) != ''
        GROUP BY c.user_id, m.parts_vendor''').fetchall()
    # Tally per spelling first: raw values differing only in spacing are one spelling.
    tally = {}  # (user_id, key) -> {name: [uses, latest]}
    for r in rows:
        name = clean_vendor_name(r['parts_vendor'])[:VENDOR_NAME_MAX].strip()
        k = vendor_key(name)
        if not k: continue
        t = tally.setdefault((r['user_id'], k), {}).setdefault(name, [0, ''])
        t[0] += r['uses']; t[1] = max(t[1], r['latest'])
    added = 0
    for (uid, k), spellings in tally.items():
        name = max(spellings, key=lambda n: tuple(spellings[n]))
        added += conn.execute('INSERT OR IGNORE INTO vendors (user_id,name,match_key) VALUES (?,?,?)',
                              (uid, name, k)).rowcount
    return added

def save_upload(file, subfolder):
    if file and allowed_file(file.filename):
        ext = file.filename.rsplit('.',1)[1].lower()
        folder = os.path.join(app.config['UPLOAD_FOLDER'], subfolder)
        os.makedirs(folder, exist_ok=True)
        if ext in CONVERT_TO_JPEG:
            return save_as_jpeg(file, folder)
        fn = f"{uuid.uuid4().hex}.{ext}"
        file.save(os.path.join(folder, fn))
        return fn
    return None

def save_as_jpeg(file, folder):
    """An iPhone's HEIC photo, saved as a JPEG every browser and the PDF export
    can show. Turned upright, and without its metadata (location included).
    None when the file cannot be read as an image."""
    from PIL import Image, ImageOps
    import pillow_heif
    pillow_heif.register_heif_opener()
    fn = f"{uuid.uuid4().hex}.jpg"
    try:
        with Image.open(file.stream) as im:
            ImageOps.exif_transpose(im).convert('RGB').save(os.path.join(folder, fn), 'JPEG', quality=88, optimize=True)
    except Exception as e:
        print(f"Could not convert {file.filename!r} to JPEG: {e}")
        return None
    return fn

def get_file_type(filename):
    if filename and filename.rsplit('.',1)[1].lower() == 'pdf': return 'document'
    return 'image'

def get_user_perms(user):
    """Get effective permissions for a user."""
    if user['role'] == 'admin':
        return {k: True for k in DEFAULT_PERMS}
    try:
        perms = json.loads(user.get('permissions','{}') or '{}')
        return {k: perms.get(k, v) for k, v in DEFAULT_PERMS.items()}
    except:
        return dict(DEFAULT_PERMS)

VENDOR_NAME_MAX = 100

MONTH_DAYS = 30.44  # average calendar month, for months-to-days comparisons

def _rem_date(v):
    """Parse a stored YYYY-MM-DD date; None for anything unusable."""
    if not v: return None
    try:
        return date.fromisoformat(str(v).strip()[:10])
    except (ValueError, TypeError):
        return None

def _add_months(d, months):
    """`d` plus N calendar months, clamped to the last day of the target month."""
    m = d.month - 1 + int(months)
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))

def reminder_status(conn, rem, current_odo=None, today=None):
    """Expand a service_reminders row with its computed due state.

    A reminder counts down either mileage or calendar time, per `interval_type`.
    Either way the anchor is the most recent service record whose title matches
    the reminder's, so logging the service again rolls the next due point
    forward on its own. `last_done_odometer` / `last_done_date` hold the manual
    mark -- set by hand, or by ticking the counter while logging a record -- and
    the anchor is whichever of the two is further along, so marking a counter
    reset always takes effect.

    `remaining_fraction` is how much of the interval is left, and is the one
    field comparable across both modes -- use it to sort mixed lists.
    """
    d = dict(rem)
    cid = d['car_id']
    d['interval_type'] = itype = 'time' if (d.get('interval_type') or 'miles') == 'time' else 'miles'
    d.setdefault('interval_months', None)
    d.setdefault('last_done_date', None)
    d.update(current_odometer=None, last_service_odometer=None, next_due_odometer=None,
             miles_remaining=None, last_service_date=None, next_due_date=None,
             days_remaining=None, remaining_fraction=None)

    if itype == 'time':
        match = conn.execute(
            "SELECT MAX(service_date) AS s FROM maintenance WHERE car_id=?"
            " AND lower(trim(title))=lower(trim(?))", (cid, d['title'])).fetchone()
        anchor = max([x for x in (_rem_date(match['s'] if match else None),
                                   _rem_date(d.get('last_done_date'))) if x], default=None)
        interval = int(d.get('interval_months') or 0)
        d['last_service_date'] = anchor.isoformat() if anchor else None
        if anchor is None or interval <= 0:
            d['status'] = 'no_baseline'
            return d
        due = _add_months(anchor, interval)
        d['next_due_date'] = due.isoformat()
        remaining = (due - (today or date.today())).days
        d['days_remaining'] = remaining
        d['remaining_fraction'] = remaining / (interval * MONTH_DAYS)
        soon = max(14, int(interval * MONTH_DAYS * 0.05))
        d['status'] = 'overdue' if remaining <= 0 else ('due_soon' if remaining <= soon else 'ok')
        return d

    if current_odo is None:
        row = conn.execute('SELECT MAX(odometer) AS o FROM maintenance WHERE car_id=?', (cid,)).fetchone()
        current_odo = row['o'] if row and row['o'] is not None else None
    match = conn.execute(
        "SELECT MAX(odometer) AS o FROM maintenance WHERE car_id=? AND odometer IS NOT NULL"
        " AND lower(trim(title))=lower(trim(?))", (cid, d['title'])).fetchone()
    anchor = max([int(x) for x in (match['o'] if match else None, d.get('last_done_odometer'))
                   if x is not None], default=None)
    interval = int(d.get('interval_miles') or 0)
    d['current_odometer'] = current_odo
    d['last_service_odometer'] = anchor
    if anchor is None or interval <= 0:
        d['status'] = 'no_baseline'
        return d
    next_due = int(anchor) + interval
    d['next_due_odometer'] = next_due
    if current_odo is None:
        d['status'] = 'no_baseline'
        return d
    remaining = next_due - int(current_odo)
    d['miles_remaining'] = remaining
    d['remaining_fraction'] = remaining / interval
    soon = max(250, int(interval * 0.05))
    d['status'] = 'overdue' if remaining <= 0 else ('due_soon' if remaining <= soon else 'ok')
    return d

def reset_reminder_baselines(conn, cid, ids, odo, service_date):
    """Restart the named counters from this service record: mileage counters
    from its odometer, time counters from its date. Ids that aren't this car's
    are ignored, as is a mileage counter on a record with no odometer."""
    done = []
    for raw in ids:
        try: rid = int(str(raw).strip())
        except (TypeError, ValueError): continue
        rem = conn.execute('SELECT * FROM service_reminders WHERE id=? AND car_id=?', (rid, cid)).fetchone()
        if not rem: continue
        if (rem['interval_type'] or 'miles') == 'time':
            if not _rem_date(service_date): continue
            conn.execute('UPDATE service_reminders SET last_done_date=? WHERE id=?', (service_date, rid))
        else:
            if odo is None: continue
            conn.execute('UPDATE service_reminders SET last_done_odometer=? WHERE id=?', (int(odo), rid))
        done.append(rid)
    return done

def reminder_out(conn, rem):
    """A reminder as the vehicle page shows it: its due state and its links."""
    d = reminder_status(conn, rem)
    d['links'] = load_links(conn, 'reminder', rem['id'])
    return d

def reminder_sort_key(r):
    """Soonest-due first across both interval modes, baseline-less rows last."""
    f = r.get('remaining_fraction')
    return (f is None, f if f is not None else 0.0)

def parse_reminder_input(d, base=None):
    """Validate reminder JSON/form input, falling back to `base` (the existing
    row) for anything the caller omitted. Returns (fields, error)."""
    def pick(key, default=None):
        v = d.get(key)
        if v is not None: return v
        if base is not None and key in base.keys(): return base[key]
        return default

    def interval(key):
        # blank means "unchanged" for an interval, never "cleared"
        v = d.get(key)
        if v is None or not str(v).strip():
            v = base[key] if base is not None and key in base.keys() else None
        return int(str(v).strip()) if v is not None and str(v).strip() else None

    def odometer(key):
        # blank *does* clear a manual baseline
        v = pick(key)
        return int(str(v).strip()) if v is not None and str(v).strip() else None

    t = str(pick('title', '') or '').strip()
    itype = 'time' if str(pick('interval_type', 'miles') or '').strip().lower() == 'time' else 'miles'
    n = str(pick('notes', '') or '').strip()
    ld_date = str(pick('last_done_date', '') or '').strip() or None
    try:
        iv_mi, iv_mo, ld_odo = interval('interval_miles'), interval('interval_months'), odometer('last_done_odometer')
    except ValueError:
        return None, 'Mileage and interval values must be whole numbers'

    if not t: return None, 'Title is required'
    if itype == 'time':
        if not iv_mo or iv_mo <= 0: return None, 'Month interval is required and must be greater than zero'
        if ld_date and _rem_date(ld_date) is None: return None, 'Last-done date must be a valid date'
    else:
        if not iv_mi or iv_mi <= 0: return None, 'Mileage interval is required and must be greater than zero'
        if ld_odo is not None and ld_odo < 0: return None, 'Last-done mileage cannot be negative'
    return {'title': t, 'interval_type': itype, 'interval_miles': iv_mi or 0, 'interval_months': iv_mo,
            'last_done_odometer': ld_odo, 'last_done_date': ld_date, 'notes': n or None}, None

def can_access_car(conn, cid, user):
    """Check if user can access this car (owns it or is admin)."""
    car = conn.execute('SELECT * FROM cars WHERE id=?',(cid,)).fetchone()
    if not car: return None
    if user['role'] == 'admin' or car['user_id'] == user['id']:
        return car
    return None

# ── Error Handlers ─────────────────────────────────────
@app.errorhandler(413)
def too_large(e):
    if request.path.startswith('/api/'): return jsonify({'error':'File too large (max 32MB)'}), 413
    return 'File too large', 413

@app.errorhandler(500)
def server_error(e):
    if request.path.startswith('/api/'): return jsonify({'error':'Internal server error'}), 500
    return 'Internal server error', 500

@app.teardown_request
def close_db_conns(exc):
    """Release any connection a view opened, rolling back if it failed."""
    for conn in g.pop('_db_conns', []):
        try:
            if exc is not None: conn.rollback()
            conn.close()
        except Exception:
            pass

# ── Auth Middleware ─────────────────────────────────────
@app.before_request
def load_user():
    g.user = None
    uid = session.get('user_id')
    if uid:
        conn = get_db()
        u = conn.execute('SELECT id,username,display_name,role,permissions,must_change_password FROM users WHERE id=?',(uid,)).fetchone()
        conn.close()
        if u: g.user = dict(u)

def login_required(f):
    @wraps(f)
    def dec(*a,**kw):
        if not g.user:
            if request.path.startswith('/api/'): return jsonify({'error':'Authentication required'}), 401
            return redirect(url_for('login_page'))
        return f(*a,**kw)
    return dec

def role_required(*roles):
    def decorator(f):
        @wraps(f)
        @login_required
        def dec(*a,**kw):
            if g.user['role'] not in roles: return jsonify({'error':'Insufficient permissions'}), 403
            return f(*a,**kw)
        return dec
    return decorator

def perm_required(perm):
    """Check a specific granular permission."""
    def decorator(f):
        @wraps(f)
        @login_required
        def dec(*a,**kw):
            perms = get_user_perms(g.user)
            if not perms.get(perm, False): return jsonify({'error':'Permission denied'}), 403
            return f(*a,**kw)
        return dec
    return decorator

# ── Pages ──────────────────────────────────────────────
@app.route('/uploads/<path:filename>')
@login_required
def serve_upload(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/login')
def login_page():
    if g.user: return redirect(url_for('index'))
    return render_template('login.html', version=APP_VERSION)

@app.route('/')
@login_required
def index():
    perms = get_user_perms(g.user)
    # The saved theme, so the page paints in it before the settings load.
    conn = get_db()
    row = conn.execute('SELECT settings FROM user_settings WHERE user_id=?', (g.user['id'],)).fetchone()
    conn.close()
    try: theme = json.loads(row['settings']).get('theme', 'dark') if row else 'dark'
    except (ValueError, TypeError): theme = 'dark'
    if theme not in ('dark', 'light', 'system'): theme = 'dark'
    return render_template('index.html', user=g.user, version=APP_VERSION, perms=perms, theme_pref=theme)

@app.route('/api/version')
def api_version():
    return jsonify({'version': APP_VERSION})

# ── Auth API ───────────────────────────────────────────
@app.route('/api/auth/login', methods=['POST'])
def api_login():
    data = request.get_json() or {}
    u, p = data.get('username','').strip(), data.get('password','')
    if not u or not p: return jsonify({'error':'Username and password required'}), 400
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE username=?',(u,)).fetchone()
    conn.close()
    if not user or not verify_password(p, user['password']): return jsonify({'error':'Invalid credentials'}), 401
    session.clear(); session['user_id']=user['id']; session.permanent=True
    mcp = 0
    try: mcp = user['must_change_password']
    except: pass
    return jsonify({'id':user['id'],'username':user['username'],'display_name':user['display_name'],
                    'role':user['role'],'must_change_password':bool(mcp)})

@app.route('/api/auth/logout', methods=['POST'])
def api_logout():
    session.clear(); return jsonify({'success':True})

@app.route('/api/auth/me')
@login_required
def api_me():
    perms = get_user_perms(g.user)
    return jsonify({**g.user, 'effective_permissions': perms})

@app.route('/api/auth/change-password', methods=['POST'])
@login_required
def api_change_password():
    data = request.get_json() or {}
    cur, new = data.get('current_password',''), data.get('new_password','')
    if not cur or not new: return jsonify({'error':'Both passwords required'}), 400
    if len(new)<4: return jsonify({'error':'Min 4 characters'}), 400
    conn = get_db()
    u = conn.execute('SELECT password FROM users WHERE id=?',(g.user['id'],)).fetchone()
    if not verify_password(cur, u['password']): conn.close(); return jsonify({'error':'Current password incorrect'}), 401
    conn.execute('UPDATE users SET password=?, must_change_password=0 WHERE id=?',(hash_password(new),g.user['id']))
    conn.commit(); conn.close()
    return jsonify({'success':True})

# ── Settings API ───────────────────────────────────────
@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    conn = get_db()
    row = conn.execute('SELECT settings FROM user_settings WHERE user_id=?',(g.user['id'],)).fetchone()
    conn.close()
    defaults = {'dashboard_range':'all','show_vehicles':True,'show_records':True,'show_cost':True,'show_due':True,'theme':'dark'}
    if row:
        saved = json.loads(row['settings'])
        defaults.update(saved)
    return jsonify(defaults)

@app.route('/api/settings', methods=['PUT'])
@login_required
def save_settings():
    data = request.get_json() or {}
    conn = get_db()
    s = json.dumps(data)
    existing = conn.execute('SELECT user_id FROM user_settings WHERE user_id=?',(g.user['id'],)).fetchone()
    if existing: conn.execute('UPDATE user_settings SET settings=? WHERE user_id=?',(s,g.user['id']))
    else: conn.execute('INSERT INTO user_settings (user_id,settings) VALUES (?,?)',(g.user['id'],s))
    conn.commit(); conn.close()
    return jsonify({'success':True})

# ── Vendors API ────────────────────────────────────────
# Each user keeps their own list. Records still store the vendor as plain
# text, so renaming or removing a vendor here never touches existing records.

@app.route('/api/vendors', methods=['GET'])
@login_required
def get_vendors():
    conn = get_db()
    rows = conn.execute('SELECT id,name FROM vendors WHERE user_id=? ORDER BY name COLLATE NOCASE',(g.user['id'],)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])

def parse_vendor_name():
    """(name, key, error) from the request body."""
    name = clean_vendor_name((request.get_json() or {}).get('name'))
    if not name: return None, None, 'Vendor name required'
    if len(name) > VENDOR_NAME_MAX: return None, None, f'Max {VENDOR_NAME_MAX} characters'
    k = vendor_key(name)
    if not k: return None, None, 'Vendor name needs a letter or number'
    return name, k, None

@app.route('/api/vendors', methods=['POST'])
@login_required
def add_vendor():
    name, k, err = parse_vendor_name()
    if err: return jsonify({'error':err}), 400
    conn = get_db()
    # A name matching a saved vendor returns that vendor instead of a duplicate.
    cur = conn.execute('INSERT OR IGNORE INTO vendors (user_id,name,match_key) VALUES (?,?,?)',(g.user['id'],name,k))
    conn.commit()
    row = dict(conn.execute('SELECT id,name FROM vendors WHERE user_id=? AND match_key=?',(g.user['id'],k)).fetchone())
    conn.close()
    return jsonify(row), 201 if cur.rowcount else 200

@app.route('/api/vendors/<int:vid>', methods=['PUT'])
@login_required
def rename_vendor(vid):
    name, k, err = parse_vendor_name()
    if err: return jsonify({'error':err}), 400
    conn = get_db()
    if not conn.execute('SELECT 1 FROM vendors WHERE id=? AND user_id=?',(vid,g.user['id'])).fetchone():
        conn.close(); return jsonify({'error':'Not found'}), 404
    clash = conn.execute('SELECT name FROM vendors WHERE user_id=? AND match_key=? AND id!=?',(g.user['id'],k,vid)).fetchone()
    if clash: conn.close(); return jsonify({'error':f'"{clash["name"]}" is already saved'}), 409
    conn.execute('UPDATE vendors SET name=?,match_key=? WHERE id=?',(name,k,vid))
    conn.commit(); conn.close()
    return jsonify({'id':vid,'name':name})

@app.route('/api/vendors/<int:vid>', methods=['DELETE'])
@login_required
def delete_vendor(vid):
    conn = get_db()
    cur = conn.execute('DELETE FROM vendors WHERE id=? AND user_id=?',(vid,g.user['id']))
    conn.commit(); conn.close()
    if not cur.rowcount: return jsonify({'error':'Not found'}), 404
    return jsonify({'success':True})

# ── User Management (admin) ───────────────────────────
@app.route('/api/users', methods=['GET'])
@role_required('admin')
def get_users():
    conn = get_db()
    users = conn.execute('SELECT id,username,display_name,role,permissions,created_at FROM users ORDER BY created_at').fetchall()
    conn.close()
    result = []
    for u in users:
        d = dict(u)
        d['effective_permissions'] = get_user_perms(d)
        result.append(d)
    return jsonify(result)

@app.route('/api/users', methods=['POST'])
@role_required('admin')
def create_user():
    data = request.get_json() or {}
    un=data.get('username','').strip().lower(); pw=data.get('password','')
    dn=data.get('display_name','').strip(); role=data.get('role','editor').strip()
    perms=data.get('permissions',{})
    if not un or not pw: return jsonify({'error':'Username and password required'}), 400
    if role not in ROLES: return jsonify({'error':'Invalid role'}), 400
    if len(pw)<4: return jsonify({'error':'Min 4 chars'}), 400
    conn = get_db()
    if conn.execute('SELECT id FROM users WHERE username=?',(un,)).fetchone():
        conn.close(); return jsonify({'error':'Username exists'}), 409
    conn.execute('INSERT INTO users (username,password,display_name,role,permissions) VALUES (?,?,?,?,?)',
                 (un, hash_password(pw), dn or un, role, json.dumps(perms)))
    conn.commit()
    u = conn.execute('SELECT id,username,display_name,role,permissions,created_at FROM users WHERE username=?',(un,)).fetchone()
    conn.close()
    d = dict(u); d['effective_permissions'] = get_user_perms(d)
    return jsonify(d), 201

@app.route('/api/users/<int:uid>', methods=['PUT'])
@role_required('admin')
def update_user(uid):
    data = request.get_json() or {}
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
    if not user: conn.close(); return jsonify({'error':'Not found'}), 404
    dn = data.get('display_name',user['display_name']).strip()
    role = data.get('role',user['role']).strip()
    perms = data.get('permissions')
    npw = data.get('password','').strip()
    if role not in ROLES: conn.close(); return jsonify({'error':'Invalid role'}), 400
    if user['role']=='admin' and role!='admin':
        if conn.execute("SELECT COUNT(*) as c FROM users WHERE role='admin'").fetchone()['c']<=1:
            conn.close(); return jsonify({'error':'Cannot remove last admin'}), 400
    perm_str = json.dumps(perms) if perms is not None else user['permissions']
    if npw:
        if len(npw)<4: conn.close(); return jsonify({'error':'Min 4 chars'}), 400
        conn.execute('UPDATE users SET display_name=?,role=?,permissions=?,password=? WHERE id=?',(dn,role,perm_str,hash_password(npw),uid))
    else:
        conn.execute('UPDATE users SET display_name=?,role=?,permissions=? WHERE id=?',(dn,role,perm_str,uid))
    conn.commit()
    u = conn.execute('SELECT id,username,display_name,role,permissions,created_at FROM users WHERE id=?',(uid,)).fetchone()
    conn.close()
    d = dict(u); d['effective_permissions'] = get_user_perms(d)
    return jsonify(d)

@app.route('/api/users/<int:uid>', methods=['DELETE'])
@role_required('admin')
def delete_user(uid):
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone()
    if not user: conn.close(); return jsonify({'error':'Not found'}), 404
    if uid==g.user['id']: conn.close(); return jsonify({'error':'Cannot delete yourself'}), 400
    if user['role']=='admin':
        if conn.execute("SELECT COUNT(*) as c FROM users WHERE role='admin'").fetchone()['c']<=1:
            conn.close(); return jsonify({'error':'Cannot delete last admin'}), 400
    conn.execute('DELETE FROM users WHERE id=?',(uid,))
    conn.commit(); conn.close()
    return jsonify({'success':True})

# ── Car API (multi-user) ──────────────────────────────
@app.route('/api/cars', methods=['GET'])
@login_required
def get_cars():
    q = request.args.get('q','').strip()
    conn = get_db()
    if g.user['role'] == 'admin':
        if q:
            cars = conn.execute("SELECT c.*, u.display_name as owner_name FROM cars c JOIN users u ON c.user_id=u.id WHERE c.year LIKE ? OR c.make LIKE ? OR c.model LIKE ? OR c.vin LIKE ? ORDER BY c.created_at DESC",
                (f'%{q}%',f'%{q}%',f'%{q}%',f'%{q}%')).fetchall()
        else:
            cars = conn.execute('SELECT c.*, u.display_name as owner_name FROM cars c JOIN users u ON c.user_id=u.id ORDER BY c.created_at DESC').fetchall()
    else:
        if q:
            cars = conn.execute("SELECT * FROM cars WHERE user_id=? AND (year LIKE ? OR make LIKE ? OR model LIKE ? OR vin LIKE ?) ORDER BY created_at DESC",
                (g.user['id'],f'%{q}%',f'%{q}%',f'%{q}%',f'%{q}%')).fetchall()
        else:
            cars = conn.execute('SELECT * FROM cars WHERE user_id=? ORDER BY created_at DESC',(g.user['id'],)).fetchall()
    result = []
    for car in cars:
        c = dict(car)
        s = conn.execute("SELECT COUNT(*) as count, COALESCE(SUM(cost),0) as total_cost, MAX(odometer) as max_odo FROM maintenance WHERE car_id=?",(c['id'],)).fetchone()
        c['maintenance_count']=s['count']; c['total_cost']=s['total_cost']; c['latest_odometer']=s['max_odo']
        # Upcoming service reminders for the card: soonest first, skipping any
        # that have no baseline to count down from.
        rems = [reminder_status(conn, r, s['max_odo'])
                for r in conn.execute('SELECT * FROM service_reminders WHERE car_id=?', (c['id'],)).fetchall()]
        rems = [r for r in rems if r['status'] != 'no_baseline']
        rems.sort(key=reminder_sort_key)
        c['reminders'] = rems[:3]
        c['reminders_total'] = len(rems)
        c['reminders_due'] = sum(1 for r in rems if r['status'] in ('overdue','due_soon'))
        result.append(c)
    conn.close()
    return jsonify(result)

@app.route('/api/cars', methods=['POST'])
@perm_required('can_add_cars')
def add_car():
    year=request.form.get('year'); make=request.form.get('make','').strip()
    model=request.form.get('model','').strip(); vin=request.form.get('vin','').strip()
    pd=request.form.get('purchase_date','').strip()
    if not year or not make or not model: return jsonify({'error':'Year, make, model required'}), 400
    image = save_upload(request.files.get('image'), 'cars') if 'image' in request.files else None
    conn = get_db()
    cur = conn.execute('INSERT INTO cars (user_id,year,make,model,vin,image,purchase_date) VALUES (?,?,?,?,?,?,?)',
                       (g.user['id'], int(year), make, model, vin or None, image, pd or None))
    conn.commit()
    car = dict(conn.execute('SELECT * FROM cars WHERE id=?',(cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(car), 201

@app.route('/api/cars/<int:cid>', methods=['GET'])
@login_required
def get_car(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    conn.close()
    if not car: return jsonify({'error':'Not found'}), 404
    return jsonify(dict(car))

@app.route('/api/cars/<int:cid>', methods=['PUT'])
@perm_required('can_edit_cars')
def update_car(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    year=request.form.get('year',car['year']); make=request.form.get('make',car['make']).strip()
    model=request.form.get('model',car['model']).strip(); vin=request.form.get('vin',car['vin'] or '').strip()
    pd=request.form.get('purchase_date',car['purchase_date'] or '').strip()
    image = car['image']
    if 'image' in request.files and request.files['image'].filename:
        if car['image']:
            p = os.path.join(app.config['UPLOAD_FOLDER'],'cars',car['image'])
            if os.path.exists(p): os.remove(p)
        image = save_upload(request.files['image'],'cars')
    conn.execute('UPDATE cars SET year=?,make=?,model=?,vin=?,image=?,purchase_date=? WHERE id=?',
                 (int(year),make,model,vin or None,image,pd or None,cid))
    conn.commit()
    updated = dict(conn.execute('SELECT * FROM cars WHERE id=?',(cid,)).fetchone())
    conn.close()
    return jsonify(updated)

@app.route('/api/cars/<int:cid>', methods=['DELETE'])
@perm_required('can_delete_cars')
def delete_car(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    if car['image']:
        p = os.path.join(app.config['UPLOAD_FOLDER'],'cars',car['image'])
        if os.path.exists(p): os.remove(p)
    for img in conn.execute("SELECT mi.filename FROM maintenance_images mi JOIN maintenance m ON mi.maintenance_id=m.id WHERE m.car_id=?",(cid,)).fetchall():
        p = os.path.join(app.config['UPLOAD_FOLDER'],'maintenance',img['filename'])
        if os.path.exists(p): os.remove(p)
    conn.execute('DELETE FROM cars WHERE id=?',(cid,)); conn.commit(); conn.close()
    return jsonify({'success':True})

# ── Maintenance API ────────────────────────────────────
# ── Parts ──────────────────────────────────────────────
# A record can list the parts that went into it, each with a vendor and cost,
# and the labor paid for, plus shipping and tax. Itemized like that, the
# record's cost is their total, so every sum and chart that reads
# maintenance.cost stays right. Otherwise it is one amount, typed in.
PARTS_MAX = 100

def parse_money(raw, label):
    """(value, error) for an optional amount: None when blank."""
    raw = str(raw if raw is not None else '').strip().replace('$', '').replace(',', '')
    if not raw: return None, None
    try: v = round(float(raw), 2)
    except ValueError: return None, f'{label} must be a number.'
    if v != v or v in (float('inf'), float('-inf')): return None, f'{label} must be a number.'
    if v < 0: return None, f'{label} cannot be negative.'
    return v, None

COST_PARTS = ('labor', 'shipping', 'tax')
NO_EXTRAS = dict.fromkeys(COST_PARTS)

def parse_parts_input(form):
    """From a record form: (parts, extras, error), extras being labor, shipping
    and tax. parts is None when the form carries no parts list (older clients),
    which leaves parts and extras alone."""
    if 'parts' not in form: return None, None, None
    try: raw = json.loads(form.get('parts') or '[]')
    except ValueError: return None, None, 'The parts list could not be read.'
    if not isinstance(raw, list): return None, None, 'The parts list could not be read.'
    parts = []
    for item in raw:
        if not isinstance(item, dict): return None, None, 'The parts list could not be read.'
        name = ' '.join(str(item.get('name') or '').split())[:200]
        vendor = clean_vendor_name(str(item.get('vendor') or ''))[:100]
        cost, err = parse_money(item.get('cost'), 'A part cost')
        if err: return None, None, err
        if not name and not vendor and cost is None: continue   # a blank line
        if not name: return None, None, 'Each part needs a name.'
        parts.append({'name': name, 'vendor': vendor or None, 'cost': cost})
    if len(parts) > PARTS_MAX: return None, None, f'A record can list up to {PARTS_MAX} parts.'
    extras = {}
    for key in COST_PARTS:
        extras[key], err = parse_money(form.get(key), key.capitalize())
        if err: return None, None, err
    return parts, extras, None

def itemized(parts, extras):
    """Whether the cost adds itself up: there are parts, labor, shipping or tax."""
    return bool(parts) or any(extras[k] is not None for k in COST_PARTS)

def parts_total(parts, extras):
    return round(sum(p['cost'] or 0 for p in parts) + sum(extras[k] or 0 for k in COST_PARTS), 2)

def save_parts(conn, mid, parts):
    conn.execute('DELETE FROM maintenance_parts WHERE maintenance_id=?', (mid,))
    conn.executemany('INSERT INTO maintenance_parts (maintenance_id,position,name,vendor,cost) VALUES (?,?,?,?,?)',
                     [(mid, i, p['name'], p['vendor'], p['cost']) for i, p in enumerate(parts)])

def load_parts(conn, mid):
    return [dict(p) for p in conn.execute('SELECT id,name,vendor,cost FROM maintenance_parts WHERE maintenance_id=? ORDER BY position, id', (mid,)).fetchall()]

# ── Links ──────────────────────────────────────────────
# Records and reminders can each keep links: where to buy a part, a diagram,
# the manual, a how-to video. A link is a web address and an optional label.
LINKS_MAX = 50
LINK_TABLES = {'maintenance': ('maintenance_links', 'maintenance_id'), 'reminder': ('reminder_links', 'reminder_id')}

def clean_link_url(raw):
    """(url, error): http and https only, so a stored link can never run
    script when opened. An address typed without a scheme gets https://."""
    u = str(raw or '').strip()
    if not u: return None, None
    if not re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', u): u = 'https://' + u.lstrip('/')
    if len(u) > 2000: return None, 'A link can be at most 2,000 characters.'
    try: parts = urlsplit(u)
    except ValueError: parts = None
    if not parts or parts.scheme.lower() not in ('http', 'https') or not parts.hostname or any(c.isspace() for c in u):
        return None, f'"{str(raw).strip()[:80]}" is not a web address. Use one that starts with http or https.'
    return u, None

def parse_links_input(raw):
    """(links, error) from a list, or the JSON of one. links is None when
    nothing was sent (older clients), which leaves the stored links alone."""
    if raw is None: return None, None
    if isinstance(raw, str):
        try: raw = json.loads(raw or '[]')
        except ValueError: return None, 'The links could not be read.'
    if not isinstance(raw, list): return None, 'The links could not be read.'
    links = []
    for item in raw:
        if not isinstance(item, dict): return None, 'The links could not be read.'
        label = ' '.join(str(item.get('label') or '').split())[:200]
        url, err = clean_link_url(item.get('url'))
        if err: return None, err
        if not url:
            if label: return None, 'Each link needs a web address.'
            continue   # a blank line
        links.append({'url': url, 'label': label or None})
    if len(links) > LINKS_MAX: return None, f'Up to {LINKS_MAX} links can be added.'
    return links, None

def save_links(conn, kind, owner_id, links):
    table, col = LINK_TABLES[kind]
    conn.execute(f'DELETE FROM {table} WHERE {col}=?', (owner_id,))
    conn.executemany(f'INSERT INTO {table} ({col},position,url,label) VALUES (?,?,?,?)',
                     [(owner_id, i, l['url'], l['label']) for i, l in enumerate(links)])

def load_links(conn, kind, owner_id):
    table, col = LINK_TABLES[kind]
    return [dict(l) for l in conn.execute(f'SELECT id,url,label FROM {table} WHERE {col}=? ORDER BY position, id', (owner_id,)).fetchall()]

def link_text(l):
    return f"{l['label']} ({l['url']})" if l['label'] else l['url']

def record_out(conn, row):
    """A record as the API returns it: with its files, parts and links."""
    d = dict(row)
    d['images'] = [dict(i) for i in conn.execute('SELECT * FROM maintenance_images WHERE maintenance_id=? ORDER BY created_at', (d['id'],)).fetchall()]
    d['parts'] = load_parts(conn, d['id'])
    d['links'] = load_links(conn, 'maintenance', d['id'])
    return d

@app.route('/api/cars/<int:cid>/maintenance', methods=['GET'])
@login_required
def get_maintenance(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    q=request.args.get('q','').strip(); sort=request.args.get('sort','date_desc')
    order = {'date_asc':'service_date ASC','cost_desc':'cost DESC','cost_asc':'cost ASC','odo_desc':'odometer DESC'}.get(sort,'service_date DESC')
    if q:
        like = f'%{q}%'
        entries = conn.execute(f"SELECT * FROM maintenance m WHERE car_id=? AND (title LIKE ? OR maintenance_type LIKE ? OR parts_vendor LIKE ? OR notes LIKE ?"
            f" OR EXISTS (SELECT 1 FROM maintenance_parts p WHERE p.maintenance_id=m.id AND (p.name LIKE ? OR p.vendor LIKE ?))"
            f" OR EXISTS (SELECT 1 FROM maintenance_links l WHERE l.maintenance_id=m.id AND (l.label LIKE ? OR l.url LIKE ?))) ORDER BY {order}",
            (cid,like,like,like,like,like,like,like,like)).fetchall()
    else:
        entries = conn.execute(f'SELECT * FROM maintenance WHERE car_id=? ORDER BY {order}',(cid,)).fetchall()
    result = [record_out(conn, e) for e in entries]
    conn.close()
    return jsonify(result)

@app.route('/api/cars/<int:cid>/maintenance', methods=['POST'])
@perm_required('can_add_records')
def add_maintenance(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    t=request.form.get('title','').strip(); mt=request.form.get('maintenance_type','').strip()
    sd=request.form.get('service_date','').strip(); odo=request.form.get('odometer','').strip()
    v=request.form.get('parts_vendor','').strip(); c=request.form.get('cost','').strip()
    n=request.form.get('notes','').strip()
    if not t or not mt or not sd: conn.close(); return jsonify({'error':'Title, type, date required'}), 400
    if mt not in ('Repair','Maintenance','Upgrade','Inspection'): conn.close(); return jsonify({'error':'Invalid type'}), 400
    parts, extras, err = parse_parts_input(request.form)
    if err: conn.close(); return jsonify({'error': err}), 400
    links, err = parse_links_input(request.form.get('links'))
    if err: conn.close(); return jsonify({'error': err}), 400
    parts, extras = parts or [], extras or dict(NO_EXTRAS)
    cost = parts_total(parts, extras) if itemized(parts, extras) else (float(c) if c else None)
    cur = conn.execute('INSERT INTO maintenance (car_id,title,maintenance_type,service_date,odometer,parts_vendor,cost,notes,labor,shipping,tax) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        (cid,t,mt,sd,int(odo) if odo else None,v or None,cost,n or None,extras['labor'],extras['shipping'],extras['tax']))
    mid = cur.lastrowid
    if parts: save_parts(conn, mid, parts)
    if links: save_links(conn, 'maintenance', mid, links)
    for f in request.files.getlist('gallery'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,get_file_type(fn)))
    for f in request.files.getlist('documents'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,'document'))
    reset_ids = reset_reminder_baselines(conn, cid, request.form.getlist('reset_reminders'),
                                         int(odo) if odo else None, sd)
    conn.commit()
    entry = record_out(conn, conn.execute('SELECT * FROM maintenance WHERE id=?',(mid,)).fetchone())
    entry['reminders_reset'] = reset_ids
    conn.close()
    return jsonify(entry), 201

@app.route('/api/maintenance/<int:mid>', methods=['PUT'])
@perm_required('can_edit_records')
def update_maintenance(mid):
    conn = get_db()
    entry = conn.execute('SELECT * FROM maintenance WHERE id=?',(mid,)).fetchone()
    if not entry: conn.close(); return jsonify({'error':'Not found'}), 404
    car = can_access_car(conn, entry['car_id'], g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    t=request.form.get('title',entry['title']).strip(); mt=request.form.get('maintenance_type',entry['maintenance_type']).strip()
    sd=request.form.get('service_date',entry['service_date']).strip(); odo=request.form.get('odometer','').strip()
    v=request.form.get('parts_vendor',entry['parts_vendor'] or '').strip(); c=request.form.get('cost','').strip()
    n=request.form.get('notes',entry['notes'] or '').strip()
    if not t or not mt or not sd: conn.close(); return jsonify({'error':'Title, type, date required'}), 400
    if mt not in ('Repair','Maintenance','Upgrade','Inspection'): conn.close(); return jsonify({'error':'Invalid type'}), 400
    parts, extras, err = parse_parts_input(request.form)
    if err: conn.close(); return jsonify({'error': err}), 400
    links, err = parse_links_input(request.form.get('links'))
    if err: conn.close(); return jsonify({'error': err}), 400
    if links is not None: save_links(conn, 'maintenance', mid, links)
    cost = float(c) if c else entry['cost']
    if parts is None:   # no parts list sent: parts, labor, shipping and tax stay as they are
        extras = {k: entry[k] for k in COST_PARTS}
        if itemized(load_parts(conn, mid), extras): cost = entry['cost']
    else:
        if itemized(parts, extras): cost = parts_total(parts, extras)
        save_parts(conn, mid, parts)
    conn.execute('UPDATE maintenance SET title=?,maintenance_type=?,service_date=?,odometer=?,parts_vendor=?,cost=?,notes=?,labor=?,shipping=?,tax=? WHERE id=?',
        (t,mt,sd,int(odo) if odo else entry['odometer'],v or None,cost,n or None,extras['labor'],extras['shipping'],extras['tax'],mid))
    for f in request.files.getlist('gallery'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,get_file_type(fn)))
    for f in request.files.getlist('documents'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,'document'))
    conn.commit()
    updated = record_out(conn, conn.execute('SELECT * FROM maintenance WHERE id=?',(mid,)).fetchone())
    conn.close()
    return jsonify(updated)

@app.route('/api/maintenance/<int:mid>', methods=['DELETE'])
@perm_required('can_delete_records')
def delete_maintenance(mid):
    conn = get_db()
    entry = conn.execute('SELECT * FROM maintenance WHERE id=?',(mid,)).fetchone()
    if not entry: conn.close(); return jsonify({'error':'Not found'}), 404
    car = can_access_car(conn, entry['car_id'], g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    for img in conn.execute('SELECT filename FROM maintenance_images WHERE maintenance_id=?',(mid,)).fetchall():
        p = os.path.join(app.config['UPLOAD_FOLDER'],'maintenance',img['filename'])
        if os.path.exists(p): os.remove(p)
    conn.execute('DELETE FROM maintenance WHERE id=?',(mid,)); conn.commit(); conn.close()
    return jsonify({'success':True})

@app.route('/api/maintenance/<int:mid>/duplicate', methods=['POST'])
@perm_required('can_add_records')
def duplicate_maintenance(mid):
    conn = get_db()
    entry = conn.execute('SELECT * FROM maintenance WHERE id=?',(mid,)).fetchone()
    if not entry: conn.close(); return jsonify({'error':'Not found'}), 404
    car = can_access_car(conn, entry['car_id'], g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    cur = conn.execute('INSERT INTO maintenance (car_id,title,maintenance_type,service_date,odometer,parts_vendor,cost,notes,labor,shipping,tax) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        (entry['car_id'],entry['title']+' (copy)',entry['maintenance_type'],entry['service_date'],entry['odometer'],entry['parts_vendor'],entry['cost'],entry['notes'],entry['labor'],entry['shipping'],entry['tax']))
    save_parts(conn, cur.lastrowid, load_parts(conn, mid))
    save_links(conn, 'maintenance', cur.lastrowid, load_links(conn, 'maintenance', mid))
    conn.commit()
    new_entry = record_out(conn, conn.execute('SELECT * FROM maintenance WHERE id=?',(cur.lastrowid,)).fetchone())
    conn.close()
    return jsonify(new_entry), 201

@app.route('/api/maintenance/<int:mid>/images', methods=['POST'])
@perm_required('can_edit_records')
def add_maintenance_images(mid):
    conn = get_db()
    entry = conn.execute('SELECT car_id FROM maintenance WHERE id=?',(mid,)).fetchone()
    if not entry: conn.close(); return jsonify({'error':'Not found'}), 404
    car = can_access_car(conn, entry['car_id'], g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    added = []
    for f in request.files.getlist('gallery'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,get_file_type(fn))); added.append({'filename':fn,'original_name':f.filename,'file_type':'image'})
    for f in request.files.getlist('documents'):
        fn = save_upload(f,'maintenance')
        if fn: conn.execute('INSERT INTO maintenance_images (maintenance_id,filename,original_name,file_type) VALUES (?,?,?,?)',(mid,fn,f.filename,'document')); added.append({'filename':fn,'original_name':f.filename,'file_type':'document'})
    conn.commit(); conn.close()
    return jsonify(added), 201

@app.route('/api/maintenance/images/<int:iid>', methods=['DELETE'])
@perm_required('can_edit_records')
def delete_maintenance_image(iid):
    conn = get_db()
    img = conn.execute('SELECT * FROM maintenance_images WHERE id=?',(iid,)).fetchone()
    if not img: conn.close(); return jsonify({'error':'Not found'}), 404
    p = os.path.join(app.config['UPLOAD_FOLDER'],'maintenance',img['filename'])
    if os.path.exists(p): os.remove(p)
    conn.execute('DELETE FROM maintenance_images WHERE id=?',(iid,)); conn.commit(); conn.close()
    return jsonify({'success':True})

# ── Service Reminders ──────────────────────────────────
@app.route('/api/cars/<int:cid>/reminders', methods=['GET'])
@login_required
def get_reminders(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    rows = conn.execute('SELECT * FROM service_reminders WHERE car_id=? ORDER BY title', (cid,)).fetchall()
    out = [reminder_out(conn, r) for r in rows]
    conn.close()
    # soonest first, with anything lacking a baseline last
    out.sort(key=reminder_sort_key)
    return jsonify(out)

@app.route('/api/cars/<int:cid>/reminders', methods=['POST'])
@perm_required('can_add_records')
def add_reminder(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    data = request.get_json(silent=True) or request.form
    f, err = parse_reminder_input(data)
    if not err: links, err = parse_links_input(data.get('links'))
    if err: conn.close(); return jsonify({'error': err}), 400
    cur = conn.execute('INSERT INTO service_reminders (car_id,title,interval_type,interval_miles,interval_months,last_done_odometer,last_done_date,notes)'
                       ' VALUES (?,?,?,?,?,?,?,?)',
                       (cid, f['title'], f['interval_type'], f['interval_miles'], f['interval_months'],
                        f['last_done_odometer'], f['last_done_date'], f['notes']))
    if links: save_links(conn, 'reminder', cur.lastrowid, links)
    conn.commit()
    row = conn.execute('SELECT * FROM service_reminders WHERE id=?', (cur.lastrowid,)).fetchone()
    out = reminder_out(conn, row)
    conn.close()
    return jsonify(out), 201

@app.route('/api/reminders/<int:rid>', methods=['PUT'])
@perm_required('can_edit_records')
def update_reminder(rid):
    conn = get_db()
    rem = conn.execute('SELECT * FROM service_reminders WHERE id=?', (rid,)).fetchone()
    if not rem: conn.close(); return jsonify({'error':'Not found'}), 404
    if not can_access_car(conn, rem['car_id'], g.user): conn.close(); return jsonify({'error':'Not found'}), 404
    data = request.get_json(silent=True) or request.form
    f, err = parse_reminder_input(data, rem)
    if not err: links, err = parse_links_input(data.get('links'))
    if err: conn.close(); return jsonify({'error': err}), 400
    if links is not None: save_links(conn, 'reminder', rid, links)
    conn.execute('UPDATE service_reminders SET title=?,interval_type=?,interval_miles=?,interval_months=?,'
                 'last_done_odometer=?,last_done_date=?,notes=? WHERE id=?',
                 (f['title'], f['interval_type'], f['interval_miles'], f['interval_months'],
                  f['last_done_odometer'], f['last_done_date'], f['notes'], rid))
    conn.commit()
    row = conn.execute('SELECT * FROM service_reminders WHERE id=?', (rid,)).fetchone()
    out = reminder_out(conn, row)
    conn.close()
    return jsonify(out)

@app.route('/api/reminders/<int:rid>', methods=['DELETE'])
@perm_required('can_delete_records')
def delete_reminder(rid):
    conn = get_db()
    rem = conn.execute('SELECT * FROM service_reminders WHERE id=?', (rid,)).fetchone()
    if not rem: conn.close(); return jsonify({'error':'Not found'}), 404
    if not can_access_car(conn, rem['car_id'], g.user): conn.close(); return jsonify({'error':'Not found'}), 404
    conn.execute('DELETE FROM service_reminders WHERE id=?', (rid,))
    conn.commit(); conn.close()
    return jsonify({'success': True})

@app.route('/api/reminders/upcoming')
@login_required
def upcoming_reminders():
    """Every reminder across the vehicles this user can see, soonest first."""
    conn = get_db()
    if g.user['role'] == 'admin':
        cars = conn.execute('SELECT * FROM cars').fetchall()
    else:
        cars = conn.execute('SELECT * FROM cars WHERE user_id=?', (g.user['id'],)).fetchall()
    out = []
    for car in cars:
        odo = conn.execute('SELECT MAX(odometer) AS o FROM maintenance WHERE car_id=?', (car['id'],)).fetchone()
        current = odo['o'] if odo and odo['o'] is not None else None
        for r in conn.execute('SELECT * FROM service_reminders WHERE car_id=?', (car['id'],)).fetchall():
            d = reminder_status(conn, r, current)
            d['car_name'] = f"{car['year']} {car['make']} {car['model']}"
            out.append(d)
    conn.close()
    out.sort(key=reminder_sort_key)
    return jsonify({
        'reminders': out,
        'overdue': sum(1 for r in out if r['status'] == 'overdue'),
        'due_soon': sum(1 for r in out if r['status'] == 'due_soon'),
    })

# ── CSV Export ─────────────────────────────────────────
@app.route('/api/cars/<int:cid>/export')
@perm_required('can_export')
def export_csv(cid):
    conn = get_db()
    car = can_access_car(conn, cid, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    entries = conn.execute('SELECT * FROM maintenance WHERE car_id=? ORDER BY service_date DESC',(cid,)).fetchall()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Title','Type','Service Date','Odometer','Vendor','Cost','Notes','Labor','Shipping','Tax','Parts','Links'])
    def part_text(p):
        return ', '.join(x for x in (p['name'], p['vendor'], f"{p['cost']:.2f}" if p['cost'] is not None else '') if x)
    for e in entries:
        parts = '; '.join(part_text(p) for p in load_parts(conn, e['id']))
        writer.writerow([e['title'],e['maintenance_type'],e['service_date'],e['odometer'] or '',e['parts_vendor'] or '',e['cost'] or '',e['notes'] or '',
                         *('' if e[k] is None else e[k] for k in COST_PARTS),parts,
                         '; '.join(link_text(l) for l in load_links(conn, 'maintenance', e['id']))])
    conn.close()
    fname = f"{car['year']}_{car['make']}_{car['model']}_maintenance.csv".replace(' ','_')
    return Response(output.getvalue(), mimetype='text/csv', headers={'Content-Disposition':f'attachment; filename="{fname}"'})

# ── PDF Export ─────────────────────────────────────────
# A printable service history, laid out as HTML and rendered by WeasyPrint.
# One record becomes a record sheet; several become a history with a table of
# every record and a page of detail for each that has notes, parts, photos or receipts.
@app.template_filter('money')
def fmt_money(v):
    return '—' if v is None or v == '' else f'${float(v):,.2f}'

@app.template_filter('num')
def fmt_num(v):
    return '—' if v is None or v == '' else f'{int(float(v)):,}'

@app.template_filter('day')
def fmt_day(v, style='long'):
    """'long' Sep 30, 2026; 'month' Sep 2026."""
    if not v: return '—'
    try: d = v if isinstance(v, date) else date.fromisoformat(str(v)[:10])
    except ValueError: return str(v)
    return f'{calendar.month_abbr[d.month]} {d.year}' if style == 'month' else f'{calendar.month_abbr[d.month]} {d.day}, {d.year}'

PDF_SORTS = {'date_asc':'service_date ASC, id ASC','cost_desc':'cost DESC','cost_asc':'cost ASC','odo_desc':'odometer DESC'}

def pdf_slug(*parts):
    s = '-'.join(str(p) for p in parts if p)
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'export'

def pdf_url_fetcher():
    """A fetcher for local files from the app's static folder and the upload
    folder only. The template builds every URL itself, but a renderer that can
    be talked into fetching anything else is not worth the risk."""
    from weasyprint.urls import URLFetcher
    from urllib.parse import unquote
    roots = [os.path.realpath(app.static_folder), os.path.realpath(app.config['UPLOAD_FOLDER'])]
    class LocalFetcher(URLFetcher):
        def fetch(self, url, headers=None):
            path = os.path.realpath(unquote(url[len('file://'):].split('?')[0])) if url.startswith('file://') else ''
            if not any(path == r or path.startswith(r + os.sep) for r in roots):
                raise ValueError(f'Blocked resource in PDF export: {url}')
            return super().fetch(url, headers)
    return LocalFetcher(allowed_protocols=('file',))

def pdf_load(conn, cid, ids=None):
    """The car (with its owner's name, for admins) and its records in the
    requested order, each with the photos and documents still on disk."""
    car = can_access_car(conn, cid, g.user)
    if not car: return None, None
    car = dict(car)
    car['owner'] = None
    if g.user['role'] == 'admin':
        u = conn.execute('SELECT display_name, username FROM users WHERE id=?', (car['user_id'],)).fetchone()
        car['owner'] = u and (u['display_name'] or u['username'])
    order = PDF_SORTS.get(request.args.get('sort',''), 'service_date DESC, id DESC')
    rows = conn.execute(f'SELECT * FROM maintenance WHERE car_id=? ORDER BY {order}', (cid,)).fetchall()
    if ids is not None: rows = [r for r in rows if r['id'] in ids]
    folder = os.path.join(app.config['UPLOAD_FOLDER'], 'maintenance')
    records = []
    for r in rows:
        d = dict(r)
        files = [dict(f) for f in conn.execute('SELECT * FROM maintenance_images WHERE maintenance_id=? ORDER BY created_at', (r['id'],)).fetchall()]
        d['photos'] = [f for f in files if f['file_type'] != 'document' and os.path.exists(os.path.join(folder, f['filename']))]
        d['documents'] = [f for f in files if f['file_type'] == 'document' and os.path.exists(os.path.join(folder, f['filename']))]
        d['parts'] = load_parts(conn, r['id'])
        d['parts_subtotal'] = sum(p['cost'] or 0 for p in d['parts'])
        d['links'] = load_links(conn, 'maintenance', r['id'])
        records.append(d)
    return car, records

def pdf_render(car, records, font_config=None):
    """One PDF: a record sheet for a single record, a service history for more."""
    from weasyprint import HTML, Attachment   # loaded on first export, not by every worker at start
    by_type = {}
    for r in records:
        t = by_type.setdefault(r['maintenance_type'], {'type': r['maintenance_type'], 'count': 0, 'cost': 0.0})
        t['count'] += 1; t['cost'] += r['cost'] or 0
    dates = sorted(r['service_date'] for r in records if r['service_date'])
    odos = [r['odometer'] for r in records if r['odometer']]
    uploads = os.path.realpath(app.config['UPLOAD_FOLDER'])
    car_photo = None
    if car.get('image') and os.path.exists(os.path.join(uploads, 'cars', car['image'])):
        car_photo = 'file://' + os.path.join(uploads, 'cars', car['image'])
    html = render_template('pdf.html', car=car, car_name=f"{car['year']} {car['make']} {car['model']}",
        car_photo=car_photo, owner=car['owner'], records=records, single=len(records) == 1,
        detailed=[r for r in records if r['notes'] or itemized(r['parts'], r) or r['links'] or r['photos'] or r['documents']],
        total_cost=sum(r['cost'] or 0 for r in records),
        by_type=sorted(by_type.values(), key=lambda t: -t['cost']),
        first_date=dates[0] if dates else None, last_date=dates[-1] if dates else None,
        max_odo=max(odos) if odos else None,
        uploads='file://' + os.path.join(uploads, 'maintenance'),
        static='file://' + os.path.realpath(app.static_folder),
        exported=date.today(), version=APP_VERSION, static_fonts=pdf_static_fonts(), logo=pdf_logo())
    # Receipts travel inside the PDF as document attachments, under the names
    # they were uploaded with, so every viewer lists them in its attachments panel.
    attachments, used = [], set()
    for r in records:
        for d in r['documents']:
            name = d['original_name'] or 'document.pdf'
            stem, ext = os.path.splitext(name); n = 2
            while name.lower() in used: name = f'{stem} ({n}){ext}'; n += 1
            used.add(name.lower())
            attachments.append(Attachment(filename=os.path.join(uploads, 'maintenance', d['filename']),
                name=name, description=f"{r['title']}, {fmt_day(r['service_date'])}"))
    return HTML(string=html, base_url=app.static_folder, url_fetcher=pdf_url_fetcher()).write_pdf(
        optimize_images=True, jpeg_quality=82, dpi=200, attachments=attachments, font_config=font_config)

_pdf_logo = None
def pdf_logo():
    """The logo as inline SVG for the PDF masthead. Its one gradient fades from
    transparent, which WeasyPrint writes as a tiling pattern a millionth of a
    point wide; PDFium (Chrome's viewer) then takes half a minute to draw the
    page. At print size a flat, half-transparent fill looks the same."""
    global _pdf_logo
    if _pdf_logo is None:
        from markupsafe import Markup
        with open(os.path.join(app.static_folder, 'garage-logbook_logo.svg'), encoding='utf-8') as f:
            svg = f.read()
        svg = svg[svg.index('<svg'):].replace('fill:url(#_Linear2);', 'fill:rgb(255,211,29);fill-opacity:0.5;')
        _pdf_logo = Markup(svg)
    return _pdf_logo

def pdf_static_fonts():
    """The weights tools/build-pdf-fonts.py built, or none (variable font) without them."""
    folder = os.path.join(app.static_folder, 'fonts', 'pdf')
    weights = [w for w in (400, 600, 700, 800) if os.path.exists(os.path.join(folder, f'Inter-{w}.ttf'))]
    return weights if len(weights) == 4 else []

def pdf_name(car, record=None):
    if record: return pdf_slug(car['year'], car['make'], car['model'], record['title'], record['service_date']) + '.pdf'
    return pdf_slug(car['year'], car['make'], car['model'], 'service-history') + '.pdf'

def download(body, mimetype, fname):
    return Response(body, mimetype=mimetype, headers={'Content-Disposition': f'attachment; filename="{fname}"'})

# Each PDF takes about a second to render; this many stays well inside the
# worker's 120 second timeout on slower hardware too.
PDF_BATCH_MAX = 50

@app.route('/api/cars/<int:cid>/export.pdf')
@perm_required('can_export')
def export_pdf(cid):
    """Every record of one vehicle, combined into its service history."""
    conn = get_db()
    car, records = pdf_load(conn, cid)
    conn.close()
    if car is None: return jsonify({'error':'Not found'}), 404
    if not records: return jsonify({'error':'This vehicle has no records to export'}), 400
    return download(pdf_render(car, records), 'application/pdf', pdf_name(car, records[0] if len(records) == 1 else None))

@app.route('/api/cars/<int:cid>/export-records')
@perm_required('can_export')
def export_record_pdfs(cid):
    """The chosen records, one PDF each: the PDF itself for one record, a zip
    of them for several, since browsers stop a page saving many files at once."""
    try: ids = {int(x) for x in request.args.get('ids', '').split(',') if x.strip()}
    except ValueError: return jsonify({'error':'Invalid record list'}), 400
    if not ids: return jsonify({'error':'Choose at least one record'}), 400
    if len(ids) > PDF_BATCH_MAX:
        return jsonify({'error':f'Export up to {PDF_BATCH_MAX} records at a time, or use Export all records as one PDF'}), 400
    conn = get_db()
    car, records = pdf_load(conn, cid, ids)
    conn.close()
    if car is None: return jsonify({'error':'Not found'}), 404
    if not records: return jsonify({'error':'No records to export'}), 400
    if len(records) == 1:
        return download(pdf_render(car, records), 'application/pdf', pdf_name(car, records[0]))
    from weasyprint.text.fonts import FontConfiguration
    fonts, buf, used = FontConfiguration(), io.BytesIO(), set()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as z:   # PDFs are compressed already
        for r in records:
            name = pdf_name(car, r); stem = name[:-4]; n = 2
            while name in used: name = f'{stem}-{n}.pdf'; n += 1
            used.add(name)
            z.writestr(name, pdf_render(car, [r], fonts))
    return download(buf.getvalue(), 'application/zip', pdf_slug(car['year'], car['make'], car['model'], 'service-records') + '.zip')

# ── CSV Import (admin + permitted editors) ─────────────
@app.route('/api/import/preview', methods=['POST'])
@perm_required('can_import')
def csv_preview():
    if 'file' not in request.files: return jsonify({'error':'No CSV'}), 400
    file = request.files['file']
    if not file.filename.lower().endswith('.csv'): return jsonify({'error':'Must be .csv'}), 400
    mapping_raw = request.form.get('mapping','{}')
    car_id = request.form.get('car_id','')
    try: mapping = json.loads(mapping_raw)
    except: return jsonify({'error':'Invalid mapping'}), 400
    if not car_id: return jsonify({'error':'Vehicle required'}), 400
    conn = get_db()
    car = can_access_car(conn, car_id, g.user)
    conn.close()
    if not car: return jsonify({'error':'Vehicle not found'}), 404
    try:
        raw = file.read()
        try: text = raw.decode('utf-8-sig')
        except: text = raw.decode('latin-1')
        reader = csv.DictReader(io.StringIO(text))
        csv_headers = reader.fieldnames or []
    except Exception as e: return jsonify({'error':f'Parse error: {e}'}), 400
    if not csv_headers: return jsonify({'error':'No headers'}), 400
    if not mapping or all(v=='' for v in mapping.values()):
        return jsonify({'csv_headers':csv_headers,'row_count':sum(1 for _ in reader),'target_car':dict(car),'preview_rows':[],'errors':[],'valid_count':0})
    db_fields = ['title','maintenance_type','service_date','odometer','parts_vendor','cost','notes']
    field_map = {db_f:csv_c for csv_c,db_f in mapping.items() if db_f in db_fields}
    missing=[]
    if 'title' not in field_map: missing.append('Title')
    if 'service_date' not in field_map: missing.append('Service Date')
    if missing: return jsonify({'error':f'Required: {", ".join(missing)}'}), 400
    valid_types = {'Repair','Maintenance','Upgrade','Inspection'}
    type_map = {'repair':'Repair','maintenance':'Maintenance','upgrade':'Upgrade','service':'Maintenance','mod':'Upgrade','modification':'Upgrade','fix':'Repair','maint':'Maintenance','inspection':'Inspection','inspect':'Inspection'}
    preview_rows=[]; errors=[]; valid_count=0
    file.seek(0)
    try:
        raw=file.read()
        try: text=raw.decode('utf-8-sig')
        except: text=raw.decode('latin-1')
        reader=csv.DictReader(io.StringIO(text))
    except: return jsonify({'error':'Re-read failed'}), 400
    for rn,row in enumerate(reader,start=2):
        rec={}; errs=[]
        tv = row.get(field_map.get('title',''),'').strip()
        if not tv: errs.append('Title empty')
        rec['title']=tv
        if 'maintenance_type' in field_map:
            rt = row.get(field_map['maintenance_type'],'').strip()
            n = type_map.get(rt.lower(),rt)
            if n not in valid_types:
                if rt: errs.append(f'Unknown type "{rt}"')
                n='Maintenance'
            rec['maintenance_type']=n
        else: rec['maintenance_type']='Maintenance'
        if 'service_date' in field_map:
            rd = row.get(field_map['service_date'],'').strip()
            pd = _parse_date(rd)
            if not pd: errs.append(f'Invalid date "{rd}"')
            rec['service_date']=pd or rd
        else: rec['service_date']=''; errs.append('Date empty')
        if 'odometer' in field_map:
            ro = re.sub(r'[^\d.]','',row.get(field_map['odometer'],'').strip())
            if ro:
                try: rec['odometer']=int(float(ro))
                except: errs.append('Bad odo'); rec['odometer']=None
            else: rec['odometer']=None
        else: rec['odometer']=None
        rec['parts_vendor']=row.get(field_map.get('parts_vendor',''),'').strip() or None
        if 'cost' in field_map:
            rc = re.sub(r'[^\d.]','',row.get(field_map['cost'],'').strip())
            if rc:
                try: rec['cost']=round(float(rc),2)
                except: errs.append('Bad cost'); rec['cost']=None
            else: rec['cost']=None
        else: rec['cost']=None
        rec['notes']=row.get(field_map.get('notes',''),'').strip() or None
        crit = any('empty' in e.lower() or 'invalid date' in e.lower() for e in errs)
        rec['_row_num']=rn; rec['_errors']=errs; rec['_valid']=not crit
        if rec['_valid']: valid_count+=1
        preview_rows.append(rec)
        for e in errs: errors.append(f'Row {rn}: {e}')
    return jsonify({'csv_headers':csv_headers,'row_count':len(preview_rows),'target_car':dict(car),'preview_rows':preview_rows,'errors':errors,'valid_count':valid_count})

@app.route('/api/import/commit', methods=['POST'])
@perm_required('can_import')
def csv_commit():
    data = request.get_json() or {}
    car_id=data.get('car_id'); rows=data.get('rows',[])
    if not car_id or not rows: return jsonify({'error':'Car ID and rows required'}), 400
    conn = get_db()
    car = can_access_car(conn, car_id, g.user)
    if not car: conn.close(); return jsonify({'error':'Not found'}), 404
    imported=0; skipped=0
    for r in rows:
        if not r.get('_valid'): skipped+=1; continue
        t=r.get('title','').strip(); mt=r.get('maintenance_type','Maintenance'); sd=r.get('service_date','').strip()
        if not t or not sd: skipped+=1; continue
        if mt not in ('Repair','Maintenance','Upgrade','Inspection'): mt='Maintenance'
        conn.execute('INSERT INTO maintenance (car_id,title,maintenance_type,service_date,odometer,parts_vendor,cost,notes) VALUES (?,?,?,?,?,?,?,?)',
            (car_id,t,mt,sd,r.get('odometer'),r.get('parts_vendor'),r.get('cost'),r.get('notes')))
        imported+=1
    conn.commit(); conn.close()
    return jsonify({'imported':imported,'skipped':skipped})

def _parse_date(raw):
    if not raw: return None
    raw=raw.strip()
    if re.match(r'^\d{4}-\d{2}-\d{2}$',raw): return raw
    m=re.match(r'^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$',raw)
    if m: return f'{m.group(3)}-{m.group(1).zfill(2)}-{m.group(2).zfill(2)}'
    m=re.match(r'^(\d{4})[/](\d{1,2})[/](\d{1,2})$',raw)
    if m: return f'{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}'
    try:
        from datetime import datetime as dt
        for fmt in ('%b %d, %Y','%B %d, %Y','%b %d %Y','%B %d %Y','%d %b %Y','%d %B %Y'):
            try: return dt.strptime(raw,fmt).strftime('%Y-%m-%d')
            except ValueError: continue
    except: pass
    return None

# ── Dashboard Stats (user-scoped) ──────────────────────
@app.route('/api/stats')
@login_required
def get_stats():
    range_filter = request.args.get('range','all')
    conn = get_db()
    date_clause = ''
    if range_filter=='month': date_clause="AND m.service_date >= date('now','start of month')"
    elif range_filter=='year': date_clause="AND m.service_date >= date('now','start of year')"
    # Admins see every vehicle; everyone else only their own. One scope clause
    # serves every query below, so the figures always agree with each other.
    if g.user['role'] == 'admin':
        scope, args = 'WHERE 1=1', ()
        tc = conn.execute('SELECT COUNT(*) as c FROM cars').fetchone()['c']
    else:
        scope, args = 'WHERE c.user_id=?', (g.user['id'],)
        tc = conn.execute('SELECT COUNT(*) as c FROM cars WHERE user_id=?',(g.user['id'],)).fetchone()['c']
    base = f'FROM maintenance m JOIN cars c ON m.car_id=c.id {scope}'
    totals = conn.execute(f'SELECT COUNT(*) AS n, COALESCE(SUM(m.cost),0) AS cost, MAX(m.service_date) AS last {base} {date_clause}', args).fetchone()
    recent = conn.execute(f'SELECT m.*, c.year, c.make, c.model {base} ORDER BY m.service_date DESC, m.id DESC LIMIT 8', args).fetchall()
    by_type = conn.execute(f'SELECT m.maintenance_type AS type, COUNT(*) AS count, COALESCE(SUM(m.cost),0) AS cost {base} {date_clause} GROUP BY m.maintenance_type', args).fetchall()
    # The last twelve calendar months, this one included, with empty months
    # filled in so the chart keeps an even axis.
    rows = conn.execute(f"SELECT strftime('%Y-%m', m.service_date) AS ym, COUNT(*) AS count, COALESCE(SUM(m.cost),0) AS cost {base} AND m.service_date >= date('now','start of month','-11 months') GROUP BY ym", args).fetchall()
    conn.close()
    by_month = {r['ym']: r for r in rows}
    first = date.today().replace(day=1)
    months = []
    for i in range(11, -1, -1):
        y, mo = divmod(first.year * 12 + first.month - 1 - i, 12)
        ym = f'{y:04d}-{mo + 1:02d}'
        r = by_month.get(ym)
        months.append({'month': ym, 'count': r['count'] if r else 0, 'cost': round(r['cost'], 2) if r else 0})
    return jsonify({'total_cars':tc,'total_maintenance':totals['n'],'total_cost':round(totals['cost'],2),
                    'last_service':totals['last'],'recent_entries':[dict(r) for r in recent],
                    'by_type':[{'type':r['type'],'count':r['count'],'cost':round(r['cost'],2)} for r in by_type],
                    'monthly':months})

init_db()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
