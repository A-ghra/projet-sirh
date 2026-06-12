"""Importation de masse des candidats (Excel, CSV, PDF)."""
import csv
import io
import re

import openpyxl

from .models import Applicant, Recruitment


STATUS_MAP = {
    'en attente': 'PENDING', 'pending': 'PENDING', 'nouveau': 'PENDING', 'new': 'PENDING',
    'évaluation': 'EVALUATING', 'evaluating': 'EVALUATING',
    'entretien programmé': 'INTERVIEW_SCHEDULED', 'interview': 'INTERVIEW_SCHEDULED',
    'entretien effectué': 'INTERVIEW_DONE',
    'accepté': 'ACCEPTED', 'accepted': 'ACCEPTED', 'hired': 'ACCEPTED', 'embauché': 'ACCEPTED',
    'refusé': 'REJECTED', 'rejected': 'REJECTED',
}

FIELD_ALIASES = {
    'nom': 'nom', 'name': 'nom', 'lastname': 'nom',
    'postnom': 'postnom',
    'prenom': 'prenom', 'prénom': 'prenom', 'firstname': 'prenom',
    'email': 'email', 'mail': 'email',
    'telephone': 'phone', 'téléphone': 'phone', 'phone': 'phone',
    'poste': 'position', 'position': 'position', 'job': 'position',
    'nationalite': 'nationality', 'nationalité': 'nationality', 'nationality': 'nationality',
    'statut': 'status', 'status': 'status', 'etat': 'status', 'état': 'status',
    'salaire': 'salary_base', 'salary': 'salary_base',
}


def _normalize_header(h):
    return re.sub(r'[^a-z0-9]', '', (h or '').lower())


def _map_row(row_dict):
    data = {}
    for key, val in row_dict.items():
        norm = _normalize_header(key)
        for alias, field in FIELD_ALIASES.items():
            if _normalize_header(alias) == norm:
                data[field] = val
                break
    if data.get('status'):
        data['status'] = STATUS_MAP.get(str(data['status']).lower().strip(), 'PENDING')
    if data.get('salary_base'):
        try:
            data['salary_base'] = float(str(data['salary_base']).replace(',', '.').replace(' ', ''))
        except ValueError:
            data['salary_base'] = 0
    if data.get('nom') or data.get('prenom'):
        parts = [data.get('prenom', ''), data.get('nom', ''), data.get('postnom', '')]
        data['full_name'] = ' '.join(p for p in parts if p).strip()
    elif data.get('full_name'):
        parts = str(data['full_name']).split()
        if len(parts) >= 2:
            data['prenom'] = parts[0]
            data['nom'] = parts[-1]
    return data


def _default_recruitment():
    rec = Recruitment.objects.filter(status='Open').order_by('-posted_date').first()
    if not rec:
        rec = Recruitment.objects.create(
            job_title='Candidatures importées',
            description='Campagne créée automatiquement lors d\'un import.',
            status='Open',
        )
    return rec


def import_from_csv(file_obj, recruitment=None):
    text = file_obj.read()
    if isinstance(text, bytes):
        text = text.decode('utf-8-sig', errors='replace')
    reader = csv.DictReader(io.StringIO(text))
    return _import_rows(reader, recruitment)


def import_from_excel(file_obj, recruitment=None):
    wb = openpyxl.load_workbook(file_obj, read_only=True, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    headers = [str(h or '').strip() for h in next(rows)]
    dict_rows = []
    for row in rows:
        if not any(row):
            continue
        dict_rows.append(dict(zip(headers, row)))
    return _import_rows(dict_rows, recruitment)


def import_from_pdf(file_obj, recruitment=None):
    """Import PDF — crée un candidat par fichier CV (nom dérivé du fichier)."""
    recruitment = recruitment or _default_recruitment()
    name = getattr(file_obj, 'name', 'candidat_import.pdf')
    base = re.sub(r'\.[^.]+$', '', name).replace('_', ' ').replace('-', ' ').strip()
    parts = base.split()
    prenom = parts[0] if parts else 'Candidat'
    nom = parts[-1] if len(parts) > 1 else 'Importé'
    applicant = Applicant.objects.create(
        recruitment=recruitment,
        nom=nom,
        prenom=prenom,
        full_name=base or f"{prenom} {nom}",
        email=f"{slugify_email(prenom, nom)}@import.local",
        status='PENDING',
    )
    applicant.resume.save(name, file_obj, save=True)
    return {'created': 1, 'errors': [], 'applicants': [applicant.id]}


def slugify_email(prenom, nom):
    base = re.sub(r'[^a-z0-9]', '', f"{prenom}{nom}".lower()) or 'candidat'
    i = 1
    email = f"{base}@import.local"
    while Applicant.objects.filter(email=email).exists():
        email = f"{base}{i}@import.local"
        i += 1
    return email.split('@')[0]


def _import_rows(rows, recruitment=None):
    recruitment = recruitment or _default_recruitment()
    created = 0
    errors = []
    ids = []
    for i, raw in enumerate(rows, start=2):
        try:
            data = _map_row({k: (v if v is not None else '') for k, v in raw.items()})
            if not data.get('email') and not (data.get('nom') or data.get('prenom')):
                continue
            if not data.get('email'):
                data['email'] = f"{slugify_email(data.get('prenom', 'c'), data.get('nom', 'andidat'))}@import.local"
            applicant = Applicant.objects.create(
                recruitment=recruitment,
                nom=data.get('nom', ''),
                postnom=data.get('postnom', ''),
                prenom=data.get('prenom', ''),
                full_name=data.get('full_name', ''),
                email=data['email'],
                phone=str(data.get('phone', '')),
                position=str(data.get('position', '')),
                nationality=str(data.get('nationality', 'Congolaise')),
                salary_base=data.get('salary_base', 0),
                status=data.get('status', 'PENDING'),
            )
            ids.append(applicant.id)
            created += 1
        except Exception as exc:
            errors.append(f"Ligne {i}: {exc}")
    return {'created': created, 'errors': errors, 'applicants': ids}
