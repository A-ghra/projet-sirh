"""Peuplement des modules, fonctionnalités et champs personnalisés par défaut."""

from hr_app.models import AppModule, ModuleFeature, CustomField

DEFAULT_MODULES = [
    ('dashboard', 'Tableau de bord', 'Vue synthétique des indicateurs RH', 'fa-home', 1,
     'ADMIN_RH,GESTIONNAIRE_RH,RESPONSABLE_HIERARCHIQUE'),
    ('admin-personnel', 'Admin. Personnel', 'Gestion administrative des employés', 'fa-users-cog', 2,
     'ADMIN_RH,GESTIONNAIRE_RH'),
    ('contrats', 'Contrats', 'Gestion du cycle de vie des contrats de travail', 'fa-file-contract', 3,
     'ADMIN_RH,GESTIONNAIRE_RH,RESPONSABLE_HIERARCHIQUE,EMPLOYE'),
    ('paie', 'Gestion de la Paie', 'Calcul et bulletins de paie RDC', 'fa-money-bill-wave', 4,
     'ADMIN_RH,GESTIONNAIRE_RH'),
    ('presences', 'Présences & Congés', 'Suivi des présences et demandes de congés', 'fa-calendar-check', 5,
     'ADMIN_RH,GESTIONNAIRE_RH,RESPONSABLE_HIERARCHIQUE,EMPLOYE'),
    ('recrutement', 'Recrutement', 'Processus de recrutement et candidatures', 'fa-user-plus', 6,
     'ADMIN_RH,GESTIONNAIRE_RH'),
    ('formation', 'Formation', 'Plan de formation et certifications', 'fa-graduation-cap', 7,
     'ADMIN_RH,GESTIONNAIRE_RH'),
    ('performances', 'Performances', 'Évaluations et objectifs', 'fa-star', 8,
     'ADMIN_RH,GESTIONNAIRE_RH,RESPONSABLE_HIERARCHIQUE'),
    ('portail-employe', 'Portail Employé', 'Espace personnel de l\'employé', 'fa-user-circle', 9,
     'ADMIN_RH,GESTIONNAIRE_RH,EMPLOYE'),
    ('reporting', 'Reporting & Statistiques', 'Rapports et exports RH', 'fa-chart-pie', 10,
     'ADMIN_RH,GESTIONNAIRE_RH'),
]

PAYROLL_GAINS = [
    ('salary_base', 'Salaire de base', 'Rémunération mensuelle de base'),
    ('prime_fonction', 'Prime fonction', 'Prime liée à la fonction occupée'),
    ('prime_responsabilite', 'Prime responsabilité', 'Prime de responsabilité hiérarchique'),
    ('prime_rendement', 'Prime rendement', 'Prime basée sur le rendement'),
    ('prime_risque', 'Prime risque', 'Prime de risque professionnel'),
    ('prime_representation', 'Prime représentation', 'Prime de représentation'),
    ('prime_anciennete', 'Prime ancienneté', 'Prime calculée selon l\'ancienneté'),
    ('gratifications', 'Gratification', 'Gratifications exceptionnelles'),
    ('bonus_exceptionnel', 'Bonus exceptionnel', 'Bonus exceptionnel'),
    ('heures_supplementaires', 'Heures supplémentaires', 'Montant heures supplémentaires'),
]
PAYROLL_INDEMNITES = [
    ('prime_transport', 'Prime transport', 'Indemnité de transport'),
    ('prime_logement', 'Prime logement', 'Indemnité de logement'),
    ('prime_communication', 'Prime communication', 'Indemnité de communication'),
    ('indemnite_fonction', 'Indemnité fonction', 'Indemnité de fonction'),
    ('indemnite_speciale', 'Indemnité spéciale', 'Indemnité spéciale'),
    ('avantages_nature', 'Avantages nature', 'Avantages en nature'),
    ('autres_indemnites', 'Autres indemnités', 'Autres indemnités diverses'),
]

PAYROLL_RETENUES = [
    ('inpp', 'INPP', 'Institut National de Préparation Professionnelle'),
    ('assurance_sante', 'Assurance santé', 'Cotisation assurance santé'),
    ('avances_salaire', 'Avance salaire', 'Avances sur salaire'),
    ('prets_internes', 'Prêt interne', 'Remboursement prêts internes'),
    ('absences_non_justifiees', 'Absence NJ', 'Retenue pour absences non justifiées'),
    ('retenues_disciplinaires', 'Retenue disciplinaire', 'Retenues disciplinaires'),
    ('cotisations_syndicales', 'Cotisation syndicale', 'Cotisations syndicales'),
    ('autres_retenues', 'Autres retenues', 'Autres retenues diverses'),
]

PORTAL_SECTIONS = [
    ('dashboard', 'Tableau de bord', 'fa-chart-line', 'Vue synthétique personnelle'),
    ('profil', 'Mon Profil', 'fa-user', 'Informations personnelles et professionnelles'),
    ('bulletins', 'Mes bulletins de paie', 'fa-file-invoice-dollar', 'Historique des bulletins de paie'),
    ('contrats', 'Mes contrats', 'fa-file-contract', 'Contrats de travail et avenants'),
    ('conges', 'Mes congés', 'fa-umbrella-beach', 'Demandes et solde de congés'),
    ('presences', 'Mes présences', 'fa-clock', 'Présences et missions'),
    ('formations', 'Mes formations', 'fa-graduation-cap', 'Formations et programmes'),
    ('evaluations', 'Mes évaluations', 'fa-star', 'Évaluations de performance'),
    ('attestations', 'Mes attestations', 'fa-certificate', 'Attestations et certificats officiels'),
    ('documents', 'Mes documents RH', 'fa-folder-open', 'Documents administratifs'),
    ('carriere', 'Mon évolution de carrière', 'fa-route', 'Parcours et évolution professionnelle'),
    ('certifications', 'Mes certifications', 'fa-award', 'Certifications obtenues'),
    ('historique', 'Mon historique professionnel', 'fa-history', 'Historique des postes et missions'),
    ('notifications', 'Notifications', 'fa-bell', 'Alertes et notifications'),
]

RECRUITMENT_STEPS = [
    ('test_technique', 'Test technique', 'Évaluation des compétences techniques'),
    ('entretien_rh', 'Entretien RH', 'Entretien avec le service RH'),
    ('entretien_direction', 'Entretien Direction', 'Entretien avec la direction'),
    ('verification_references', 'Vérification des références', 'Contrôle des références professionnelles'),
    ('test_psychotechnique', 'Test psychotechnique', 'Évaluation psychologique et comportementale'),
    ('validation_finale', 'Validation finale', 'Décision finale de recrutement'),
]

TRAINING_TYPES = [
    ('programme_interne', 'Programme interne', 'Programme de formation interne'),
    ('programme_externe', 'Programme externe', 'Programme dispensé par un organisme externe'),
    ('categorie_management', 'Management', 'Catégorie : management et leadership'),
    ('categorie_technique', 'Technique', 'Catégorie : compétences techniques'),
    ('niveau_debutant', 'Niveau débutant', 'Niveau de compétence : débutant'),
    ('niveau_intermediaire', 'Niveau intermédiaire', 'Niveau de compétence : intermédiaire'),
    ('niveau_expert', 'Niveau expert', 'Niveau de compétence : expert'),
    ('certification', 'Certification', 'Programme de certification professionnelle'),
    ('organisme_formation', 'Organisme de formation', 'Partenaire ou organisme de formation'),
]

LEAVE_TYPES = [
    ('conge_annuel', 'Congé annuel', {'max_days': 24, 'approval_workflow': 'manager_rh', 'days_granted': 24}),
    ('conge_maladie', 'Congé maladie', {'max_days': 90, 'approval_workflow': 'rh', 'days_granted': 0}),
    ('conge_maternite', 'Congé maternité', {'max_days': 98, 'approval_workflow': 'rh', 'days_granted': 98}),
    ('conge_paternite', 'Congé paternité', {'max_days': 10, 'approval_workflow': 'rh', 'days_granted': 10}),
    ('conge_exceptionnel', 'Congé exceptionnel', {'max_days': 5, 'approval_workflow': 'manager', 'days_granted': 0}),
    ('conge_sans_solde', 'Congé sans solde', {'max_days': 365, 'approval_workflow': 'direction', 'days_granted': 0}),
    ('autorisation_absence', 'Autorisation d\'absence', {'max_days': 1, 'approval_workflow': 'manager', 'days_granted': 0}),
    ('mission_professionnelle', 'Mission professionnelle', {'max_days': 30, 'approval_workflow': 'manager_rh', 'days_granted': 0}),
    ('deplacement_professionnel', 'Déplacement professionnel', {'max_days': 15, 'approval_workflow': 'manager', 'days_granted': 0}),
]

ADMIN_PERSONNEL_TABS = [
    ('onglet_employes', 'Employés', 'fa-users', 'Liste et gestion des dossiers employés'),
    ('onglet_contrats', 'Contrats', 'fa-file-contract', 'Contrats de travail par employé'),
]

PRESENCE_TABS = [
    ('onglet_pointage', 'Pointage', 'fa-fingerprint', 'Enregistrement manuel des événements de présence'),
    ('onglet_recap', 'Récapitulatif', 'fa-chart-pie', 'Synthèse mensuelle des présences et absences'),
    ('onglet_presences', 'Présences', 'fa-clock', 'Rapport général des présences enregistrées'),
    ('onglet_grille', 'Grille de présence', 'fa-table', 'Grille mensuelle imprimable P/A/C/M'),
    ('onglet_conges', 'Congés', 'fa-umbrella-beach', 'Gestion des demandes de congés'),
    ('onglet_missions', 'Missions', 'fa-briefcase', 'Missions et déplacements'),
]

PERFORMANCE_KPIS = [
    ('kpi_objectifs', 'Objectifs individuels', {'weight': 30, 'scale': '0-100'}),
    ('kpi_competences', 'Compétences clés', {'weight': 25, 'scale': '0-100'}),
    ('kpi_ponctualite', 'Ponctualité', {'weight': 15, 'scale': '0-100'}),
    ('kpi_productivite', 'Productivité', {'weight': 20, 'scale': '0-100'}),
    ('kpi_collaboration', 'Esprit d\'équipe', {'weight': 10, 'scale': '0-100'}),
]

EVALUATION_METHODS = [
    ('eval_180', 'Évaluation 180°', {'description': 'Auto-évaluation + manager'}),
    ('eval_360', 'Évaluation 360°', {'description': 'Pairs, manager, auto-évaluation'}),
    ('eval_annuelle', 'Évaluation annuelle', {'description': 'Bilan annuel de performance'}),
    ('eval_semestrielle', 'Évaluation semestrielle', {'description': 'Point mi-parcours'}),
]

REPORT_WIDGETS = [
    ('w_effectif', 'Effectif total', 'fa-users', {'widget_type': 'stat', 'data_source': 'total_employees'}),
    ('w_masse', 'Masse salariale', 'fa-money-bill-wave', {'widget_type': 'stat', 'data_source': 'payroll_mass', 'format': 'money'}),
    ('w_hf', 'Répartition H/F', 'fa-venus-mars', {'widget_type': 'stat', 'data_source': 'gender_distribution'}),
    ('w_absent', 'Absentéisme', 'fa-chart-line', {'widget_type': 'stat', 'data_source': 'absenteeism_rate', 'suffix': '%'}),
    ('w_dept_bar', 'Répartition par département', 'fa-building', {'widget_type': 'chart', 'chart_type': 'bar', 'data_source': 'department_distribution'}),
    ('w_hf_pie', 'Répartition Homme/Femme', 'fa-chart-pie', {'widget_type': 'chart', 'chart_type': 'doughnut', 'data_source': 'gender_distribution'}),
    ('w_trend_line', 'Évolution des effectifs', 'fa-chart-area', {'widget_type': 'chart', 'chart_type': 'line', 'data_source': 'monthly_headcount'}),
    ('w_abs_bar', 'Absences mensuelles', 'fa-user-clock', {'widget_type': 'chart', 'chart_type': 'bar', 'data_source': 'monthly_absences'}),
    ('w_recruit', 'Recrutements', 'fa-briefcase', {'widget_type': 'stat', 'data_source': 'open_recruitments'}),
    ('w_training', 'Formations', 'fa-graduation-cap', {'widget_type': 'stat', 'data_source': 'trainings_count'}),
    ('w_eval', 'Évaluations', 'fa-star', {'widget_type': 'stat', 'data_source': 'evaluations_count'}),
    ('w_compare', 'Comparatif RH', 'fa-balance-scale', {'widget_type': 'chart', 'chart_type': 'bar', 'data_source': 'hr_comparison'}),
]

PERSONNEL_FIELDS = [
    ('cnss_number', 'Numéro CNSS', 'text', 'Numéro d\'affiliation CNSS', False, True, True, ''),
    ('fiscal_number', 'Numéro identification fiscale', 'text', 'Numéro fiscal de l\'employé', False, True, True, ''),
    ('internal_id', 'N° identification interne', 'text', 'Identifiant interne de l\'entreprise', False, True, True, ''),
    ('blood_group', 'Groupe sanguin', 'select', 'Groupe sanguin de l\'employé', False, True, True, '',
     ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    ('emergency_contact_name', 'Personne à contacter (urgence)', 'text', 'Contact en cas d\'urgence', False, True, True, ''),
    ('emergency_contact_phone', 'Téléphone urgence', 'phone', 'Numéro du contact d\'urgence', False, True, True, ''),
    ('nationality', 'Nationalité', 'text', 'Nationalité de l\'employé', False, True, True, 'Congolaise'),
    ('origin_province', 'Province d\'origine', 'text', 'Province d\'origine de l\'employé', False, True, True, ''),
]


def seed_module_config():
    print('--- Personnalisation des modules ---')
    module_map = {}
    for key, name, desc, icon, order, roles in DEFAULT_MODULES:
        mod, _ = AppModule.objects.update_or_create(
            key=key,
            defaults={
                'name': name, 'description': desc, 'icon': icon,
                'display_order': order, 'allowed_roles': roles, 'is_active': True,
            },
        )
        module_map[key] = mod

    paie = module_map['paie']
    for i, (fkey, fname, fdesc) in enumerate(PAYROLL_GAINS):
        ModuleFeature.objects.update_or_create(
            module=paie, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc,
                'feature_type': 'payroll_gain', 'is_active': True, 'display_order': i,
                'config': {'formula': 'manual'},
            },
        )
    offset = len(PAYROLL_GAINS)
    for i, (fkey, fname, fdesc) in enumerate(PAYROLL_INDEMNITES):
        ModuleFeature.objects.update_or_create(
            module=paie, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc,
                'feature_type': 'payroll_gain', 'is_active': True, 'display_order': offset + i,
                'config': {'formula': 'manual', 'category': 'indemnite'},
            },
        )
    for i, (fkey, fname, fdesc) in enumerate(PAYROLL_RETENUES):
        ModuleFeature.objects.update_or_create(
            module=paie, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc,
                'feature_type': 'payroll_retention', 'is_active': True, 'display_order': i,
                'config': {'formula': 'manual'},
            },
        )

    portail = module_map['portail-employe']
    for i, (fkey, fname, icon, fdesc) in enumerate(PORTAL_SECTIONS):
        ModuleFeature.objects.update_or_create(
            module=portail, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc, 'icon': icon,
                'feature_type': 'portal_section', 'is_active': True, 'display_order': i,
            },
        )

    recrut = module_map['recrutement']
    for i, (fkey, fname, fdesc) in enumerate(RECRUITMENT_STEPS):
        ModuleFeature.objects.update_or_create(
            module=recrut, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc,
                'feature_type': 'recruitment_step', 'is_active': True, 'display_order': i,
            },
        )

    formation = module_map['formation']
    for i, (fkey, fname, fdesc) in enumerate(TRAINING_TYPES):
        ModuleFeature.objects.update_or_create(
            module=formation, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc,
                'feature_type': 'training_type', 'is_active': True, 'display_order': i,
            },
        )

    personnel = module_map['admin-personnel']
    for i, (fkey, fname, icon, fdesc) in enumerate(ADMIN_PERSONNEL_TABS):
        ModuleFeature.objects.update_or_create(
            module=personnel, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc, 'icon': icon,
                'feature_type': 'menu_tab', 'is_active': True, 'display_order': i,
            },
        )

    presences = module_map['presences']
    for i, (fkey, fname, icon, fdesc) in enumerate(PRESENCE_TABS):
        ModuleFeature.objects.update_or_create(
            module=presences, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': fdesc, 'icon': icon,
                'feature_type': 'menu_tab', 'is_active': True, 'display_order': i,
            },
        )
    # Types de congés désactivés — gestion directe via les demandes de congés
    for i, (fkey, fname, config) in enumerate(LEAVE_TYPES):
        ModuleFeature.objects.update_or_create(
            module=presences, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': f'Workflow: {config.get("approval_workflow", "rh")}',
                'feature_type': 'leave_type', 'is_active': False, 'display_order': i,
                'config': config,
            },
        )
    ModuleFeature.objects.filter(
        module=presences,
        feature_type='leave_type',
    ).update(is_active=False)
    ModuleFeature.objects.filter(
        module=presences,
        feature_key__in=('onglet_types', 'onglet_types_conges', 'types_conges'),
    ).update(is_active=False)

    performances = module_map['performances']
    for i, (fkey, fname, config) in enumerate(PERFORMANCE_KPIS):
        ModuleFeature.objects.update_or_create(
            module=performances, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': f'Pondération: {config.get("weight", 0)}%',
                'feature_type': 'kpi_indicator', 'is_active': True, 'display_order': i,
                'config': config,
            },
        )
    offset = len(PERFORMANCE_KPIS)
    for i, (fkey, fname, config) in enumerate(EVALUATION_METHODS):
        ModuleFeature.objects.update_or_create(
            module=performances, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': config.get('description', ''),
                'feature_type': 'evaluation_method', 'is_active': True, 'display_order': offset + i,
                'config': config,
            },
        )

    reporting = module_map['reporting']
    for i, (fkey, fname, icon, config) in enumerate(REPORT_WIDGETS):
        ModuleFeature.objects.update_or_create(
            module=reporting, feature_key=fkey,
            defaults={
                'feature_name': fname, 'description': config.get('data_source', ''),
                'feature_type': 'report_widget', 'icon': icon, 'is_active': True, 'display_order': i,
                'config': config,
            },
        )

    for i, row in enumerate(PERSONNEL_FIELDS):
        fkey, fname, ftype, fdesc, required, visible, editable, default = row[:8]
        options = row[8] if len(row) > 8 else []
        CustomField.objects.update_or_create(
            module=personnel, field_key=fkey,
            defaults={
                'field_name': fname, 'field_type': ftype, 'description': fdesc,
                'required': required, 'visible': visible, 'editable': editable,
                'default_value': default, 'options': options, 'display_order': i,
            },
        )

    print(f'  {AppModule.objects.count()} modules, '
          f'{ModuleFeature.objects.count()} fonctionnalités, '
          f'{CustomField.objects.count()} champs personnalisés')
