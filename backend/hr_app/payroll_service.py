"""Calculs de paie conformes aux pratiques RDC 2026."""
import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from django.utils import timezone

D = Decimal

SYSTEM_VERSION = 'OTOMIA RH 2026.1'


def _d(value):
    return D(str(value or 0)).quantize(D('0.01'), rounding=ROUND_HALF_UP)


def _month_bounds(month_date):
    last = calendar.monthrange(month_date.year, month_date.month)[1]
    return date(month_date.year, month_date.month, 1), date(month_date.year, month_date.month, last)


def _count_leave_days(employee, month_date):
    start, end = _month_bounds(month_date)
    total = 0
    for absence in employee.absences.filter(status='Approved', start_date__lte=end, end_date__gte=start):
        if absence.absence_type in ('CP', 'Maladie', 'RTT'):
            s = max(absence.start_date, start)
            e = min(absence.end_date, end)
            total += (e - s).days + 1
    return total


def _attendance_snapshot(employee, month_date):
    start, end = _month_bounds(month_date)
    qs = employee.attendances.filter(date__gte=start, date__lte=end)
    return {
        'late': qs.filter(status='Late').count(),
        'unjustified': qs.filter(status='Absent').count(),
        'justified': 0,
    }


def compute_payroll_totals(data, employee=None, month_date=None):
    """
    Calcule tous les totaux à partir d'un dict de champs de paie.
    Retourne un dict prêt pour sauvegarde Payroll.
    """
    salary_base = _d(data.get('salary_base', 0))
    overtime_hours = _d(data.get('overtime_hours', 0))
    overtime_rate = _d(data.get('overtime_rate', 0))
    heures_sup = _d(data.get('heures_supplementaires', 0))
    if overtime_hours > 0 and overtime_rate > 0:
        heures_sup = (overtime_hours * overtime_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    primes = (
        _d(data.get('prime_fonction', 0))
        + _d(data.get('prime_responsabilite', 0))
        + _d(data.get('prime_rendement', 0))
        + _d(data.get('prime_risque', 0))
        + _d(data.get('prime_anciennete', 0))
        + _d(data.get('prime_representation', 0))
        + heures_sup
        + _d(data.get('gratifications', 0))
        + _d(data.get('bonus_exceptionnel', 0))
    )
    indemnites = (
        _d(data.get('prime_transport', 0))
        + _d(data.get('prime_logement', 0))
        + _d(data.get('prime_communication', 0))
        + _d(data.get('indemnite_fonction', 0))
        + _d(data.get('indemnite_speciale', 0))
        + _d(data.get('avantages_nature', 0))
        + _d(data.get('autres_indemnites', 0))
    )
    gross_salary = salary_base + primes + indemnites

    exempt = _d(data.get('prime_transport', 0)) + _d(data.get('prime_logement', 0))
    taxable_salary = max(gross_salary - exempt, D('0'))

    inpp_rate = _d(data.get('inpp_rate', '0.005'))
    cnss_rate = _d(data.get('cnss_rate', '0.05'))
    irpp_rate = _d(data.get('irpp_rate', '0.15'))

    inpp_enabled = data.get('inpp_enabled', True)
    if isinstance(inpp_enabled, str):
        inpp_enabled = inpp_enabled.lower() not in ('0', 'false', 'no')
    inpp = _d(data.get('inpp', 0))
    if inpp == 0 and gross_salary > 0 and inpp_enabled:
        inpp = (gross_salary * inpp_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)
    elif not inpp_enabled:
        inpp = D('0')

    cnss_salarie = (taxable_salary * cnss_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)
    irpp = (taxable_salary * irpp_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)

    retenues = (
        inpp + cnss_salarie + irpp
        + _d(data.get('assurance_sante', 0))
        + _d(data.get('avances_salaire', 0))
        + _d(data.get('prets_internes', 0))
        + _d(data.get('absences_non_justifiees', 0))
        + _d(data.get('retenues_retards', 0))
        + _d(data.get('retenues_disciplinaires', 0))
        + _d(data.get('cotisations_syndicales', 0))
        + _d(data.get('autres_retenues', 0))
    )
    net_salary = gross_salary - retenues

    result = {
        'currency': data.get('currency', 'USD'),
        'salary_base': salary_base,
        'prime_fonction': _d(data.get('prime_fonction', 0)),
        'prime_responsabilite': _d(data.get('prime_responsabilite', 0)),
        'prime_rendement': _d(data.get('prime_rendement', 0)),
        'prime_risque': _d(data.get('prime_risque', 0)),
        'prime_transport': _d(data.get('prime_transport', 0)),
        'prime_logement': _d(data.get('prime_logement', 0)),
        'prime_communication': _d(data.get('prime_communication', 0)),
        'prime_representation': _d(data.get('prime_representation', 0)),
        'prime_anciennete': _d(data.get('prime_anciennete', 0)),
        'heures_supplementaires': heures_sup,
        'gratifications': _d(data.get('gratifications', 0)),
        'bonus_exceptionnel': _d(data.get('bonus_exceptionnel', 0)),
        'indemnite_fonction': _d(data.get('indemnite_fonction', 0)),
        'indemnite_speciale': _d(data.get('indemnite_speciale', 0)),
        'avantages_nature': _d(data.get('avantages_nature', 0)),
        'autres_indemnites': _d(data.get('autres_indemnites', 0)),
        'total_primes': primes,
        'total_indemnites': indemnites,
        'gross_salary': gross_salary,
        'taxable_salary': taxable_salary,
        'inpp': inpp,
        'cnss_salarie': cnss_salarie,
        'irpp': irpp,
        'assurance_sante': _d(data.get('assurance_sante', 0)),
        'avances_salaire': _d(data.get('avances_salaire', 0)),
        'prets_internes': _d(data.get('prets_internes', 0)),
        'absences_non_justifiees': _d(data.get('absences_non_justifiees', 0)),
        'retenues_retards': _d(data.get('retenues_retards', 0)),
        'retenues_disciplinaires': _d(data.get('retenues_disciplinaires', 0)),
        'cotisations_syndicales': _d(data.get('cotisations_syndicales', 0)),
        'autres_retenues': _d(data.get('autres_retenues', 0)),
        'total_retenues': retenues,
        'net_salary': net_salary,
        'days_working': int(data.get('days_working', data.get('days_worked', 22))),
        'days_worked': int(data.get('days_worked', 22)),
        'days_absent': int(data.get('days_absent', 0)),
        'days_leave': int(data.get('days_leave', 0)),
        'overtime_hours': overtime_hours,
        'overtime_rate': overtime_rate,
        'days_mission': int(data.get('days_mission', 0)),
        'hours_normal': _d(data.get('hours_normal', 0)),
        'hours_missing': _d(data.get('hours_missing', 0)),
        'late_minutes': int(data.get('late_minutes', 0)),
        'hourly_rate': _d(data.get('hourly_rate', 0)),
        'presence_rate': _d(data.get('presence_rate', 0)),
    }

    if employee and month_date:
        from .attendance_payroll import compute_attendance_payroll
        att_data = compute_attendance_payroll(employee, month_date, salary_base)
        for key, val in att_data.items():
            if key not in data or data.get(key) in (None, '', 0, '0'):
                result[key] = val
        if 'heures_supplementaires' not in data or not _d(data.get('heures_supplementaires', 0)):
            result['heures_supplementaires'] = att_data['heures_supplementaires']
            result['total_primes'] = primes + att_data['heures_supplementaires']
            result['gross_salary'] = salary_base + result['total_primes'] + indemnites
            result['taxable_salary'] = max(result['gross_salary'] - exempt, D('0'))
            if inpp == 0 and result['gross_salary'] > 0 and inpp_enabled:
                inpp = (result['gross_salary'] * inpp_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)
                result['inpp'] = inpp
            cnss_salarie = (result['taxable_salary'] * cnss_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)
            irpp = (result['taxable_salary'] * irpp_rate).quantize(D('0.01'), rounding=ROUND_HALF_UP)
            result['cnss_salarie'] = cnss_salarie
            result['irpp'] = irpp
            result['total_retenues'] = (
                inpp + cnss_salarie + irpp
                + result['assurance_sante'] + result['avances_salaire'] + result['prets_internes']
                + result['absences_non_justifiees'] + result['retenues_retards']
                + result['retenues_disciplinaires'] + result['cotisations_syndicales'] + result['autres_retenues']
            )
            result['net_salary'] = result['gross_salary'] - result['total_retenues']

    return result


def payslip_filename(payroll, ext='pdf'):
    months_fr = {
        1: 'JANVIER', 2: 'FEVRIER', 3: 'MARS', 4: 'AVRIL',
        5: 'MAI', 6: 'JUIN', 7: 'JUILLET', 8: 'AOUT',
        9: 'SEPTEMBRE', 10: 'OCTOBRE', 11: 'NOVEMBRE', 12: 'DECEMBRE',
    }
    matricule = payroll.employee.matricule.upper()
    mois = months_fr.get(payroll.month.month, 'MOIS')
    annee = payroll.month.year
    return f'BULLETIN_PAIE_{matricule}_{mois}_{annee}.{ext}'
