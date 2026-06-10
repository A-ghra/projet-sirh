"""Services métier — performances, formations, compétences, certifications, objectifs, KPI."""
from collections import Counter
from datetime import timedelta

from django.db.models import Avg, Count, Q
from django.utils import timezone

from .models import (
    Training, EmployeeTrainingResult, PerformanceReview,
    SkillCategory, Skill, EmployeeSkill, Certification, Objective, EmployeeKPI,
    Employee, Notification,
)

STAR_LABELS = PerformanceReview.STAR_LABELS


def star_display(rating):
    return '★' * (rating or 0) + '☆' * (5 - (rating or 0))


def check_certification_alerts(employee=None):
    """Crée des notifications pour certifications expirées ou proches de l'expiration."""
    today = timezone.now().date()
    qs = Certification.objects.select_related('employee')
    if employee:
        qs = qs.filter(employee=employee)
    alerts = []
    for cert in qs.filter(expiry_date__isnull=False):
        delta = (cert.expiry_date - today).days
        if delta < 0:
            title = f'Certification expirée : {cert.title}'
            msg = f'La certification « {cert.title} » a expiré le {cert.expiry_date}.'
            alert_type = 'expired'
        elif delta <= 30:
            title = f'Certification expire bientôt : {cert.title}'
            msg = f'La certification « {cert.title} » expire dans {delta} jour(s) ({cert.expiry_date}).'
            alert_type = 'expiring_30'
        elif delta <= 90:
            title = f'Certification à renouveler : {cert.title}'
            msg = f'La certification « {cert.title} » expire dans {delta} jour(s) ({cert.expiry_date}).'
            alert_type = 'expiring_90'
        else:
            continue
        notif, created = Notification.objects.get_or_create(
            employee=cert.employee,
            title=title,
            notification_type='certification',
            defaults={'message': msg},
        )
        if created:
            alerts.append({'certification_id': cert.id, 'type': alert_type, 'employee_id': cert.employee_id})
    return alerts


def performance_dashboard_stats(employee_id=None):
    qs = PerformanceReview.objects.all()
    if employee_id:
        qs = qs.filter(employee_id=employee_id)
    total = qs.count()
    avg_score = qs.aggregate(avg=Avg('score'))['avg'] or 0
    avg_stars = qs.aggregate(avg=Avg('star_rating'))['avg'] or 0
    distribution = {str(i): qs.filter(star_rating=i).count() for i in range(1, 6)}
    monthly = []
    today = timezone.now().date()
    for i in range(5, -1, -1):
        month_start = (today.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        if month_start.month == 12:
            month_end = month_start.replace(year=month_start.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end = month_start.replace(month=month_start.month + 1, day=1) - timedelta(days=1)
        month_qs = qs.filter(review_date__gte=month_start, review_date__lte=month_end)
        monthly.append({
            'month': month_start.strftime('%b %Y'),
            'count': month_qs.count(),
            'avg_score': round(month_qs.aggregate(avg=Avg('score'))['avg'] or 0, 1),
            'avg_stars': round(month_qs.aggregate(avg=Avg('star_rating'))['avg'] or 0, 1),
        })
    return {
        'total_evaluations': total,
        'average_score': round(avg_score, 1),
        'average_stars': round(avg_stars, 1),
        'star_distribution': distribution,
        'monthly_evolution': monthly,
    }


def training_dashboard_stats():
    today = timezone.now().date()
    trainings = Training.objects.all()
    total = trainings.count()
    in_progress = trainings.filter(status='InProgress').count()
    completed = trainings.filter(status='Completed').count()
    planned = trainings.filter(status='Planned').count()
    participants = Employee.objects.filter(trainings__isnull=False).distinct().count()
    active_employees = Employee.objects.filter(status='Active').count()
    participation_rate = round(participants / active_employees * 100, 1) if active_employees else 0
    results = EmployeeTrainingResult.objects.all()
    completed_results = results.filter(completed=True).count()
    success_rate = round(completed_results / results.count() * 100, 1) if results.count() else 0
    avg_score = results.filter(score__isnull=False).aggregate(avg=Avg('score'))['avg']
    by_status = [
        {'status': 'En cours', 'count': in_progress},
        {'status': 'Terminée', 'count': completed},
        {'status': 'Planifiée', 'count': planned},
    ]
    return {
        'total_trainings': total,
        'in_progress': in_progress,
        'completed': completed,
        'planned': planned,
        'participation_rate': participation_rate,
        'success_rate': success_rate,
        'participants_registered': participants,
        'results_registered': results.count(),
        'avg_score': round(avg_score or 0, 1),
        'by_status': by_status,
    }


def talent_overview_stats_readonly():
    """Statistiques agrégées sans effet de bord (lecture seule — safe pour polling)."""
    certs = Certification.objects.all()
    today = timezone.now().date()
    cert_expiring = certs.filter(expiry_date__gte=today, expiry_date__lte=today + timedelta(days=90)).count()
    cert_expired = certs.filter(expiry_date__lt=today).count()
    objectives = Objective.objects.all()
    kpis = EmployeeKPI.objects.all()
    kpi_count = kpis.count()
    return {
        'performance': performance_dashboard_stats(),
        'training': training_dashboard_stats(),
        'skills_count': EmployeeSkill.objects.count(),
        'certifications_count': certs.count(),
        'certifications_expiring': cert_expiring,
        'certifications_expired': cert_expired,
        'objectives_total': objectives.count(),
        'objectives_completed': objectives.filter(status='Completed').count(),
        'objectives_late': objectives.filter(status='Late').count(),
        'kpis_count': kpi_count,
        'avg_kpi_achievement': round(
            sum(k.achievement_percent() for k in kpis) / max(kpi_count, 1),
            1,
        ),
    }


def talent_overview_stats():
    """Statistiques avec mise à jour des statuts objectifs / alertes certif (hors polling)."""
    check_certification_alerts()
    for obj in Objective.objects.exclude(status='Completed'):
        obj.refresh_status()
        obj.save(update_fields=['status'])
    return talent_overview_stats_readonly()


def employee_talent_dossier(employee):
    check_certification_alerts(employee)
    reviews = employee.performance_reviews.all().order_by('-review_date')
    return {
        'performance_reviews': reviews,
        'average_stars': round(reviews.aggregate(avg=Avg('star_rating'))['avg'] or 0, 1),
        'trainings': employee.trainings.all(),
        'training_results': employee.training_results.all(),
        'skills': employee.employee_skills.select_related('skill', 'skill__category').all(),
        'certifications': employee.certifications.all(),
        'objectives': employee.objectives.all(),
        'kpis': employee.kpis.all(),
    }
