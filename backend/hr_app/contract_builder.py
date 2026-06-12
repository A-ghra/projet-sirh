"""Construction du contexte d'export contrat de travail."""
import base64
import hashlib
import io
import re
from datetime import date

import qrcode
from django.utils import timezone

from .company_utils import logo_file_uri
from .models import CompanySettings


def slug_employee_name(full_name):
    s = re.sub(r'[^A-Za-z0-9]+', '_', (full_name or 'EMPLOYE').upper().strip())
    return re.sub(r'_+', '_', s).strip('_')[:50] or 'EMPLOYE'


def generate_contract_verification_hash(contract):
    payload = (
        f"{contract.id}|{contract.contract_number}|{contract.employee.matricule}|"
        f"{contract.contract_type}|{contract.start_date}|{contract.salary_base}"
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def generate_contract_qr(contract, company):
    hash_val = generate_contract_verification_hash(contract)
    issued = timezone.now().strftime('%Y-%m-%d')
    qr_text = (
        f"OTOMIA-RH|CTR:{contract.contract_number}|MAT:{contract.employee.matricule}|"
        f"TYPE:{contract.contract_type}|DEBUT:{contract.start_date}|DATE:{issued}|HASH:{hash_val[:16]}"
    )
    img = qrcode.make(qr_text, box_size=4, border=1)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}", qr_text, hash_val


def _contract_duration_label(contract):
    if contract.duration_months:
        return f"{contract.duration_months} mois"
    if contract.start_date and contract.end_date:
        days = (contract.end_date - contract.start_date).days
        months = max(1, round(days / 30))
        return f"{months} mois (approx.)"
    if contract.contract_type == 'CDI':
        return 'Durée indéterminée'
    return '—'


def _benefits_lines(contract):
    lines = []
    for b in contract.benefits or []:
        if isinstance(b, dict):
            label = b.get('label') or b.get('type') or 'Avantage'
            amount = b.get('amount', 0)
            lines.append((label, amount))
    return lines


def _manager_name(emp):
    if emp.manager:
        return emp.manager.full_name
    return '—'


def build_contract_context(contract, user=None):
    company = CompanySettings.get_settings()
    emp = contract.employee
    issued_at = timezone.now()
    verification_hash = generate_contract_verification_hash(contract)
    show_qr = company.bulletin_qr_enabled
    qr_uri, qr_text = ('', '')
    if show_qr:
        qr_uri, qr_text, verification_hash = generate_contract_qr(contract, company)

    logo_uri = logo_file_uri(company)
    dept_name = emp.department.name if emp.department else '—'

    remuneration = [
        ('Salaire de base', contract.salary_base),
        ('Prime transport', contract.transport_allowance),
        ('Prime logement', contract.housing_allowance),
        ('Prime responsabilité', contract.responsibility_bonus),
        ('Indemnités', contract.indemnities),
        ('Avantages en nature', contract.benefits_in_kind),
    ]
    remuneration = [(l, v) for l, v in remuneration if float(v or 0) != 0]

    labor_refs = company.other_legal_refs or (
        'Loi n° 16/008 du 15 mai 2016 portant Code du travail en République Démocratique du Congo.'
    )

    return {
        'company': company,
        'contract': contract,
        'employee': emp,
        'issued_at': issued_at,
        'logo_uri': logo_uri,
        'verification_hash': verification_hash,
        'qr_uri': qr_uri,
        'qr_text': qr_text,
        'show_qr': show_qr,
        'show_stamp': company.bulletin_stamp_enabled,
        'show_signatures': company.bulletin_signature_enabled,
        'department': dept_name,
        'manager_name': _manager_name(emp),
        'duration_label': _contract_duration_label(contract),
        'remuneration_lines': remuneration,
        'benefits_lines': _benefits_lines(contract),
        'labor_code_refs': labor_refs,
        'generated_by': user.get_full_name() or user.username if user and user.is_authenticated else 'Système',
        'employee_signed': bool(contract.employee_signed_at),
        'hr_signed': bool(contract.hr_signed_at),
        'direction_signed': bool(contract.direction_signed_at),
    }
