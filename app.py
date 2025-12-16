from flask import Flask, render_template, request, redirect, url_for, session, g, flash, jsonify
import sqlite3
import os
import json
from datetime import datetime, timedelta, date
import requests
from bs4 import BeautifulSoup
import re

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
def api_user_subgroup():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        if request.is_json:
            data = request.get_json()
            subgroup = int(data.get('subgroup', 1))
        else:
            subgroup = int(request.form.get('subgroup', request.args.get('subgroup', 1)))
    except:
        subgroup = 1

    db = get_db()
    try:
        db.execute('UPDATE users SET subgroup = ? WHERE id = ?', (subgroup, g.user['id']))
        db.commit()
        session['subgroup'] = subgroup
        return jsonify({'success': True, 'subgroup': subgroup})
    except Exception as e:
        print(f"Error saving subgroup: {e}")
        return jsonify({'error': 'db_error'}), 500

def detect_subgroup(block_text):
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
    t = block_text.lower()
    if 'чисел' in t or 'чис.' in t:
        return 'чисельник'
    if 'знамен' in t or 'знам.' in t:
        return 'знаменник'
    return None


def parse_html_schedule(html_text):
    soup = BeautifulSoup(html_text, 'html.parser')
    schedule = []

    schedule_items = soup.find_all('div', {'class': 'scheduleitem'})

    if schedule_items:
        for item in schedule_items:
            try:
                weekday_el = item.find('div', {'class': 'day'})
                weekday = weekday_el.get_text(strip=True) if weekday_el else ''

                time_el = item.find('div', {'class': 'time'})
                time_text = time_el.get_text(strip=True) if time_el else ''
                start_time = time_text.split('-')[0].strip() if '-' in time_text else time_text
                end_time = time_text.split('-')[1].strip() if '-' in time_text else ''

                subject_el = item.find('div', {'class': 'subject'})
                subject = subject_el.get_text(strip=True) if subject_el else ''

                type_el = item.find('div', {'class': 'type'})
                type_text = type_el.get_text(strip=True) if type_el else ''

                subject_type = 'Інше'
                if 'лекц' in type_text.lower():
                    subject_type = 'Лекція'
                elif 'практ' in type_text.lower():
                    subject_type = 'Практична'
                elif 'лаб' in type_text.lower():
                    subject_type = 'Лабораторна'

                location_el = item.find('div', {'class': 'location'})
                location = location_el.get_text(strip=True) if location_el else ''

                full_text = item.get_text(strip=True).lower()
                subgroup = 0
                if 'підгр' in full_text:
                    if '1' in full_text[:full_text.find('підгр') + 10]:
                        subgroup = 1
                    elif '2' in full_text[:full_text.find('підгр') + 10]:
                        subgroup = 2

                week_type = 'обидва'
                if 'чисел' in full_text:
                    week_type = 'чисельник'
                elif 'знамен' in full_text:
                    week_type = 'знаменник'

                if not subject:
                    continue

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
                print(f"Error parsing schedule item: {e}")
                continue

    if not schedule:
        print("No scheduleitem divs found, trying table parsing")
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

    print(f"Parsed {len(schedule)} schedule items")
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

        schedule_rows = parse_html_schedule(response.text)

        if not schedule_rows:
            return False

        db = get_db()
        db.execute('DELETE FROM schedule WHERE group_name = ?', (group_name,))

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
    week_num = datetime.now().isocalendar()[1]
    return 'чисельник' if week_num % 2 == 1 else 'знаменник'


def fetch_lpnu_schedule(group_name, subgroup=1):
    try:
        db = get_db()

        cached = db.execute('SELECT cached_at FROM schedule WHERE group_name = ? LIMIT 1',
                            (group_name,)).fetchone()

        if not cached:
            fetch_and_cache_schedule(group_name)
        else:
            cached_time = datetime.fromisoformat(cached['cached_at'])
            if (datetime.now() - cached_time).total_seconds() > 86400:  # 24 hours
                fetch_and_cache_schedule(group_name)

        week_type = get_current_week_type()
        rows = db.execute('''SELECT * FROM schedule 
                            WHERE group_name = ? AND subgroup = ? AND week_type IN (?, 'обидва')
                            ORDER BY weekday, start_time''',
                          (group_name, subgroup, week_type)).fetchall()

        events = []
        for row in rows:
            weekday_map = {
                'Понеділок': 0, 'Вівторок': 1, 'Середа': 2, 'Четвер': 3,
                "П'ятниця": 4, 'Субота': 5, 'Неділя': 6
            }

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

def week_parity_for_date(date_obj, sem_start):
    days_since_start = (date_obj - sem_start).days
    week_num = (days_since_start // 7) + 1
    return 'знаменник' if week_num % 2 == 1 else 'чисельник'


def expand_template_rows_to_dates(schedule_data, sem_start, sem_end, first_week='знаменник'):
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

            found_weekday = False
            for uk_name, num in weekday_map.items():
                if uk_name.lower() in template_weekday.lower():
                    found_weekday = (num == weekday_num)
                    break

            if not found_weekday:
                continue

            if template_parity != 'обидва' and template_parity != current_parity:
                continue

            expanded_row = dict(row)
            expanded_row['date'] = current_date.isoformat()
            expanded.append(expanded_row)

        current_date += timedelta(days=1)

    return expanded

@app.route('/api/schedule/<group_name>')
def get_schedule(group_name):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    req_sub = int(request.args.get('subgroup', '0'))
    if req_sub == 0:
        db = get_db()
        user = db.execute('SELECT subgroup FROM users WHERE id = ?', (g.user['id'],)).fetchone()
        req_sub = user['subgroup'] if user else 1

    try:
        db = get_db()

        raw_rows = db.execute('''SELECT * FROM schedule WHERE group_name = ?''',
                              (group_name,)).fetchall()

        schedule_data = [dict(row) for row in raw_rows]

        today = date.today()
        sem1_year = today.year if today.month >= 9 else today.year - 1
        sem1_start = date(sem1_year, 9, 1)
        sem1_end = date(sem1_year, 12, 20)

        expanded = expand_template_rows_to_dates(schedule_data, sem1_start, sem1_end)

        filtered_rows = [row for row in expanded if row.get('subgroup', 0) == 0 or row.get('subgroup', 0) == req_sub]

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
        print(f"Error in get_schedule: {e}")
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
        incoming_id = data['id']
        try:
            if isinstance(incoming_id, str) and incoming_id.startswith('custom_'):
                event_id = int(incoming_id.split('_', 1)[1])
            else:
                event_id = int(incoming_id)
        except Exception:
            return jsonify({'error': 'invalid_id'}), 400

        db.execute(
            'UPDATE events SET title = ?, type = ?, date = ?, start_time = ?, end_time = ? WHERE id = ? AND user_id = ?',
            (data['title'], data['type'], data.get('date'), data['start_time'], data.get('end_time'), event_id, g.user['id'])
        )
    else:
        db.execute(
            'INSERT INTO events (user_id, group_name, title, type, date, start_time, end_time) VALUES (?, ?, ?, ?, ?, ?, ?)',
            (g.user['id'], data['group_name'], data['title'], data['type'], data['date'], data['start_time'],
             data.get('end_time'))
        )

    db.commit()
    return jsonify({'success': True})


@app.route('/api/event/<event_id>', methods=['DELETE'])
def delete_event(event_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    try:
        if isinstance(event_id, str) and event_id.startswith('custom_'):
            eid = int(event_id.split('_', 1)[1])
        else:
            eid = int(event_id)
    except Exception:
        return jsonify({'error': 'invalid_id'}), 400

    db = get_db()
    db.execute('DELETE FROM events WHERE id = ? AND user_id = ?', (eid, g.user['id']))
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


if __name__ == '__main__':
    init_db()
    app.run(debug=True)



