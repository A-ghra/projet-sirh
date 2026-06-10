#!/bin/bash
cd "$(dirname "$0")/backend" || exit 1
source venv/bin/activate
echo "============================================"
echo "  OTOMIA RH — Backend API"
echo "  http://127.0.0.1:8000/api/"
echo "============================================"
exec python manage.py runserver 127.0.0.1:8000
