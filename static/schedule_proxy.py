# schedule_proxy.py — невеликий проксі для fetching remote schedule
from flask import Blueprint, request, Response
import urllib.parse
import urllib.request

bp = Blueprint('schedule_proxy', __name__)

@bp.route('/api/schedule')
def schedule_proxy():
    group = request.args.get('studygroup_abbrname') or request.args.get('group')
    sem = request.args.get('semestr','1')
    semd = request.args.get('semestrduration','1')
    if not group:
        return {'error':'no group provided'}, 400
    q = urllib.parse.urlencode({'studygroup_abbrname': group, 'semestr': sem, 'semestrduration': semd})
    url = 'https://student.lpnu.ua/students_schedule?' + q
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            content = resp.read()
            r = Response(content, mimetype='text/html')
            r.headers['Access-Control-Allow-Origin'] = '*'
            return r
    except Exception as e:
        return {'error': str(e)}, 502
