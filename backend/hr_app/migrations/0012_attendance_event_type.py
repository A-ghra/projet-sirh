from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('hr_app', '0011_talent_modules_enhanced'),
    ]

    operations = [
        migrations.AddField(
            model_name='attendance',
            name='event_type',
            field=models.CharField(
                choices=[
                    ('presence', 'Présence'),
                    ('absence', 'Absence'),
                    ('leave', 'Congé'),
                    ('mission', 'Mission'),
                ],
                default='presence',
                max_length=20,
            ),
        ),
    ]
