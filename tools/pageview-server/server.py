
from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import os

app = Flask(__name__)
# 允许跨域请求，这里可以限制 specific origin
CORS(app)

DB_FILE = 'pageviews.db'

def get_db_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

# 初始化数据库
def init_db():
    conn = sqlite3.connect(DB_FILE)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS pageviews
                 (url TEXT PRIMARY KEY, count INTEGER, title TEXT)''')
    conn.commit()
    conn.close()

if not os.path.exists(DB_FILE):
    init_db()

@app.route('/api/pageview', methods=['GET', 'POST', 'OPTIONS'])
def pageview_handler():
    if request.method == 'POST':
        # 记录访问量 +1
        data = request.get_json()
        if not data:
            return jsonify({'error': 'No JSON data'}), 400

        url = data.get('url')
        if not url:
            # 尝试从 key 获取（兼容旧逻辑）
            url = data.get('key')

        title = data.get('title', 'Unknown Title')

        if not url:
            return jsonify({'error': 'URL or Key is required'}), 400

        # 连接数据库更新
        conn = get_db_connection()
        cur = conn.cursor()

        cur.execute('SELECT count FROM pageviews WHERE url = ?', (url,))
        row = cur.fetchone()

        new_count = 1
        if row:
            new_count = row['count'] + 1
            cur.execute('UPDATE pageviews SET count = ?, title = ? WHERE url = ?', (new_count, title, url))
        else:
            cur.execute('INSERT INTO pageviews (url, count, title) VALUES (?, ?, ?)', (url, new_count, title))

        conn.commit()
        conn.close()

        return jsonify({'views': new_count})

    elif request.method == 'GET':
        # 获取访问量
        url = request.args.get('url')
        if not url:
            url = request.args.get('key')

        if not url:
             return jsonify({'views': 0})

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT count FROM pageviews WHERE url = ?', (url,))
        row = cur.fetchone()
        conn.close()

        count = row['count'] if row else 0
        return jsonify({'views': count})

if __name__ == '__main__':
    # 监听所有网卡，端口 5000
    # 请确保 Windows 防火墙允许 5000 端口入站
    app.run(host='0.0.0.0', port=5000)

