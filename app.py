from flask import Flask, render_template, request, redirect, url_for, session, g, flash, jsonify
import sqlite3
import os
import json
from datetime import datetime, timedelta, date
import requests
from bs4 import BeautifulSoup
import re
from functools import wraps

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, 'app.db')

app = Flask(__name__)
app.secret_key = 'secret_key'


# --- База даних ---

def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
    return db


def init_db():
    with app.app_context():
        db = get_db()
        db.execute('''CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        first_name TEXT NOT NULL,
                        last_name TEXT NOT NULL,
                        email TEXT UNIQUE NOT NULL,
                        password TEXT NOT NULL,
                        group_name TEXT,
                        subgroup INTEGER DEFAULT 1
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS events (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        group_name TEXT NOT NULL,
                        title TEXT NOT NULL,
                        type TEXT NOT NULL,
                        date TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT,
                        is_custom INTEGER DEFAULT 1,
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS schedule (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        group_name TEXT NOT NULL,
                        subgroup INTEGER NOT NULL,
                        weekday TEXT NOT NULL,
                        start_time TEXT NOT NULL,
                        end_time TEXT,
                        subject TEXT NOT NULL,
                        subject_type TEXT NOT NULL,
                        location TEXT,
                        week_type TEXT NOT NULL,
                        cached_at TEXT NOT NULL,
                        UNIQUE(group_name, subgroup, weekday, start_time, week_type)
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS schedule_cache (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        group_name TEXT UNIQUE NOT NULL,
                        data TEXT NOT NULL,
                        cached_at TEXT NOT NULL
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS teams (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        creator_id INTEGER NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (creator_id) REFERENCES users(id)
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS team_members (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        team_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        joined_at TEXT NOT NULL,
                        UNIQUE(team_id, user_id),
                        FOREIGN KEY (team_id) REFERENCES teams(id),
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS team_messages (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        team_id INTEGER NOT NULL,
                        user_id INTEGER NOT NULL,
                        message TEXT NOT NULL,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (team_id) REFERENCES teams(id),
                        FOREIGN KEY (user_id) REFERENCES users(id)
                    )''')
        db.execute('''CREATE TABLE IF NOT EXISTS notifications (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        recipient_id INTEGER NOT NULL,
                        type TEXT NOT NULL,
                        title TEXT NOT NULL,
                        message TEXT NOT NULL,
                        related_id INTEGER,
                        is_read INTEGER DEFAULT 0,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (recipient_id) REFERENCES users(id)
                    )''')

        db.commit()


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


# --- Маршрути ---

@app.before_request
def load_logged_in_user():
    user_id = session.get('user_id')
    if user_id is None:
        g.user = None
    else:
        g.user = {
            'id': user_id,
            'first_name': session.get('first_name'),
            'last_name': session.get('last_name')
        }


@app.route('/')
def index():
    user = None
    if 'user_id' in session:
        user = {'id': session['user_id'], 'first_name': session.get('first_name'),
                'last_name': session.get('last_name')}
    return render_template('index.html', user=user)


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        first_name = request.form['first_name']
        last_name = request.form['last_name']
        email = request.form['email']
        password = request.form['password']

        db = get_db()

        existing_user = db.execute('SELECT id FROM users WHERE email = ?', (email,)).fetchone()
        if existing_user:
            error = 'Цей email вже зареєстрований. Спробуйте інший або увійдіть в акаунт.'
            return render_template('register.html', error=error, first_name=first_name, last_name=last_name,
                                   email=email)

        try:
            db.execute('INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
                       (first_name, last_name, email, password))
            db.commit()
            flash('Ви успішно зареєструвались! Увійдіть в акаунт.', 'success')
            return redirect(url_for('login'))
        except Exception as e:
            error = 'Помилка при реєстрації. Спробуйте ще раз.'
            return render_template('register.html', error=error, first_name=first_name, last_name=last_name,
                                   email=email)

    return render_template('register.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        email = request.form['email']
        password = request.form['password']
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE email = ? AND password = ?', (email, password)).fetchone()
        if user:
            session['user_id'] = user['id']
            session['first_name'] = user['first_name']
            session['last_name'] = user['last_name']
            return redirect(url_for('index'))
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    flash('Ви вийшли з облікового запису', 'info')
    return redirect(url_for('index'))


@app.route('/profile', methods=['GET', 'POST'])
def profile():
    if g.user is None:
        return redirect(url_for('login'))

    db = get_db()
    user = db.execute('SELECT * FROM users WHERE id = ?', (g.user['id'],)).fetchone()

    if request.method == 'POST':
        group_name = request.form['group_name']
        subgroup = request.form.get('subgroup', '1')

        import re
        if not re.match(r'^[А-Я]{2}-\d{2}$', group_name):
            error = 'Невірний формат групи. Приклад: AB-12'
            return render_template('profile.html', user=user, error=error)

        db.execute('UPDATE users SET group_name = ?, subgroup = ? WHERE id = ?',
                   (group_name, int(subgroup), g.user['id']))
        db.commit()
        return redirect(url_for('profile'))

    return render_template('profile.html', user=user)


@app.route('/api/user/subgroup', methods=['POST'])
def save_user_subgroup():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    subgroup = request.form.get('subgroup', '1')
    db = get_db()
    db.execute('UPDATE users SET subgroup = ? WHERE id = ?', (int(subgroup), g.user['id']))
    db.commit()
    return jsonify({'success': True})


def detect_subgroup(block_text):
    """Detect which subgroup a class block belongs to (1 or 2, or 0 if no marker)"""
    t = block_text.lower()
    if re.search(r'\b(підгр[^0-9]*1|\b1\s*підгр|\bпідгр\.?\s*1|$$1$$|\b1\/?підгр)\b', t):
        return 1
    if re.search(r'\b(підгр[^0-9]*2|\b2\s*підгр|\bпідгр\.?\s*2|$$2$$|\b2\/?підгр)\b', t):
        return 2
    if re.search(r'\b(i[\.\s]?\s*підгр|ii[\.\s]?\s*підгр)\b', t):
        if re.search(r'i[\.\s]?\s*підгр', t) and not re.search(r'ii', t):
            return 1
        if re.search(r'ii', t):
            return 2
    return 0


def detect_week_type(block_text):
    """Detect week type: 'чисельник', 'знаменник' or None"""
    t = block_text.lower()
    if 'чисел' in t or 'чис.' in t:
        return 'чисельник'
    if 'знамен' in t or 'знам.' in t:
        return 'знаменник'
    return None


def parse_html_schedule(html_text):
    """
    Parse HTML schedule from LPNU and extract all classes.
    Returns list of dicts with: weekday, start_time, end_time, subject, subject_type, location, subgroup, week_type
    """
    soup = BeautifulSoup(html_text, 'html.parser')
    schedule = []

    schedule_items = soup.find_all('div', {'class': 'scheduleitem'})

    if schedule_items:
        for item in schedule_items:
            try:
                # Extract weekday
                weekday_el = item.find('div', {'class': 'day'})
                weekday = weekday_el.get_text(strip=True) if weekday_el else ''

                # Extract time
                time_el = item.find('div', {'class': 'time'})
                time_text = time_el.get_text(strip=True) if time_el else ''
                start_time = time_text.split('-')[0].strip() if '-' in time_text else time_text
                end_time = time_text.split('-')[1].strip() if '-' in time_text else ''

                # Extract subject
                subject_el = item.find('div', {'class': 'subject'})
                subject = subject_el.get_text(strip=True) if subject_el else ''

                # Extract type
                type_el = item.find('div', {'class': 'type'})
                type_text = type_el.get_text(strip=True) if type_el else ''

                subject_type = 'Інше'
                if 'лекц' in type_text.lower():
                    subject_type = 'Лекція'
                elif 'практ' in type_text.lower():
                    subject_type = 'Практична'
                elif 'лаб' in type_text.lower():
                    subject_type = 'Лабораторна'

                # Extract location
                location_el = item.find('div', {'class': 'location'})
                location = location_el.get_text(strip=True) if location_el else ''

                # Check for subgroup markers
                full_text = item.get_text(strip=True).lower()
                subgroup = 0
                if 'підгр' in full_text:
                    if '1' in full_text[:full_text.find('підгр') + 10]:
                        subgroup = 1
                    elif '2' in full_text[:full_text.find('підгр') + 10]:
                        subgroup = 2

                # Check for week type
                week_type = 'обидва'
                if 'чисел' in full_text:
                    week_type = 'чисельник'
                elif 'знамен' in full_text:
                    week_type = 'знаменник'

                if not subject:
                    continue

                # Create entry for each applicable subgroup
                for sub in ([subgroup] if subgroup > 0 else [1, 2]):
                    schedule.append({
                        'weekday': weekday,
                        'start_time': start_time,
                        'end_time': end_time,
                        'subject': subject,
                        'subject_type': subject_type,
                        'location': location,
                        'subgroup': sub,
                        'week_type': week_type
                    })
            except Exception as e:
                print(f"[v0] Error parsing schedule item: {e}")
                continue

    if not schedule:
        print("[v0] No scheduleitem divs found, trying table parsing")
        table = soup.find('table')
        if table:
            rows = table.find_all('tr')
            if len(rows) >= 2:
                header_cells = rows[0].find_all(['th', 'td'])
                weekdays = [cell.get_text(strip=True) for cell in header_cells]

                for r_idx in range(1, len(rows)):
                    cells = rows[r_idx].find_all(['td', 'th'])
                    if not cells:
                        continue

                    time_text = cells[0].get_text(strip=True) if cells else ''
                    start_time = time_text.split('-')[0].strip() if '-' in time_text else time_text
                    end_time = time_text.split('-')[1].strip() if '-' in time_text else ''

                    for day_idx in range(min(len(weekdays), len(cells) - 1)):
                        cell = cells[day_idx + 1]
                        raw_text = cell.get_text(strip=True)

                        if not raw_text:
                            continue

                        blocks = re.split(r'\n{2,}', raw_text)
                        for block in blocks:
                            block = block.strip()
                            if not block:
                                continue

                            lines = block.split('\n')
                            lines = [line.strip() for line in lines if line.strip()]

                            subject = lines[0] if lines else ''
                            subject_type = 'Інше'
                            if lines:
                                last_line = lines[-1].lower()
                                if 'лекц' in last_line:
                                    subject_type = 'Лекція'
                                elif 'практ' in last_line:
                                    subject_type = 'Практична'
                                elif 'лаб' in last_line:
                                    subject_type = 'Лабораторна'

                            location = lines[1] if len(lines) > 2 else ''

                            subgroup = 0
                            if '1' in block:
                                subgroup = 1
                            elif '2' in block:
                                subgroup = 2

                            for sub in ([subgroup] if subgroup > 0 else [1, 2]):
                                schedule.append({
                                    'weekday': weekdays[day_idx] if day_idx < len(weekdays) else '',
                                    'start_time': start_time,
                                    'end_time': end_time,
                                    'subject': subject,
                                    'subject_type': subject_type,
                                    'location': location,
                                    'subgroup': sub,
                                    'week_type': 'обидва'
                                })

    print(f"[v0] Parsed {len(schedule)} schedule items")
    return schedule


def fetch_and_cache_schedule(group_name):
    """Fetch schedule from LPNU and cache it in database"""
    try:
        url = "https://student.lpnu.ua/students_schedule"
        params = {
            'studygroup_abbrname': group_name,
            'semestr': '1',
            'semestrduration': '1'
        }

        response = requests.get(url, params=params, timeout=10)
        response.encoding = 'utf-8'

        if response.status_code != 200:
            return False

        # Parse the HTML
        schedule_rows = parse_html_schedule(response.text)

        if not schedule_rows:
            return False

        # Clear old schedule for this group
        db = get_db()
        db.execute('DELETE FROM schedule WHERE group_name = ?', (group_name,))

        # Insert new schedule
        now = datetime.now().isoformat()
        for row in schedule_rows:
            db.execute('''INSERT INTO schedule 
                         (group_name, subgroup, weekday, start_time, end_time, subject, subject_type, location, week_type, cached_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                       (group_name, row['subgroup'], row['weekday'], row['start_time'], row['end_time'],
                        row['subject'], row['subject_type'], row['location'], row['week_type'], now))

        db.commit()
        return True
    except Exception as e:
        print(f"Error fetching schedule: {e}")
        return False


def get_current_week_type():
    """Determine if it's чисельник or знаменник week"""
    # Simplified: use date to determine week type
    # Week 1 of semester = чисельник, Week 2 = знаменник, etc.
    # You may need to adjust based on actual semester start date
    week_num = datetime.now().isocalendar()[1]
    return 'чисельник' if week_num % 2 == 1 else 'знаменник'


def fetch_lpnu_schedule(group_name, subgroup=1):
    """
    Fetch schedule from database for a specific group and subgroup.
    """
    try:
        db = get_db()

        # Check if we have cached data
        cached = db.execute('SELECT cached_at FROM schedule WHERE group_name = ? LIMIT 1',
                            (group_name,)).fetchone()

        # If no cache or cache is older than 24 hours, fetch fresh data
        if not cached:
            fetch_and_cache_schedule(group_name)
        else:
            cached_time = datetime.fromisoformat(cached['cached_at'])
            if (datetime.now() - cached_time).total_seconds() > 86400:  # 24 hours
                fetch_and_cache_schedule(group_name)

        # Get schedule for subgroup
        week_type = get_current_week_type()
        rows = db.execute('''SELECT * FROM schedule 
                            WHERE group_name = ? AND subgroup = ? AND week_type IN (?, 'обидва')
                            ORDER BY weekday, start_time''',
                          (group_name, subgroup, week_type)).fetchall()

        events = []
        for row in rows:
            # Map weekday names to weekday numbers
            weekday_map = {
                'Понеділок': 0, 'Вівторок': 1, 'Середа': 2, 'Четвер': 3,
                "П'ятниця": 4, 'Субота': 5, 'Неділя': 6
            }

            # Find next occurrence of this weekday
            today = datetime.now()
            weekday_num = weekday_map.get(row['weekday'], 0)
            days_ahead = weekday_num - today.weekday()
            if days_ahead <= 0:
                days_ahead += 7

            event_date = (today + timedelta(days=days_ahead)).strftime('%Y-%m-%d')

            events.append({
                'id': row['id'],
                'date': event_date,
                'start_time': row['start_time'],
                'end_time': row['end_time'],
                'title': row['subject'],
                'type': 'lecture' if row['subject_type'] == 'Лекція' else (
                    'practical' if row['subject_type'] == 'Практична' else 'lab'),
                'location': row['location'],
                'is_custom': 0
            })

        return events

    except Exception as e:
        print(f"Error fetching schedule: {e}")
        return []


@app.route('/api/schedule/<group_name>')
def get_schedule(group_name):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    # Get subgroup from query params or user profile
    req_sub = int(request.args.get('subgroup', '0'))
    if req_sub == 0:
        db = get_db()
        user = db.execute('SELECT subgroup FROM users WHERE id = ?', (g.user['id'],)).fetchone()
        req_sub = user['subgroup'] if user else 1

    try:
        db = get_db()

        # Fetch all raw schedule rows for this group
        raw_rows = db.execute('''SELECT * FROM schedule WHERE group_name = ?''',
                              (group_name,)).fetchall()

        # Convert to list of dicts
        schedule_data = [dict(row) for row in raw_rows]

        # Determine current semester dates
        today = date.today()
        sem1_year = today.year if today.month >= 9 else today.year - 1
        sem1_start = date(sem1_year, 9, 1)
        sem1_end = date(sem1_year, 12, 20)

        # Expand template rows to concrete dates
        expanded = expand_template_rows_to_dates(schedule_data, sem1_start, sem1_end)

        # Filter by subgroup: include if subgroup==0 (for all) or subgroup matches request
        filtered_rows = [row for row in expanded if row.get('subgroup', 0) == 0 or row.get('subgroup', 0) == req_sub]

        # Format as FullCalendar events
        events = []
        for idx, row in enumerate(filtered_rows):
            event_date = row.get('date', '')
            start_time = row.get('start_time', '08:00')
            end_time = row.get('end_time', '09:50')

            if event_date and start_time:
                start_iso = f"{event_date}T{start_time}:00"
                end_iso = f"{event_date}T{end_time}:00" if end_time else f"{event_date}T09:50:00"

                event_type = row.get('subject_type', 'Інше').lower()
                if 'лекц' in event_type:
                    class_name = ['event-lecture']
                elif 'практ' in event_type:
                    class_name = ['event-practical']
                elif 'лаб' in event_type:
                    class_name = ['event-lab']
                else:
                    class_name = ['event-other']

                events.append({
                    'id': f"lpnu_{idx}_{row.get('id', idx)}",
                    'title': row.get('subject', 'Дисципліна'),
                    'start': start_iso,
                    'end': end_iso,
                    'allDay': False,
                    'extendedProps': {
                        'location': row.get('location', ''),
                        'type': row.get('subject_type', 'Інше'),
                        'subgroup': row.get('subgroup', 0),
                        'raw': row
                    },
                    'className': class_name
                })

        # Fetch custom user events
        custom_events_rows = db.execute('SELECT * FROM events WHERE user_id = ? AND group_name = ?',
                                        (g.user['id'], group_name)).fetchall()

        custom_events = []
        for row in custom_events_rows:
            row_dict = dict(row)
            if row_dict.get('date') and row_dict.get('start_time'):
                start_iso = f"{row_dict['date']}T{row_dict['start_time']}:00"
                end_iso = f"{row_dict['date']}T{row_dict.get('end_time', '09:50')}:00" if row_dict.get(
                    'end_time') else None

                custom_events.append({
                    'id': f"custom_{row_dict['id']}",
                    'title': row_dict['title'],
                    'start': start_iso,
                    'end': end_iso,
                    'allDay': False,
                    'extendedProps': {
                        'location': '',
                        'type': row_dict.get('type', 'Інше'),
                        'subgroup': 0,
                        'raw': row_dict
                    },
                    'className': [f"event-{row_dict.get('type', 'other')}"]
                })

        return jsonify({
            'events': events + custom_events,
            'schedule': filtered_rows,
            'custom_events': custom_events
        })

    except Exception as e:
        print(f"[v0] Error in get_schedule: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e), 'events': [], 'schedule': [], 'custom_events': []}), 500


@app.route('/api/event', methods=['POST'])
def save_event():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.json
    db = get_db()

    if data.get('id'):
        # Update existing event
        db.execute('UPDATE events SET title = ?, type = ?, start_time = ?, end_time = ? WHERE id = ? AND user_id = ?',
                   (data['title'], data['type'], data['start_time'], data.get('end_time'), data['id'], g.user['id']))
    else:
        # Create new event
        db.execute(
            'INSERT INTO events (user_id, group_name, title, type, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (g.user['id'], data['group_name'], data['title'], data['type'], data['date'], data['start_time'],
             data.get('end_time')))

    db.commit()
    return jsonify({'success': True})


@app.route('/api/event/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    db.execute('DELETE FROM events WHERE id = ? AND user_id = ?', (event_id, g.user['id']))
    db.commit()
    return jsonify({'success': True})


@app.route('/schedule')
def schedule():
    if g.user is None:
        return redirect(url_for('login'))

    db = get_db()
    user = db.execute('SELECT group_name, subgroup FROM users WHERE id = ?', (g.user['id'],)).fetchone()
    current_user_group = user['group_name'] if user and user['group_name'] else ''
    current_user_subgroup = user['subgroup'] if user and user['subgroup'] else 1

    return render_template('schedule.html', current_user_group=current_user_group,
                           current_user_subgroup=current_user_subgroup)


@app.route('/groups')
def groups():
    # Поки пусто
    return render_template('groups.html')


@app.route('/teams')
def teams():
    if g.user is None:
        return redirect(url_for('login'))

    db = get_db()
    # Get all teams where user is a member
    user_teams = db.execute('''
        SELECT t.* FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        WHERE tm.user_id = ?
        ORDER BY t.created_at DESC
    ''', (g.user['id'],)).fetchall()

    return render_template('teams.html', teams=user_teams)


@app.route('/api/teams', methods=['POST'])
def create_team():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json()
    team_name = data.get('name', '').strip()

    if not team_name or len(team_name) > 100:
        return jsonify({'error': 'Invalid team name'}), 400

    try:
        db = get_db()
        now = datetime.now().isoformat()

        cursor = db.execute('''INSERT INTO teams (name, creator_id, created_at)
                             VALUES (?, ?, ?)''',
                            (team_name, g.user['id'], now))
        team_id = cursor.lastrowid

        # Add creator as member
        db.execute('''INSERT INTO team_members (team_id, user_id, joined_at)
                     VALUES (?, ?, ?)''',
                   (team_id, g.user['id'], now))

        db.commit()
        return jsonify({'success': True, 'team_id': team_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/team/<int:team_id>')
def team_chat(team_id):
    if g.user is None:
        return redirect(url_for('login'))

    db = get_db()

    # Check if user is member of team
    member = db.execute('''
        SELECT * FROM team_members
        WHERE team_id = ? AND user_id = ?
    ''', (team_id, g.user['id'])).fetchone()

    if not member:
        flash('Ви не маєте доступу до цієї команди', 'error')
        return redirect(url_for('teams'))

    team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()
    is_creator = team['creator_id'] == g.user['id']

    # Get team members
    members = db.execute('''
        SELECT u.id, u.first_name, u.last_name FROM team_members tm
        JOIN users u ON tm.user_id = u.id
        WHERE tm.team_id = ?
        ORDER BY u.first_name
    ''', (team_id,)).fetchall()

    # Get messages
    messages = db.execute('''
        SELECT m.*, u.first_name, u.last_name FROM team_messages m
        JOIN users u ON m.user_id = u.id
        WHERE m.team_id = ?
        ORDER BY m.created_at ASC
    ''', (team_id,)).fetchall()

    return render_template('team-chat.html', team=team, is_creator=is_creator,
                           members=members, messages=messages)


@app.route('/api/team/<int:team_id>/message', methods=['POST'])
def send_team_message(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()

    # Check membership
    member = db.execute('''
        SELECT * FROM team_members
        WHERE team_id = ? AND user_id = ?
    ''', (team_id, g.user['id'])).fetchone()

    if not member:
        return jsonify({'error': 'Not a member'}), 403

    data = request.get_json()
    message = data.get('message', '').strip()

    if not message or len(message) > 5000:
        return jsonify({'error': 'Invalid message'}), 400

    try:
        now = datetime.now().isoformat()
        db.execute('''INSERT INTO team_messages (team_id, user_id, message, created_at)
                     VALUES (?, ?, ?, ?)''',
                   (team_id, g.user['id'], message, now))

        team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()
        team_members = db.execute('''
            SELECT user_id FROM team_members WHERE team_id = ? AND user_id != ?
        ''', (team_id, g.user['id'])).fetchall()

        for member_row in team_members:
            recipient_id = member_row['user_id']
            db.execute('''
                INSERT INTO notifications (recipient_id, type, title, message, related_id, created_at)
                VALUES (?, 'team_message', ?, ?, ?, ?)
            ''', (recipient_id,
                  f"Нове повідомлення в '{team['name']}'",
                  f"{g.user['first_name']} {g.user['last_name']}: {message[:100]}",
                  team_id,
                  now))

        db.commit()

        return jsonify({'success': True, 'message': {
            'id': db.execute('SELECT last_insert_rowid()').fetchone()[0],
            'user_id': g.user['id'],
            'first_name': g.user['first_name'],
            'last_name': g.user['last_name'],
            'message': message,
            'created_at': now
        }})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/team/<int:team_id>/add-member', methods=['POST'])
def add_team_member(team_id):
    db = get_db()
    data = request.json
    email = data.get('email', '').strip()

    if not email:
        return jsonify({'error': 'Email required'}), 400

    # Check if team exists and user is creator
    cursor = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,))
    team = cursor.fetchone()

    if not team or team['creator_id'] != g.user['id']:
        return jsonify({'error': 'Unauthorized'}), 403

    # Find user by email
    cursor = db.execute('SELECT * FROM users WHERE email = ?', (email,))
    user = cursor.fetchone()

    if not user:
        return jsonify({'error': 'User not found'}), 404

    if user['id'] == g.user['id']:
        return jsonify({'error': 'Cannot invite yourself'}), 400

    # Check if already member
    cursor = db.execute('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
                        (team_id, user['id']))
    if cursor.fetchone():
        return jsonify({'error': 'User already in team'}), 400

    # Send invite notification
    db.execute('''
        INSERT INTO notifications (recipient_id, type, title, message, related_id, created_at)
        VALUES (?, 'team_invite', ?, ?, ?, ?)
    ''', (user['id'],
          f"Запрошення до команди '{team['name']}'",
          f"{g.user['first_name']} {g.user['last_name']} запрошує вас до команди '{team['name']}'",
          team_id,
          datetime.now().isoformat()))
    db.commit()

    return jsonify({'status': 'ok', 'message': 'Invite sent'})


@app.route('/api/team/<int:team_id>/remove-member/<int:member_id>', methods=['DELETE'])
def remove_team_member(team_id, member_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()

    if not team or team['creator_id'] != g.user['id']:
        return jsonify({'error': 'Only creator can remove members'}), 403

    if member_id == team['creator_id']:
        return jsonify({'error': 'Cannot remove creator'}), 400

    try:
        db.execute('''DELETE FROM team_members
                     WHERE team_id = ? AND user_id = ?''',
                   (team_id, member_id))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/team/<int:team_id>/leave', methods=['POST'])
def leave_team(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()

    if team['creator_id'] == g.user['id']:
        return jsonify({'error': 'Creator cannot leave team'}), 400

    try:
        db.execute('''DELETE FROM team_members
                     WHERE team_id = ? AND user_id = ?''',
                   (team_id, g.user['id']))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/team/<int:team_id>/rename', methods=['POST'])
def rename_team(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()

    if not team or team['creator_id'] != g.user['id']:
        return jsonify({'error': 'Only creator can rename team'}), 403

    data = request.get_json()
    new_name = data.get('name', '').strip()

    if not new_name or len(new_name) > 100:
        return jsonify({'error': 'Invalid team name'}), 400

    try:
        db.execute('UPDATE teams SET name = ? WHERE id = ?', (new_name, team_id))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/team/<int:team_id>/disband', methods=['POST'])
def disband_team(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    team = db.execute('SELECT * FROM teams WHERE id = ?', (team_id,)).fetchone()

    if not team or team['creator_id'] != g.user['id']:
        return jsonify({'error': 'Only creator can disband team'}), 403

    try:
        db.execute('DELETE FROM team_messages WHERE team_id = ?', (team_id,))
        db.execute('DELETE FROM team_members WHERE team_id = ?', (team_id,))
        db.execute('DELETE FROM teams WHERE id = ?', (team_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/notifications/unread-count', methods=['GET'])
def get_unread_count():
    db = get_db()
    cursor = db.execute(
        'SELECT COUNT(*) as count FROM notifications WHERE recipient_id = ? AND is_read = 0',
        (g.user['id'],)
    )
    count = cursor.fetchone()['count']
    return jsonify({'count': count})


@app.route('/api/notifications', methods=['GET'])
def get_notifications():
    db = get_db()
    cursor = db.execute('''
        SELECT * FROM notifications 
        WHERE recipient_id = ? 
        ORDER BY created_at DESC
    ''', (g.user['id'],))
    notifications = cursor.fetchall()
    return jsonify([dict(n) for n in notifications])


@app.route('/api/notification/<int:notif_id>/read', methods=['POST'])
def mark_notification_read(notif_id):
    db = get_db()
    db.execute('UPDATE notifications SET is_read = 1 WHERE id = ? AND recipient_id = ?',
               (notif_id, g.user['id']))
    db.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/notification/<int:notif_id>/delete', methods=['DELETE'])
def delete_notification(notif_id):
    db = get_db()
    db.execute('DELETE FROM notifications WHERE id = ? AND recipient_id = ?',
               (notif_id, g.user['id']))
    db.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/notification/<int:notif_id>/team-invite/accept', methods=['POST'])
def accept_team_invite(notif_id):
    db = get_db()

    # Get notification
    cursor = db.execute('SELECT * FROM notifications WHERE id = ? AND recipient_id = ?',
                        (notif_id, g.user['id']))
    notif = cursor.fetchone()

    if not notif or notif['type'] != 'team_invite':
        return jsonify({'error': 'Invalid notification'}), 400

    team_id = notif['related_id']

    # Check if already member
    cursor = db.execute('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
                        (team_id, g.user['id']))
    if cursor.fetchone():
        return jsonify({'error': 'Already a member'}), 400

    # Add to team
    db.execute('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)',
               (team_id, g.user['id'], datetime.now().isoformat()))
    db.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', (notif_id,))
    db.commit()

    return jsonify({'status': 'ok'})


def week_parity_for_date(date_obj, sem_start):
    """
    Calculate week parity (чисельник/знаменник) for a given date.
    Week 1 (odd) = чисельник, Week 2 (even) = знаменник, etc.
    """
    days_since_start = (date_obj - sem_start).days
    week_num = (days_since_start // 7) + 1
    return 'чисельник' if week_num % 2 == 1 else 'знаменник'


def expand_template_rows_to_dates(schedule_data, sem_start, sem_end, first_week='знаменник'):
    """
    Expand template schedule rows (with weekday names) to concrete dates.
    Returns list of events for each date in the semester.
    """
    weekday_map = {
        'Понеділок': 0, 'Пн': 0,
        'Вівторок': 1, 'Вт': 1,
        'Середа': 2, 'Ср': 2,
        'Четвер': 3, 'Чт': 3,
        "П'ятниця": 4, 'Пт': 4,
        'Субота': 5, 'Сб': 5,
        'Неділя': 6, 'Нд': 6
    }

    expanded = []
    current_date = sem_start

    while current_date <= sem_end:
        weekday_num = current_date.weekday()
        current_parity = week_parity_for_date(current_date, sem_start)

        for row in schedule_data:
            template_weekday = row.get('weekday', '').strip()
            template_parity = row.get('week_type', 'обидва')

            # Find matching weekday
            found_weekday = False
            for uk_name, num in weekday_map.items():
                if uk_name.lower() in template_weekday.lower():
                    found_weekday = (num == weekday_num)
                    break

            if not found_weekday:
                continue

            # Check if parity matches
            if template_parity != 'обидва' and template_parity != current_parity:
                continue

            # Add expanded event
            expanded_row = dict(row)
            expanded_row['date'] = current_date.isoformat()
            expanded.append(expanded_row)

        current_date += timedelta(days=1)

    return expanded


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if g.user is None:
            return jsonify({'error': 'Not authenticated'}), 401
        return f(*args, **kwargs)

    return decorated_function


if __name__ == '__main__':
    init_db()
    app.run(debug=True)
