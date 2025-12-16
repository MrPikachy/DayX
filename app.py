from flask import Flask, render_template, request, redirect, url_for, session, g, flash
import sqlite3
import os

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
        db.commit()

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

def init_db():
    if not os.path.exists(DB_PATH):
        with app.app_context():
            db = get_db()
            with open(os.path.join(BASE_DIR, 'schema.sql'), 'r', encoding='utf-8') as f:
                db.executescript(f.read())
            db.commit()
            print('Initialized database.')

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
        user = {'id': session['user_id'], 'first_name': session.get('first_name'), 'last_name': session.get('last_name')}
    return render_template('index.html', user=user)

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        first_name = request.form['first_name']
        last_name = request.form['last_name']
        email = request.form['email']
        password = request.form['password']

        db = get_db()
        db.execute('INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
                   (first_name, last_name, email, password))
        db.commit()
        return redirect(url_for('login'))

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

@app.route('/schedule')
def schedule():
    # Поки пусто
    return render_template('schedule.html')

@app.route('/groups')
def groups():
    # Поки пусто
    return render_template('groups.html')

if __name__ == '__main__':
    init_db()
    app.run(debug=True)
