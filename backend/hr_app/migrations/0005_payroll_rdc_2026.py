from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('hr_app', '0004_module_customization'),
    ]

    operations = [
        migrations.AddField(
            model_name='payroll',
            name='currency',
            field=models.CharField(choices=[('USD', 'Dollar (USD)'), ('CDF', 'Franc congolais (CDF)')], default='USD', max_length=3),
        ),
        migrations.AddField(
            model_name='payroll',
            name='days_working',
            field=models.IntegerField(default=22),
        ),
        migrations.AddField(
            model_name='payroll',
            name='days_leave',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='payroll',
            name='overtime_rate',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=10),
        ),
        migrations.AddField(
            model_name='payroll',
            name='generated_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='generated_payrolls', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='payroll',
            name='verification_hash',
            field=models.CharField(blank=True, default='', max_length=64),
        ),
        migrations.AddField(
            model_name='payroll',
            name='prime_representation',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='indemnite_fonction',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='indemnite_speciale',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='inpp',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='assurance_sante',
            field=models.DecimalField(decimal_places=2, default=0.0, max_digits=12),
        ),
        migrations.AddField(
            model_name='payroll',
            name='leave_balance_previous',
            field=models.DecimalField(decimal_places=1, default=0.0, max_digits=5),
        ),
        migrations.AddField(
            model_name='payroll',
            name='leave_taken',
            field=models.DecimalField(decimal_places=1, default=0.0, max_digits=5),
        ),
        migrations.AddField(
            model_name='payroll',
            name='leave_balance_current',
            field=models.DecimalField(decimal_places=1, default=0.0, max_digits=5),
        ),
        migrations.AddField(
            model_name='payroll',
            name='absence_late_count',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='payroll',
            name='absence_justified_days',
            field=models.IntegerField(default=0),
        ),
        migrations.AddField(
            model_name='payroll',
            name='absence_unjustified_days',
            field=models.IntegerField(default=0),
        ),
    ]
