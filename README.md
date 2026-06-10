# OTOMIA RH

**Système Intelligent de Gestion des Ressources Humaines**

Application SIRH complète : Django REST Framework + MySQL/MariaDB + Frontend HTML/CSS/JavaScript Vanilla.

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Frontend | HTML5, CSS3, JavaScript Vanilla, Fetch API |
| Backend | Django 4.x, Django REST Framework |
| Base de données | MySQL / MariaDB (XAMPP ou MariaDB natif) |
| Exports | WeasyPrint (PDF), openpyxl (Excel), python-docx (Word) |

## Installation (Ubuntu 24.04)

### 1. Base de données

```bash
# Avec MariaDB/MySQL
sudo mysql -e "CREATE DATABASE IF NOT EXISTS sirh_db CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
```

### 2. Backend Django

```bash
cd SIRH_FULL_PROJECT/backend
pip install -r requirements.txt
python manage.py migrate
python seed_data.py
python manage.py runserver
```

API disponible sur : `http://127.0.0.1:8000/api/`

### 3. Frontend

Servir le dossier `frontend/` avec un serveur HTTP local :

```bash
cd SIRH_FULL_PROJECT/frontend
python3 -m http.server 5500
```

Ouvrir : `http://127.0.0.1:5500/login.html`

## Comptes de démonstration

| Utilisateur | Mot de passe | Rôle | Redirection |
|-------------|--------------|------|-------------|
| `admin` | `otomia2026` | Administrateur RH | Dashboard Admin |
| `gestionnaire` | `otomia2026` | Gestionnaire RH / Paie | Dashboard RH |
| `manager` | `otomia2026` | Responsable Hiérarchique | Dashboard Manager |
| `employe` | `otomia2026` | Employé | Portail Employé |

## API REST principale

| Endpoint | Méthode | Description |
|----------|---------|-------------|
| `/api/login/` | POST | Connexion |
| `/api/logout/` | POST | Déconnexion |
| `/api/me/` | GET | Profil utilisateur |
| `/api/employees/` | GET/POST/PUT/DELETE | Gestion employés |
| `/api/payroll/calculate/` | POST | Calcul paie mensuelle |
| `/api/payroll/{id}/validate_payroll/` | POST | Validation + exports |
| `/api/export/pdf/` | GET | Rapport RH PDF |
| `/api/export/excel/` | GET | Rapport RH Excel |
| `/api/export/word/` | GET | Rapport RH Word |
| `/api/dashboard/` | GET | Statistiques RH |
| `/api/employee-portal/` | GET | Portail employé |

## Modules fonctionnels

- Gestion administrative du personnel
- Gestion de la paie (DRAFT → VALIDATED → PAID)
- Exports bulletins PDF / Excel / Word avec logo OTOMIA RH
- Présences & congés (workflow validation)
- Recrutement & candidatures
- Formation
- Performances & évaluations
- Portail employé
- Reporting & statistiques
- Journal d'audit (Audit Log)
- RBAC par rôle

## Identité visuelle

- **Nom** : OTOMIA RH
- **Slogan** : Système Intelligent de Gestion des Ressources Humaines
- **Couleurs** : Bleu professionnel (#1a5f9e), Blanc, Gris moderne
