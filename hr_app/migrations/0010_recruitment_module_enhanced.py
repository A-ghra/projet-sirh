# Generated manually — module recrutement complet
import django.db.models.deletion
from django.db import migrations, models


def migrate_applicant_statuses(apps, schema_editor):
    Applicant = apps.get_model('hr_app', 'Applicant')
    mapping = {
        'New': 'PENDING', 'Interview': 'INTERVIEW_SCHEDULED',
        'Hired': 'ACCEPTED', 'Rejected': 'REJECTED',
    }
    for old, new in mapping.items():
        Applicant.objects.filter(status=old).update(status=new)


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0009_work_schedule_payroll_time'),
    ]

    operations = [
        migrations.AddField(
            model_name='userprofile',
            name='force_password_change',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='contract',
            name='benefits',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='contract',
            name='work_days_per_week',
            field=models.PositiveSmallIntegerField(blank=True, default=5, null=True),
        ),
        migrations.AddField(
            model_name='contract',
            name='work_schedule',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
        migrations.AlterField(
            model_name='employee',
            name='contract_type',
            field=models.CharField(
                choices=[
                    ('CDI', 'Contrat à Durée Indéterminée'),
                    ('CDD', 'Contrat à Durée Déterminée'),
                    ('Stage', 'Stage'),
                    ('Consultant', 'Consultant'),
                    ('Freelance', 'Freelance'),
                    ('Intérim', 'Intérim'),
                ],
                default='CDI', max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='nom',
            field=models.CharField(default='', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='postnom',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='prenom',
            field=models.CharField(default='', max_length=100),
        ),
        migrations.AlterField(
            model_name='applicant',
            name='full_name',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='applicant',
            name='civility',
            field=models.CharField(
                choices=[('M', 'Monsieur'), ('Mme', 'Madame'), ('Mlle', 'Mademoiselle')],
                default='M', max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='gender',
            field=models.CharField(
                choices=[('M', 'Homme'), ('F', 'Femme'), ('O', 'Autre')],
                default='M', max_length=1,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='date_of_birth',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='applicant',
            name='nationality',
            field=models.CharField(default='Congolaise', max_length=50),
        ),
        migrations.AddField(
            model_name='applicant',
            name='civil_status',
            field=models.CharField(
                choices=[
                    ('Célibataire', 'Célibataire'), ('Marié(e)', 'Marié(e)'),
                    ('Divorcé(e)', 'Divorcé(e)'), ('Veuf(ve)', 'Veuf(ve)'),
                ],
                default='Célibataire', max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='children_count',
            field=models.PositiveSmallIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='applicant',
            name='phone',
            field=models.CharField(blank=True, default='', max_length=30),
        ),
        migrations.AddField(
            model_name='applicant',
            name='address',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='applicant',
            name='city',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='province',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='country',
            field=models.CharField(default='RDC', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='postal_code',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='applicant',
            name='photo',
            field=models.ImageField(blank=True, null=True, upload_to='applicants/photos/'),
        ),
        migrations.AddField(
            model_name='applicant',
            name='department',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='applicants', to='hr_app.department',
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='manager',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='managed_applicants', to='hr_app.employee',
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='position',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.AddField(
            model_name='applicant',
            name='position_ref',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='applicants', to='hr_app.position',
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='salary_base',
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name='applicant',
            name='contract_type',
            field=models.CharField(
                choices=[
                    ('CDI', 'Contrat à Durée Indéterminée'),
                    ('CDD', 'Contrat à Durée Déterminée'),
                    ('Stage', 'Stage'),
                    ('Consultant', 'Consultant'),
                    ('Freelance', 'Freelance'),
                    ('Intérim', 'Intérim'),
                ],
                default='CDI', max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='contract_start',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='applicant',
            name='contract_end',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='applicant',
            name='work_days_per_week',
            field=models.PositiveSmallIntegerField(default=5),
        ),
        migrations.AddField(
            model_name='applicant',
            name='work_schedule',
            field=models.CharField(blank=True, default='08h00 - 17h00', max_length=50),
        ),
        migrations.AddField(
            model_name='applicant',
            name='create_user_account',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='applicant',
            name='user_role',
            field=models.CharField(
                choices=[
                    ('EMPLOYE', 'Employé'),
                    ('RESPONSABLE_HIERARCHIQUE', 'Manager'),
                    ('GESTIONNAIRE_RH', 'Responsable RH'),
                    ('GESTIONNAIRE_PAIE', 'Gestionnaire Paie'),
                    ('ADMIN_RH', 'Administrateur RH'),
                ],
                default='EMPLOYE', max_length=30,
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='employee',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='applicant_origin', to='hr_app.employee',
            ),
        ),
        migrations.AddField(
            model_name='applicant',
            name='converted_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='applicant',
            name='created_at',
            field=models.DateTimeField(auto_now_add=True, null=True),
        ),
        migrations.AddField(
            model_name='applicant',
            name='updated_at',
            field=models.DateTimeField(auto_now=True, null=True),
        ),
        migrations.AlterField(
            model_name='applicant',
            name='recruitment',
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name='applicants', to='hr_app.recruitment',
            ),
        ),
        migrations.AlterField(
            model_name='applicant',
            name='status',
            field=models.CharField(
                choices=[
                    ('PENDING', 'En attente'),
                    ('EVALUATING', 'En cours d\'évaluation'),
                    ('INTERVIEW_SCHEDULED', 'Entretien programmé'),
                    ('INTERVIEW_DONE', 'Entretien effectué'),
                    ('ACCEPTED', 'Accepté'),
                    ('REJECTED', 'Refusé'),
                ],
                default='PENDING', max_length=30,
            ),
        ),
        migrations.CreateModel(
            name='ApplicantBenefit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('label', models.CharField(max_length=100)),
                ('amount', models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ('description', models.CharField(blank=True, default='', max_length=255)),
                ('applicant', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='benefits', to='hr_app.applicant',
                )),
            ],
        ),
        migrations.RunPython(migrate_applicant_statuses, migrations.RunPython.noop),
    ]
