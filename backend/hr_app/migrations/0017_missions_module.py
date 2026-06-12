from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


def migrate_mission_statuses(apps, schema_editor):
    Mission = apps.get_model('hr_app', 'Mission')
    mapping = {
        'Pending': 'PENDING_APPROVAL',
        'Approved': 'APPROVED',
        'Rejected': 'CANCELLED',
        'Completed': 'COMPLETED',
    }
    for old, new in mapping.items():
        Mission.objects.filter(status=old).update(status=new)


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr_app', '0016_absence_justification'),
    ]

    operations = [
        migrations.AddField(
            model_name='mission',
            name='accommodation',
            field=models.CharField(blank=True, default='', max_length=150),
        ),
        migrations.AddField(
            model_name='mission',
            name='actual_expenses',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='mission',
            name='advance_amount',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='mission',
            name='approved_by',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='missions_approved', to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='mission',
            name='budget_allocated',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='mission',
            name='city',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='mission',
            name='closed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='mission',
            name='closure_difficulties',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='mission',
            name='closure_recommendations',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='mission',
            name='closure_results',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='mission',
            name='closure_summary',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='mission',
            name='comments',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='mission',
            name='country',
            field=models.CharField(blank=True, default='RDC', max_length=100),
        ),
        migrations.AddField(
            model_name='mission',
            name='created_at',
            field=models.DateTimeField(default=django.utils.timezone.now),
        ),
        migrations.AddField(
            model_name='mission',
            name='created_by',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='missions_created', to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='mission',
            name='daily_allowance',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='mission',
            name='end_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='mission',
            name='mission_number',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AddField(
            model_name='mission',
            name='payroll_synced',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='mission',
            name='province',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='mission',
            name='start_time',
            field=models.TimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='mission',
            name='transport_mode',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='mission',
            name='updated_at',
            field=models.DateTimeField(auto_now=True),
        ),
        migrations.AddField(
            model_name='mission',
            name='visited_organization',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AlterField(
            model_name='mission',
            name='description',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AlterField(
            model_name='mission',
            name='status',
            field=models.CharField(
                choices=[
                    ('PENDING_APPROVAL', 'En attente d\'approbation'),
                    ('APPROVED', 'Approuvée'),
                    ('IN_PROGRESS', 'En cours'),
                    ('COMPLETED', 'Terminée'),
                    ('CANCELLED', 'Annulée'),
                    ('Pending', 'En attente'),
                    ('Approved', 'Approuvé'),
                    ('Rejected', 'Refusé'),
                    ('Completed', 'Terminé'),
                ],
                default='PENDING_APPROVAL',
                max_length=30,
            ),
        ),
        migrations.RunPython(migrate_mission_statuses, migrations.RunPython.noop),
        migrations.CreateModel(
            name='MissionDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('doc_type', models.CharField(
                    choices=[
                        ('order', 'Ordre de mission'),
                        ('invitation', 'Invitation'),
                        ('authorization', 'Autorisation'),
                        ('ticket', 'Billet de transport'),
                        ('receipt', 'Justificatif'),
                        ('closure', 'Rapport de clôture'),
                        ('other', 'Autre'),
                    ],
                    default='other', max_length=30,
                )),
                ('label', models.CharField(blank=True, default='', max_length=200)),
                ('file', models.FileField(upload_to='missions/')),
                ('uploaded_at', models.DateTimeField(auto_now_add=True)),
                ('mission', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='documents', to='hr_app.mission',
                )),
                ('uploaded_by', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-uploaded_at']},
        ),
        migrations.CreateModel(
            name='MissionAuditLog',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('action', models.CharField(
                    choices=[
                        ('CREATE', 'Création'),
                        ('UPDATE', 'Modification'),
                        ('DELETE', 'Suppression'),
                        ('APPROVE', 'Validation'),
                        ('CANCEL', 'Annulation'),
                        ('START', 'Démarrage'),
                        ('CLOSE', 'Clôture'),
                        ('EXPORT', 'Exportation'),
                    ],
                    max_length=20,
                )),
                ('note', models.TextField(blank=True, default='')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('mission', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='audit_logs', to='hr_app.mission',
                )),
                ('user', models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={'ordering': ['-created_at']},
        ),
    ]
