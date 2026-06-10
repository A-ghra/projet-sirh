# Generated manually — horaires de travail et champs temps de paie

from datetime import time

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0008_payroll_export_rdc'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkScheduleSettings',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('work_start', models.TimeField(default=time(8, 0))),
                ('work_end', models.TimeField(default=time(17, 0))),
                ('lunch_break_minutes', models.IntegerField(default=60)),
                ('hours_per_day', models.DecimalField(decimal_places=2, default=8.0, max_digits=4)),
                ('hours_per_week', models.DecimalField(decimal_places=2, default=40.0, max_digits=5)),
                ('working_days_per_week', models.IntegerField(default=5)),
                ('monthly_hours', models.DecimalField(decimal_places=2, default=208.0, max_digits=6)),
                ('overtime_rate_weekday', models.DecimalField(decimal_places=2, default=1.25, max_digits=4)),
                ('overtime_rate_weekend', models.DecimalField(decimal_places=2, default=1.5, max_digits=4)),
                ('overtime_rate_holiday', models.DecimalField(decimal_places=2, default=2.0, max_digits=4)),
                ('late_deduction_mode', models.CharField(
                    choices=[('NONE', 'Aucune retenue'), ('AUTO', 'Retenue automatique')],
                    default='NONE', max_length=10,
                )),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name_plural': 'Horaires de travail',
            },
        ),
        migrations.AddField(
            model_name='payroll',
            name='days_mission',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='payroll',
            name='hours_normal',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=8),
        ),
        migrations.AddField(
            model_name='payroll',
            name='hours_missing',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=8),
        ),
        migrations.AddField(
            model_name='payroll',
            name='hourly_rate',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='late_minutes',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='payroll',
            name='presence_rate',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=5),
        ),
        migrations.AddField(
            model_name='payroll',
            name='retenues_retards',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
    ]
