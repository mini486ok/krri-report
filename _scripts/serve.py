#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로컬 개발용 HTTP 서버. 모든 응답에 no-store 헤더를 붙여 브라우저 캐시를 완전히 끈다.

사용법:
  python _scripts/serve.py          # 기본 포트 8080
  python _scripts/serve.py 8000     # 다른 포트
"""
import sys, os
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, fmt, *args):
        # 간단 로그
        sys.stdout.write("[serve] " + (fmt % args) + "\n")
        sys.stdout.flush()


def main():
    port = 8080
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    srv = HTTPServer(('127.0.0.1', port), NoCacheHandler)
    print(f'Serving {ROOT}')
    print(f'  http://localhost:{port}/admin.html')
    print(f'  http://localhost:{port}/index.html')
    print('Cache-Control: no-store 적용됨 (브라우저가 캐시하지 않음)')
    print('Ctrl+C 로 종료')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped.')


if __name__ == '__main__':
    main()
