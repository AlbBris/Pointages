# Pointages GCC — V1.13

## Objectif
Version locale basée sur la V1.9, simplifiée pour le chef de chantier et préparée pour une future connexion en ligne.

## Nouveautés
- Navigation simplifiée : Pointage, Semaine, Équipe, Intérim, Plus.
- Tâches et exports regroupés dans « Plus ».
- Actions secondaires du pointage rangées dans « Plus d’actions ».
- Nouveau suivi des arrivées intérimaires et fiches de liaison.
- Statuts de liaison : À envoyer, Envoyée, Complétée, Validée.
- Préparation d’un e-mail à l’agence via l’application de messagerie de l’appareil.
- Fiche de liaison imprimable / enregistrable en PDF.
- Champs agence : taux horaire, coefficient, panier, trajet, transport, durée hebdomadaire, contact.
- Rappels de fin de contrat et d’arrivée visibles dans l’application.
- Notifications locales optionnelles, vérifiées à l’ouverture de l’application.
- Nouvelle feuille Excel « Liaisons intérim ».
- Structure `integration` et jeton de liaison prévus pour la future version en ligne.

## Important
Cette version reste 100 % utilisable sans serveur : toutes les données sont stockées localement comme en V1.9.
Le mail automatique, le lien sécurisé envoyé à l’agence et les notifications push en arrière-plan seront activés plus tard lors du raccordement à une base en ligne.

## Compatibilité
Les données enregistrées par les versions V1.8/V1.9 sont normalisées automatiquement à l’ouverture.


## Correctif mobile V1.10.1
- Fenêtre de pointage plein écran sur téléphone.
- Pied de formulaire fixe avec bouton Enregistrer toujours visible.
- Prise en compte de la zone visible iOS/Safari et de la safe-area.
- Interface de statut/retard compactée sur petit écran.


## V1.11 — Pointage mobile rapide
- vue mobile centrée sur les personnes restant à pointer ;
- progression de la journée et filtre « À pointer / Tout le monde » ;
- jours compacts accessibles sans défilement horizontal ;
- cartes personnel transformées en lignes tactiles compactes ;
- filtres avancés masqués derrière un bouton ;
- après enregistrement sur téléphone, ouverture automatique du prochain compagnon à pointer ;
- toutes les fonctions V1.10.1 restent disponibles.


## V1.13 — Tâches & transmission iBAT

- L’onglet **Tâches** remplace **Semaine** dans la navigation principale.
- La synthèse de semaine reste accessible depuis **Plus**.
- Nouvel export **Saisie iBAT** : tableau hebdomadaire simplifié par personne + détail journalier.
- Le classeur Excel complet inclut aussi les feuilles **Saisie iBAT** et **Détail iBAT**.
- Champ **E-mail secrétaire / administratif** dans les paramètres chantier.
- Bouton **Partager à la secrétaire** : partage natif du fichier sur mobile si disponible ; sinon téléchargement du fichier et préparation d’un e-mail.
- Aucune dépendance serveur : la V1.13 reste entièrement utilisable en local.


## V1.13 — Export iBAT par personne et par tâche

- La feuille **Saisie iBAT** affiche désormais une ligne par personne et par tâche.
- Les heures de chaque tâche sont réparties clairement du lundi au vendredi.
- Chaque compagnon possède une ligne **TOTAL PERSONNE** avec ses heures journalières, son total hebdomadaire, ses absences et retards.
- La feuille **Détail iBAT** contient une ligne par personne / jour / tâche, pratique pour une ressaisie administrative ou un futur import.
- L'objectif est d'éviter toute recherche dans la grande feuille Ventilation.
