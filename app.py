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
                        subgroup INTEGER DEFAULT 1,
                        avatar TEXT
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
        db.execute('''CREATE TABLE IF NOT EXISTS tasks (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        title TEXT NOT NULL,
                        description TEXT,
                        deadline TEXT,
                        is_completed INTEGER DEFAULT 0,
                        creator_id INTEGER NOT NULL,
                        team_id INTEGER,
                        assigned_to_ids TEXT,
                        created_at TEXT NOT NULL,
                        FOREIGN KEY (creator_id) REFERENCES users(id),
                        FOREIGN KEY (team_id) REFERENCES teams(id)
                    )''')

        db.commit()


@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


# --- Маршрути ---

@app.route('/app/user/avatar',
           methods=['GET'])  # Додатковий хелпер, якщо потрібно, але краще правити load_logged_in_user
# ...

@app.before_request
def load_logged_in_user():
    user_id = session.get('user_id')

    if user_id is None:
        g.user = None
    else:
        db = get_db()
        user = db.execute('SELECT * FROM users WHERE id = ?', (user_id,)).fetchone()

        if user:
            g.user = dict(user)
        else:
            session.clear()
            g.user = None


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


@app.route('/api/user/avatar', methods=['POST'])
def upload_avatar():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    if 'avatar' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    try:
        # Save avatar to static/images/avatars/
        os.makedirs('static/images/avatars', exist_ok=True)
        filename = f"user_{g.user['id']}.png"
        filepath = os.path.join('static/images/avatars', filename)
        file.save(filepath)

        db = get_db()
        # Note: The database schema for 'users' table was missing 'avatar_path' column.
        # Assuming it should be 'avatar' as in the initial schema definition.
        db.execute('UPDATE users SET avatar = ? WHERE id = ?',
                   (f'/static/images/avatars/{filename}', g.user['id']))
        db.commit()

        return jsonify({'success': True, 'avatar_url': f'/static/images/avatars/{filename}'})
    except Exception as e:
        print(f"Error uploading avatar: {e}")  # Added for debugging
        return jsonify({'error': str(e)}), 500


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
    Надійний парсер для Drupal Views (LPNU), який ігнорує пробіли в HTML.
    """
    soup = BeautifulSoup(html_text, 'html.parser')
    schedule = []

    # Час пар (бо в HTML є тільки цифри 1, 2, 3...)
    lesson_times = {
        '1': ('08:30', '10:05'),
        '2': ('10:20', '11:55'),
        '3': ('12:10', '13:45'),
        '4': ('14:15', '15:50'),
        '5': ('16:00', '17:35'),
        '6': ('17:40', '19:15'),
        '7': ('19:20', '20:55'),
        '8': ('21:00', '22:35')
    }

    # Знаходимо головний контейнер
    view_content = soup.find('div', {'class': 'view-content'})

    if not view_content:
        print("❌ Контейнер 'view-content' не знайдено.")
        return []

    # Змінні стану (щоб пам'ятати, де ми знаходимось під час циклу)
    current_weekday = None
    current_lesson_num = None

    # Перебираємо ВСІ елементи всередині контейнера по порядку
    # recursive=False означає, що ми беремо тільки прямих дітей (h3, div, span), а не все дерево
    for element in view_content.find_all(recursive=False):

        # 1. Якщо це заголовок дня (Пн, Вт...)
        if element.name == 'span' and 'view-grouping-header' in element.get('class', []):
            current_weekday = element.get_text(strip=True)
            continue

        # 2. Якщо це номер пари (<h3>1</h3>)
        if element.name == 'h3':
            current_lesson_num = element.get_text(strip=True)
            continue

        # 3. Якщо це блок з розкладом
        if element.name == 'div' and 'stud_schedule' in element.get('class', []):
            # Якщо ми ще не знаємо дня або номера пари, пропускаємо (захист від збоїв)
            if not current_weekday or not current_lesson_num:
                continue

            # Всередині stud_schedule шукаємо конкретні пари (views-row)
            # Шукаємо div-и, у яких є ID (наприклад id='group_full' або id='sub_1_chys')
            # Важливо: шукаємо рекурсивно всередині цього блоку
            lesson_divs = element.find_all('div', id=True)

            for div in lesson_divs:
                elem_id = div.get('id', '')

                # Знаходимо контент
                content_div = div.find('div', {'class': 'group_content'})
                if not content_div:
                    continue

                # --- Визначення підгрупи та тижня з ID ---
                subgroup = 0
                week_type = 'обидва'

                if 'sub_1' in elem_id:
                    subgroup = 1
                elif 'sub_2' in elem_id:
                    subgroup = 2

                if 'chys' in elem_id:
                    week_type = 'чисельник'
                elif 'znam' in elem_id:
                    week_type = 'знаменник'

                # --- Розбір тексту ---
                # Текст всередині group_content розділений тегами <br>
                # Ми замінюємо <br> на спецсимвол, щоб потім розбити
                text_content = str(content_div)

                # Очищаємо HTML теги, залишаючи розділювачі
                # BeautifulSoup get_text з separator='|' замінить <br> на |
                clean_text = content_div.get_text(separator='|', strip=True)
                parts = [p.strip() for p in clean_text.split('|') if p.strip()]

                if not parts:
                    continue

                # Назва предмету - це завжди перша частина
                subject = parts[0]

                # Деталі (Викладач, ауд, тип) - це решта
                details = ", ".join(parts[1:]) if len(parts) > 1 else ""

                # --- Аналіз деталей ---
                subject_type = 'Інше'
                location = ''

                details_lower = details.lower()
                if 'лекц' in details_lower:
                    subject_type = 'Лекція'
                elif 'практ' in details_lower:
                    subject_type = 'Практична'
                elif 'лаб' in details_lower:
                    subject_type = 'Лабораторна'
                elif 'консульт' in details_lower:
                    subject_type = 'Консультація'

                # Шукаємо локацію (щось схоже на корпус або аудиторію)
                # Шукаємо частини тексту, що містять цифри
                loc_parts = details.split(',')
                for p in loc_parts:
                    p = p.strip()
                    # Евристика: якщо є "н.к." або це просто номер аудиторії
                    if ('н.к.' in p) or (any(c.isdigit() for c in p) and len(p) < 10):
                        location = p
                        break

                # Час
                times = lesson_times.get(current_lesson_num, ('00:00', '00:00'))

                # Додаємо в результат
                subgroups_to_add = [1, 2] if subgroup == 0 else [subgroup]

                for sub in subgroups_to_add:
                    schedule.append({
                        'weekday': current_weekday,
                        'start_time': times[0],
                        'end_time': times[1],
                        'subject': subject,
                        'subject_type': subject_type,
                        'location': location,
                        'subgroup': sub,
                        'week_type': week_type
                    })

    print(f"✅ Успішно розпарсено {len(schedule)} пар.")
    return schedule


def fetch_and_cache_schedule(group_name):
    """
    Запит з детальним дебагом і збереженням HTML файлу.
    """
    try:
        import urllib.parse
        encoded_group = urllib.parse.quote(group_name)

        # Спробуємо базове посилання без зайвих параметрів тривалості
        base_url = "https://student.lpnu.ua/students_schedule"
        full_url = f"{base_url}?studygroup_abbrname={encoded_group}&semestr=1"

        # Використовуємо Session, щоб зберігати куки (іноді це допомагає)
        session = requests.Session()
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Referer': 'https://student.lpnu.ua/',
            'Upgrade-Insecure-Requests': '1'
        }

        print(f"🚀 Sending request to: {full_url}")

        response = session.get(full_url, headers=headers, timeout=20)
        response.encoding = 'utf-8'

        if response.status_code != 200:
            print(f"❌ Status code: {response.status_code}")
            return False

        # === ВАЖЛИВО: ЗБЕРІГАЄМО HTML ДЛЯ ПЕРЕВІРКИ ===
        debug_filename = "lpnu_debug.html"
        with open(debug_filename, "w", encoding="utf-8") as f:
            f.write(response.text)
        print(f"📄 HTML відповідь збережено у файл '{debug_filename}'. Відкрийте його в браузері!")
        # ===============================================

        # Парсимо
        schedule_rows = parse_html_schedule(response.text)

        if not schedule_rows:
            print("❌ Parsed 0 items.")
            # Додаткова перевірка на текст помилки
            if "не знайдено" in response.text.lower():
                print("⚠️ На сторінці написано, що розклад не знайдено.")
            return False

        # Зберігаємо
        db = get_db()
        db.execute('DELETE FROM schedule WHERE group_name = ?', (group_name,))

        now = datetime.now().isoformat()
        count = 0
        for row in schedule_rows:
            db.execute('''INSERT INTO schedule 
                         (group_name, subgroup, weekday, start_time, end_time, subject, subject_type, location, week_type, cached_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                       (group_name, row['subgroup'], row['weekday'], row['start_time'], row['end_time'],
                        row['subject'], row['subject_type'], row['location'], row['week_type'], now))
            count += 1

        db.commit()
        print(f"✅ SUCCESS! Cached {count} classes.")
        return True

    except Exception as e:
        print(f"🔥 Critical Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def get_current_week_type():
    """Determine if it's чисельник or знаменник week"""
    # Simplified: use date to determine week type
    # Week 1 of semester = чисельник, Week 2 = знаменник, etc.
    # You may need to adjust based on actual semester start date
    week_num = datetime.now().isocalendar()[1]
    return 'знаменник' if week_num % 2 == 1 else 'чисельник'


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

    # Нормалізуємо назву групи (верхній регістр, без пробілів), бо ПП-12 і пп-12 це різне
    group_name = group_name.strip().upper()

    # Отримуємо підгрупу
    req_sub = int(request.args.get('subgroup', '0'))
    if req_sub == 0:
        db = get_db()
        user = db.execute('SELECT subgroup FROM users WHERE id = ?', (g.user['id'],)).fetchone()
        req_sub = user['subgroup'] if user and user['subgroup'] else 1

    try:
        db = get_db()

        # === ПОЧАТОК ВИПРАВЛЕННЯ ===
        # Перевіряємо, чи є взагалі розклад для цієї групи в базі
        exists = db.execute('SELECT 1 FROM schedule WHERE group_name = ? LIMIT 1', (group_name,)).fetchone()

        # Якщо в базі пусто - ЙДЕМО НА САЙТ!
        if not exists:
            print(f"⚠️ База пуста для групи {group_name}. Завантажую з LPNU...")
            success = fetch_and_cache_schedule(group_name)
            if not success:
                print(f"❌ Не вдалося знайти розклад для {group_name} на сайті.")
            else:
                print(f"✅ Розклад завантажено успішно!")
        # === КІНЕЦЬ ВИПРАВЛЕННЯ ===

        # Тепер, коли дані точно є (або ми спробували їх дістати), читаємо з бази
        raw_rows = db.execute('''SELECT * FROM schedule WHERE group_name = ?''',
                              (group_name,)).fetchall()

        # Конвертуємо
        schedule_data = [dict(row) for row in raw_rows]

        # Дати семестру (Осінь 2025)
        # Розширив діапазон, щоб точно захопити грудень
        today = date.today()
        sem_year = today.year
        # Якщо зараз кінець року (грудень), семестр почався у вересні цього року
        if today.month >= 8:
            sem_start = date(sem_year, 9, 1)
            sem_end = date(sem_year, 12, 19)
        else:
            # Якщо початок року (січень-червень), це 2-й семестр
            sem_start = date(sem_year, 2, 1)
            sem_end = date(sem_year, 6, 30)

        # Розгортаємо шаблонні дні у конкретні дати
        expanded = expand_template_rows_to_dates(schedule_data, sem_start, sem_end)

        # Фільтруємо по підгрупі
        filtered_rows = [row for row in expanded if row.get('subgroup', 0) == 0 or row.get('subgroup', 0) == req_sub]

        events = []
        for idx, row in enumerate(filtered_rows):
            event_date = row.get('date', '')
            start_time = row.get('start_time', '08:00')
            end_time = row.get('end_time', '')

            # Якщо немає часу кінця, додаємо 1 годину 35 хв (стандартна пара + перерва)
            if not end_time and start_time:
                try:
                    dt_start = datetime.strptime(start_time, "%H:%M")
                    dt_end = dt_start + timedelta(minutes=95)
                    end_time = dt_end.strftime("%H:%M")
                except:
                    end_time = "09:35"

            if event_date and start_time:
                start_iso = f"{event_date}T{start_time}:00"
                end_iso = f"{event_date}T{end_time}:00"

                event_type = row.get('subject_type', 'Інше').lower()
                class_name = ['event-other']
                if 'лекц' in event_type:
                    class_name = ['event-lecture']
                elif 'практ' in event_type:
                    class_name = ['event-practical']
                elif 'лаб' in event_type:
                    class_name = ['event-lab']

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

        # Додаємо власні події (Custom Events)
        custom_events_rows = db.execute('SELECT * FROM events WHERE user_id = ? AND group_name = ?',
                                        (g.user['id'], group_name)).fetchall()

        custom_events = []
        for row in custom_events_rows:
            row_dict = dict(row)
            if row_dict.get('date') and row_dict.get('start_time'):
                start_iso = f"{row_dict['date']}T{row_dict['start_time']}:00"
                end_time = row_dict.get('end_time') or "23:59"
                end_iso = f"{row_dict['date']}T{end_time}:00"

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
        return jsonify({'error': str(e), 'events': []}), 500


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
    # Пока пусто
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
            SELECT u.id, u.first_name, u.last_name, u.avatar 
            FROM team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = ?
            ORDER BY u.first_name
        ''', (team_id,)).fetchall()

    # Get messages
    messages_rows = db.execute('''
            SELECT m.*, u.first_name, u.last_name, u.avatar  
            FROM team_messages m
            JOIN users u ON m.user_id = u.id
            WHERE m.team_id = ?
            ORDER BY m.created_at ASC
        ''', (team_id,)).fetchall()

    messages = [dict(row) for row in messages_rows]

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
    data = request.get_json()
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


@app.route('/api/team/<int:team_id>/members', methods=['GET'])
def get_team_members(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    # Verify user is member of team
    member = db.execute(
        'SELECT * FROM team_members WHERE team_id = ? AND user_id = ?',
        (team_id, g.user['id'])
    ).fetchone()

    if not member:
        return jsonify({'error': 'Not a team member'}), 403

    members = db.execute('''
            SELECT u.id, u.first_name, u.last_name, u.avatar 
            FROM users u
            JOIN team_members tm ON u.id = tm.user_id
            WHERE tm.team_id = ?
        ''', (team_id,)).fetchall()

    return jsonify([dict(m) for m in members])


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
    cursor = db.execute('SELECT id FROM team_members WHERE team_id = ? AND user_id = ?',
                        (team_id, g.user['id']))
    if cursor.fetchone():
        return jsonify({'error': 'Already a member'}), 400

    # Add to team
    db.execute('INSERT INTO team_members (team_id, user_id, joined_at) VALUES (?, ?, ?)',
               (team_id, g.user['id'], datetime.now().isoformat()))
    db.execute('UPDATE notifications SET is_read = 1 WHERE id = ?', (notif_id,))
    db.commit()

    return jsonify({'status': 'ok'})


@app.route('/tasks')
def tasks():
    if g.user is None:
        return redirect(url_for('login'))

    db = get_db()
    # Get personal tasks and team tasks where user is a member
    personal_tasks = db.execute('''
        SELECT * FROM tasks 
        WHERE creator_id = ? AND team_id IS NULL
        ORDER BY is_completed ASC, deadline ASC
    ''', (g.user['id'],)).fetchall()

    user_teams = db.execute('''
        SELECT t.id, t.name FROM teams t
        JOIN team_members tm ON t.id = tm.team_id
        WHERE tm.user_id = ?
    ''', (g.user['id'],)).fetchall()

    return render_template('tasks.html', personal_tasks=personal_tasks, user_teams=user_teams)


@app.route('/api/tasks/personal', methods=['GET'])
def get_personal_tasks():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    tasks_list = db.execute('''
        SELECT * FROM tasks 
        WHERE creator_id = ? AND team_id IS NULL
        ORDER BY is_completed ASC, deadline ASC
    ''', (g.user['id'],)).fetchall()

    return jsonify([dict(row) for row in tasks_list])


@app.route('/api/tasks/team/<int:team_id>', methods=['GET'])
def get_team_tasks(team_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    # Check if user is member of team
    is_member = db.execute('''
        SELECT id FROM team_members 
        WHERE team_id = ? AND user_id = ?
    ''', (team_id, g.user['id'])).fetchone()

    if not is_member:
        return jsonify({'error': 'Not a team member'}), 403

    tasks_list = db.execute('''
        SELECT * FROM tasks 
        WHERE team_id = ?
        ORDER BY is_completed ASC, deadline ASC
    ''', (team_id,)).fetchall()

    return jsonify([dict(row) for row in tasks_list])


@app.route('/api/tasks', methods=['POST'])
def create_task():
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json()
    db = get_db()

    try:
        now = datetime.now().isoformat()
        assigned_ids = data.get('assigned_to_ids')
        assigned_ids_json = json.dumps(assigned_ids) if assigned_ids else None

        cursor = db.execute('''
            INSERT INTO tasks (title, description, deadline, creator_id, team_id, assigned_to_ids, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (data.get('title'), data.get('description'), data.get('deadline'),
              g.user['id'], data.get('team_id'), assigned_ids_json, now))

        task_id = cursor.lastrowid
        db.commit()
        return jsonify({'success': True, 'task_id': task_id})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tasks/<int:task_id>', methods=['PUT'])
def update_task(task_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    data = request.get_json()
    db = get_db()

    # Check ownership
    task = db.execute('SELECT creator_id, team_id FROM tasks WHERE id = ?', (task_id,)).fetchone()
    if not task:
        return jsonify({'error': 'Task not found'}), 404

    is_creator = task['creator_id'] == g.user['id']
    is_team_creator = False

    if task['team_id']:
        team = db.execute('SELECT creator_id FROM teams WHERE id = ?', (task['team_id'],)).fetchone()
        is_team_creator = team and team['creator_id'] == g.user['id']

    if not (is_creator or is_team_creator):
        return jsonify({'error': 'Permission denied'}), 403

    try:
        if 'is_completed' in data:
            db.execute('UPDATE tasks SET is_completed = ? WHERE id = ?', (data['is_completed'], task_id))
        if 'title' in data:
            db.execute('UPDATE tasks SET title = ? WHERE id = ?', (data['title'], task_id))
        if 'description' in data:
            db.execute('UPDATE tasks SET description = ? WHERE id = ?', (data['description'], task_id))
        if 'deadline' in data:
            db.execute('UPDATE tasks SET deadline = ? WHERE id = ?', (data['deadline'], task_id))
        if 'assigned_to_ids' in data:
            assigned_ids = data['assigned_to_ids']
            db.execute('UPDATE tasks SET assigned_to_ids = ? WHERE id = ?',
                       (json.dumps(assigned_ids) if assigned_ids else None, task_id))

        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/tasks/<int:task_id>', methods=['DELETE'])
def delete_task(task_id):
    if not g.user:
        return jsonify({'error': 'Not authenticated'}), 401

    db = get_db()
    task = db.execute('SELECT creator_id, team_id FROM tasks WHERE id = ?', (task_id,)).fetchone()

    if not task:
        return jsonify({'error': 'Task not found'}), 404

    is_creator = task['creator_id'] == g.user['id']
    is_team_creator = False

    if task['team_id']:
        team = db.execute('SELECT creator_id FROM teams WHERE id = ?', (task['team_id'],)).fetchone()
        is_team_creator = team and team['creator_id'] == g.user['id']

    if not (is_creator or is_team_creator):
        return jsonify({'error': 'Permission denied'}), 403

    try:
        db.execute('DELETE FROM tasks WHERE id = ?', (task_id,))
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def week_parity_for_date(date_obj, sem_start):
    """
    Calculate week parity (чисельник/знаменник) for a given date.
    Swapped the parity calculation - first week is чисельник (odd weeks), знаменник (even weeks)
    """
    days_since_start = (date_obj - sem_start).days
    week_num = (days_since_start // 7) + 1
    return 'знаменник' if week_num % 2 == 1 else 'чисельник'


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
