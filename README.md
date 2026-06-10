# Backend OTOMIA RH

## Démarrage rapide

```bash
cd SIRH_FULL_PROJECT/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# MySQL / MariaDB (XAMPP) — utiliser TCP si le socket local échoue
mysql -h 127.0.0.1 -u root -e "CREATE DATABASE IF NOT EXISTS sirh_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"

python manage.py migrate
python seed_data.py
python manage.py runserver
```

> **Note Django 4.2** : requis pour compatibilité MariaDB 10.4 (XAMPP). Django 5+ exige MariaDB 10.6+.

## Comptes démo

Mot de passe commun : `otomia2026`

- `admin` — Administrateur RH
- `gestionnaire` — Gestionnaire RH / Paie
- `manager` — Responsable Hiérarchique
- `employe` — Employé (portail)
