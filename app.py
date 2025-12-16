from flask import Flask, render_template, request, redirect, url_for, session, g, flash, jsonify
import sqlite3
import os
import json
from datetime import datetime, timedelta
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
                        group_name TEXT
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
        import re
        if not re.match(r'^[А-Я]{2}-\d{2}$', group_name):
            error = 'Невірний формат групи. Приклад: AB-12'
            return render_template('profile.html', user=g.user, error=error)
        db.execute('UPDATE users SET group_name = ? WHERE id = ?', (group_name, g.user['id']))
        db.commit()
        return redirect(url_for('profile'))

    return render_template('profile.html', user=user)


def fetch_lpnu_schedule(group_name, subgroup=1):
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
            return []

        soup = BeautifulSoup(response.content, 'html.parser')
        events = []

        schedule_table = soup.find('table', {'class': 'schedule-table'})
        if not schedule_table:
            return []

        rows = schedule_table.find_all('tr')

        for row in rows:
            cells = row.find_all('td')
            if len(cells) < 5:
                continue

            date_str = cells[0].get_text(strip=True)
            time_str = cells[1].get_text(strip=True)
            subject = cells[2].get_text(strip=True)
            subject_type = cells[3].get_text(strip=True)
            location = cells[4].get_text(strip=True)

            subgroup_info = cells[5].get_text(strip=True) if len(cells) > 5 else ''
            if subgroup_info and str(subgroup) not in subgroup_info:
                continue

            if not date_str or not time_str or not subject:
                continue

            try:
                event_date = datetime.strptime(date_str, '%d.%m.%Y').strftime('%Y-%m-%d')
            except:
                continue

            time_match = re.search(r'(\d{2}):(\d{2})', time_str)
            if not time_match:
                continue
            start_time = f"{time_match.group(1)}:{time_match.group(2)}"

            event_type = 'lecture'
            type_lower = subject_type.lower()
            if 'практ' in type_lower:
                event_type = 'practical'
            elif 'лаб' in type_lower:
                event_type = 'lab'

            events.append({
                'date': event_date,
                'start_time': start_time,
                'title': subject,
                'type': event_type,
                'location': location,
                'is_custom': 0
            })

        return events

    except Exception as e:
        print(f"Error fetching LPNU schedule: {e}")
        return []


@app.route('/api/schedule/<group_name>')
def get_schedule(group_name):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    subgroup = request.args.get('subgroup', '1')

    schedule_data = fetch_lpnu_schedule(group_name, subgroup)

    db = get_db()
    custom_events = db.execute('SELECT * FROM events WHERE user_id = ? AND group_name = ?',
                               (g.user['id'], group_name)).fetchall()

    return jsonify({
        'schedule': schedule_data,
        'custom_events': [dict(e) for e in custom_events]
    })


@app.route('/api/event', methods=['POST'])
def save_event():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.json
    db = get_db()

    if data.get('id'):
        db.execute('UPDATE events SET title = ?, type = ?, start_time = ?, end_time = ? WHERE id = ? AND user_id = ?',
                   (data['title'], data['type'], data['start_time'], data.get('end_time'), data['id'], g.user['id']))
    else:
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

    user = get_db().execute('SELECT group_name FROM users WHERE id = ?', (g.user['id'],)).fetchone()
    current_user_group = user['group_name'] if user and user['group_name'] else ''

    return render_template('schedule.html', current_user_group=current_user_group)


@app.route('/groups')
def groups():
    # Поки пусто
    return render_template('groups.html')


if __name__ == '__main__':
    init_db()
    app.run(debug=True)
