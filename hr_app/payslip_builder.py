"""Construction du contexte bulletin de paie RDC 2026."""
import base64
import hashlib
import io
import os

import qrcode
from django.conf import settings
from django.utils import timezone

from .company_utils import logo_file_uri
from .models import CompanySettings
from .branding import DEVELOPER_SIGNATURE, APP_VERSION_LABEL
from .payroll_service import SYSTEM_VERSION


MONTHS_FR = {
    1: 'Janvier', 2: 'Février', 3: 'Mars', 4: 'Avril', 5: 'Mai', 6: 'Juin',
    7: 'Juillet', 8: 'Août', 9: 'Septembre', 10: 'Octobre', 11: 'Novembre', 12: 'Décembre',
}


def currency_symbol(currency):
    return 'CDF' if currency == 'CDF' else 'USD'


def generate_verification_hash(payroll):
    issued = payroll.issued_at.isoformat() if payroll.issued_at else ''
    payload = (
        f"{payroll.id}|{payroll.employee.matricule}|{payroll.month}|"
        f"{payroll.net_salary}|{payroll.gross_salary}|{issued}"
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def generate_qr_code(payroll, company, bulletin_number):
    hash_val = payroll.verification_hash or generate_verification_hash(payroll)
    issued = (payroll.issued_at or timezone.now()).strftime('%Y-%m-%d')
    mois = MONTHS_FR.get(payroll.month.month, payroll.month.month)
    qr_text = (
        f"OTOMIA-RH|BP:{bulletin_number}|MAT:{payroll.employee.matricule}|"
        f"MOIS:{mois}|ANNEE:{payroll.month.year}|DATE:{issued}|HASH:{hash_val[:16]}"
    )
    img = qrcode.make(qr_text, box_size=4, border=1)
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}", qr_text


def _employee_photo_uri(employee):
    if employee.photo:
        try:
            path = employee.photo.path
            if os.path.isfile(path):
                return f'file://{path}'
        except (ValueError, OSError):
            pass
        url = employee.photo.url
        if url.startswith('http'):
            return url
        return f'{settings.MEDIA_URL.rstrip("/")}/{employee.photo.name}' if hasattr(settings, 'MEDIA_ROOT') else url
    return None


def _gains_lines(payroll):
    lines = [
        ('Salaire de base', payroll.salary_base),
        ('Prime de transport', payroll.prime_transport),
        ('Prime de logement', payroll.prime_logement),
        ('Prime de responsabilité', payroll.prime_responsabilite),
        ('Prime de fonction', payroll.prime_fonction),
        ("Prime d'ancienneté", payroll.prime_anciennete),
        ('Prime de rendement', payroll.prime_rendement),
        ('Prime de communication', payroll.prime_communication),
        ('Prime de risque', payroll.prime_risque),
        ('Prime de représentation', payroll.prime_representation),
        ('Heures supplémentaires', payroll.heures_supplementaires),
        ('Bonus', payroll.bonus_exceptionnel),
        ('Gratifications', payroll.gratifications),
        ('Avantages en nature', payroll.avantages_nature),
        ('Indemnité de fonction', payroll.indemnite_fonction),
        ('Indemnité spéciale', payroll.indemnite_speciale),
        ('Autres indemnités', payroll.autres_indemnites),
    ]
    return [(label, val) for label, val in lines if float(val) != 0]


def _retenues_lines(payroll, company=None):
    company = company or CompanySettings.get_settings()
    lines = []
    if company.inpp_enabled:
        lines.append(('INPP', payroll.inpp))
    lines.extend([
        ('IPR / IRPP', payroll.irpp),
        ('CNSS', payroll.cnss_salarie),
        ('Avance sur salaire', payroll.avances_salaire),
        ('Prêt interne', payroll.prets_internes),
        ('Retenues absences', payroll.absences_non_justifiees),
        ('Retenues retards', payroll.retenues_retards),
        ('Retenues disciplinaires', payroll.retenues_disciplinaires),
        ('Assurance', payroll.assurance_sante),
        ('Cotisation syndicale', payroll.cotisations_syndicales),
        ('Autres retenues', payroll.autres_retenues),
    ])
    return [(label, val) for label, val in lines if float(val) != 0]


def build_payslip_context(payroll, user=None):
    company = CompanySettings.get_settings()
    emp = payroll.employee
    issued_at = payroll.issued_at or timezone.now()
    bulletin_number = company.bulletin_number(payroll.id, payroll.month.year)
    curr = currency_symbol(payroll.currency)
    show_qr = company.bulletin_qr_enabled
    qr_uri, qr_text = ('', '')
    if show_qr:
        qr_uri, qr_text = generate_qr_code(payroll, company, bulletin_number)

    dept = emp.department.name if emp.department else '-'
    direction = '-'
    if emp.department and emp.department.parent:
        direction = emp.department.parent.name
    elif emp.department:
        direction = emp.department.name

    photo_uri = _employee_photo_uri(emp)
    generated_by = user
    if not generated_by and payroll.generated_by:
        generated_by = payroll.generated_by

    return {
        'company': company,
        'employee': emp,
        'payroll': payroll,
        'brand_name': company.company_acronym,
        'brand_slogan': company.company_slogan,
        'logo_uri': logo_file_uri(company),
        'photo_uri': photo_uri,
        'bulletin_title': company.bulletin_title,
        'bulletin_number': bulletin_number,
        'bulletin_prefix': company.bulletin_prefix,
        'bulletin_footer': company.bulletin_footer,
        'hr_manager_name': company.hr_manager_name,
        'director_name': company.director_name,
        'hr_department': company.hr_department,
        'payroll_department': company.payroll_department,
        'issued_at': issued_at,
        'month_label': MONTHS_FR.get(payroll.month.month, payroll.month.strftime('%B')),
        'year_label': payroll.month.year,
        'currency': curr,
        'currency_label': 'Franc Congolais (CDF)' if curr == 'CDF' else 'Dollar Américain (USD)',
        'gains': _gains_lines(payroll),
        'retenues': _retenues_lines(payroll, company),
        'validated_at': payroll.issued_at or payroll.updated_at,
        'validated_by_name': (
            payroll.validated_by.get_full_name() or payroll.validated_by.username
            if payroll.validated_by else company.hr_manager_name
        ),
        'inpp_enabled': company.inpp_enabled,
        'gains_subtotal': payroll.gross_salary,
        'retenues_subtotal': payroll.total_retenues,
        'seniority_years': emp.seniority_years,
        'direction': direction,
        'department': dept,
        'leave_previous': payroll.leave_balance_previous,
        'leave_taken': payroll.leave_taken,
        'leave_current': payroll.leave_balance_current,
        'absence_late': payroll.absence_late_count,
        'absence_justified': payroll.absence_justified_days,
        'absence_unjustified': payroll.absence_unjustified_days,
        'days_mission': payroll.days_mission,
        'hours_normal': payroll.hours_normal,
        'hours_missing': payroll.hours_missing,
        'late_minutes': payroll.late_minutes,
        'hourly_rate': payroll.hourly_rate,
        'presence_rate': payroll.presence_rate,
        'social_deductions': float(payroll.inpp) + float(payroll.cnss_salarie) + float(payroll.irpp),
        'qr_uri': qr_uri,
        'qr_text': qr_text,
        'verification_hash': payroll.verification_hash or generate_verification_hash(payroll),
        'generated_by_name': generated_by.get_full_name() or generated_by.username if generated_by else 'Système',
        'system_version': SYSTEM_VERSION,
        'show_qr': show_qr,
        'show_signature': company.bulletin_signature_enabled,
        'show_stamp': company.bulletin_stamp_enabled,
        'payroll_manager_name': company.payroll_manager_name,
        'developer_signature': DEVELOPER_SIGNATURE,
        'app_version_label': APP_VERSION_LABEL,
        'legal_line': ' | '.join(filter(None, [
            f'RCCM: {company.rccm}',
            f'ID. NAT: {company.id_nat}',
            f'Impôt: {company.tax_number}' if company.tax_number else '',
            f'CNSS: {company.cnss_number}',
        ])),
    }
