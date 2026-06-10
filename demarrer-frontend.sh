#!/bin/bash
# Lance le frontend OTOMIA RH (port 5500, repli auto 5501, 5502… si occupé)
# Pour libérer le port 5500 : OTOMIA_FREE_PORT=1 ./demarrer-frontend.sh
cd "$(dirname "$0")/frontend" || exit 1
exec python3 serve.py
