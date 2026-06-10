"""Agrégation des statistiques pour synchronisation temps réel frontend."""
from django.db.models import Count, Avg
from django.utils import timezone

from .models import (
    Employee, Recruitment, Applicant, Training, EmployeeTrainingResult,
    PerformanceReview, Absence, Attendance, Payroll, PayrollExportLog,
)
from .permissions import get_user_role, ROLE_MANAGER, ROLE_EMPLOYE
from .talent_service import training_dashboard_stats, talent_overview_stats_readonly


def _collect_dashboard_stats():
    from django.db.models import Sum
    from .models import Department, AuditLog
    from .serializers import AuditLogSerializer

    today = timezone.now().date()
    total = Employee.objects.filter(status='Active').count()
    payroll_mass = Employee.objects.filter(status='Active').aggregate(t=Sum('salary_base'))['t'] or 0
    absences_today = Absence.objects.filter(
        start_date__lte=today, end_date__gte=today, status='Approved',
    ).count()
    dept_stats = list(Department.objects.annotate(count=Count('employees')).values('name', 'count'))
    return {
        'total_employees': total,
        'payroll_mass': float(payroll_mass),
        'absences_today': absences_today,
        'open_recruitments': Recruitment.objects.filter(status='Open').count(),
        'trainings_count': Training.objects.count(),
        'evaluations_count': PerformanceReview.objects.count(),
        'recent_activities': AuditLogSerializer(AuditLog.objects.all()[:10], many=True).data,
        'department_distribution': dept_stats,
    }


def recruitment_sync_stats():
    today = timezone.now().date()
    applicants = Applicant.objects.all()
    by_status = dict(
        applicants.values('status').annotate(c=Count('id')).values_list('status', 'c')
    )
    return {
        'open_recruitments': Recruitment.objects.filter(status='Open').count(),
        'applicants_total': applicants.count(),
        'applicants_today': applicants.filter(created_at__date=today).count(),
        'interview_scheduled': by_status.get('INTERVIEW_SCHEDULED', 0),
        'accepted': by_status.get('ACCEPTED', 0),
        'rejected': by_status.get('REJECTED', 0),
        'hired': applicants.exclude(employee__isnull=True).count(),
        'by_status': by_status,
    }


def presences_sync_stats():
    today = timezone.now().date()
    month_start = today.replace(day=1)
    attendances_today = Attendance.objects.filter(date=today)
    attendances_month = Attendance.objects.filter(date__gte=month_start)
    total_month = attendances_month.count()
    present_month = attendances_month.filter(status='Present').count()
    return {
        'absences_today': Absence.objects.filter(
            start_date__lte=today, end_date__gte=today, status='Approved',
        ).count(),
        'pending_leaves': Absence.objects.filter(status='Pending').count(),
        'approved_leaves': Absence.objects.filter(status='Approved').count(),
        'present_today': attendances_today.filter(status='Present').count(),
        'late_today': attendances_today.filter(status='Late').count(),
        'absent_today': attendances_today.filter(status='Absent').count(),
        'attendance_rate_month': round(present_month / total_month * 100, 1) if total_month else 0,
    }


def payroll_sync_stats(month=None, year=None):
    from django.db.models import Sum as DbSum
    today = timezone.now().date()
    month = int(month) if month else today.month
    year = int(year) if year else today.year
    prefix = f'{year}-{month:02d}'
    qs = Payroll.objects.filter(month__startswith=prefix)
    exports_qs = PayrollExportLog.objects.filter(payroll__month__startswith=prefix)
    return {
        'total_bulletins': qs.count(),
        'draft_count': qs.filter(status='DRAFT').count(),
        'pending_count': qs.filter(status='PENDING').count(),
        'validated_count': qs.filter(status='VALIDATED').count(),
        'paid_count': qs.filter(status='PAID').count(),
        'exports_count': exports_qs.count(),
        'gross_mass': float(qs.aggregate(t=DbSum('gross_salary'))['t'] or 0),
        'net_mass': float(qs.aggregate(t=DbSum('net_salary'))['t'] or 0),
    }


def manager_sync_stats(user):
    emp = getattr(getattr(user, 'profile', None), 'employee', None)
    if not emp:
        return {'team_size': 0, 'pending_leaves': 0, 'team_reviews': 0, 'team_objectives': 0}
    team_qs = Employee.objects.filter(manager=emp, status='Active')
    team_ids = team_qs.values_list('id', flat=True)
    from .models import Objective
    return {
        'team_size': team_qs.count(),
        'pending_leaves': Absence.objects.filter(employee_id__in=team_ids, status='Pending').count(),
        'team_reviews': PerformanceReview.objects.filter(employee_id__in=team_ids).count(),
        'team_objectives': Objective.objects.filter(employee_id__in=team_ids).exclude(status='Completed').count(),
    }


def formation_sync_stats():
    stats = training_dashboard_stats()
    results = EmployeeTrainingResult.objects.all()
    completed = results.filter(completed=True).count()
    total_results = results.count()
    avg_score = results.filter(score__isnull=False).aggregate(avg=Avg('score'))['avg']
    stats['results_registered'] = total_results
    stats['avg_score'] = round(avg_score or 0, 1)
    stats['completion_rate'] = round(
        completed / stats['total_trainings'] * 100, 1,
    ) if stats['total_trainings'] else 0
    stats['participants_registered'] = Employee.objects.filter(trainings__isnull=False).distinct().count()
    return stats


def collect_sync_payload(request=None):
    """Payload complet pour polling / rafraîchissement frontend."""
    month = request.GET.get('month') if request else None
    year = request.GET.get('year') if request else None
    payload = {
        'timestamp': timezone.now().isoformat(),
        'dashboard': _collect_dashboard_stats(),
        'formation': formation_sync_stats(),
        'performance': talent_overview_stats_readonly(),
        'recruitment': recruitment_sync_stats(),
        'presences': presences_sync_stats(),
        'payroll': payroll_sync_stats(month, year),
    }
    if request and request.user.is_authenticated:
        role = get_user_role(request.user)
        if role == ROLE_MANAGER:
            payload['manager'] = manager_sync_stats(request.user)
        if role == ROLE_EMPLOYE:
            emp = getattr(request.user.profile, 'employee', None)
            if emp:
                payload['employee'] = {
                    'payslips_count': emp.payrolls.filter(status__in=['VALIDATED', 'PAID', 'ARCHIVED']).count(),
                    'leaves_count': emp.absences.count(),
                    'trainings_count': emp.trainings.count(),
                    'reviews_count': emp.performance_reviews.count(),
                    'objectives_count': emp.objectives.count(),
                    'notifications_count': emp.notifications.filter(is_read=False).count(),
                    'leave_balance': float(emp.leave_balance),
                }
    return payload
