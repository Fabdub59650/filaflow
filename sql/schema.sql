-- ============================================================
--  FilaFlow — schéma de base de données
--  Gestion du stock de filament : bobines, pesées, puces NFC
--  Idempotent : peut être rejoué sans perte de données.
-- ============================================================

CREATE TABLE IF NOT EXISTS `filaments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `brand` varchar(100) DEFAULT NULL,
  `material` enum('PLA','PETG','ABS','ASA','TPU','Nylon','PC','HIPS','PVA','autre') DEFAULT 'PLA',
  `color_name` varchar(50) DEFAULT NULL,
  `color_hex` varchar(7) DEFAULT '#cccccc',
  `diameter` decimal(4,2) DEFAULT 1.75,
  `temp_nozzle_min` int(11) DEFAULT 190,
  `temp_nozzle_max` int(11) DEFAULT 230,
  `temp_bed_min` int(11) DEFAULT 0,
  `temp_bed_max` int(11) DEFAULT 60,
  `weight_total` decimal(8,2) DEFAULT 1000.00,
  `weight_remaining` decimal(8,2) DEFAULT 1000.00,
  `price` decimal(8,2) DEFAULT NULL,
  `spoolman_id` int(11) DEFAULT NULL,
  `location` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `archived` tinyint(1) DEFAULT 0,
  `nfc_uid` varchar(32) DEFAULT NULL COMMENT 'UID puce NFC liée à cette bobine',
  `spool_number` varchar(50) DEFAULT NULL COMMENT 'Numéro ou référence de la bobine',
  `elegoo_subtype` varchar(20) DEFAULT NULL COMMENT 'Sous-type ELEGOO pour encodage NFC',
  `supplier` varchar(100) DEFAULT NULL COMMENT 'Fournisseur / boutique d''achat',
  `purchase_date` date DEFAULT NULL COMMENT 'Date d''achat',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `finish_option` varchar(50) DEFAULT NULL COMMENT 'Finition : brillant, mat, soie, marbre, bois, carbone…',
  `special_option` varchar(50) DEFAULT NULL COMMENT 'Propriété : renforcé, flexible, conducteur…',
  `spool_weight` decimal(7,2) DEFAULT NULL COMMENT 'Poids de la bobine vide en grammes',
  `stock_alert_threshold` int(11) DEFAULT 20 COMMENT 'Pourcentage restant déclenchant l alerte (0=désactivé)',
  `parent_filament_id` int(11) DEFAULT NULL COMMENT 'ID du filament parent si bobine partielle',
  `spool_label` varchar(50) DEFAULT NULL COMMENT 'Étiquette libre ex: Bobine A, Reste commande mars',
  PRIMARY KEY (`id`),
  KEY `fk_filament_parent` (`parent_filament_id`),
  CONSTRAINT `fk_filament_parent` FOREIGN KEY (`parent_filament_id`) REFERENCES `filaments` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `filament_weighings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filament_id` int(11) NOT NULL,
  `gross_weight` decimal(8,2) NOT NULL COMMENT 'Poids brut lu sur balance (g)',
  `spool_weight` decimal(8,2) DEFAULT NULL COMMENT 'Poids bobine vide utilisé (g)',
  `net_weight` decimal(8,2) NOT NULL COMMENT 'Poids filament calculé (g)',
  `previous_weight` decimal(8,2) NOT NULL COMMENT 'Ancien poids restant avant pesée',
  `notes` varchar(200) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `filament_id` (`filament_id`),
  CONSTRAINT `filament_weighings_ibfk_1` FOREIGN KEY (`filament_id`) REFERENCES `filaments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `nfc_write_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filament_id` int(11) NOT NULL,
  `uid` varchar(32) DEFAULT NULL,
  `format` enum('printflow','elegoo') DEFAULT 'elegoo',
  `material` varchar(20) DEFAULT NULL,
  `subtype` varchar(20) DEFAULT NULL,
  `color_hex` varchar(7) DEFAULT NULL,
  `written_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `filament_id` (`filament_id`),
  CONSTRAINT `nfc_write_history_ibfk_1` FOREIGN KEY (`filament_id`) REFERENCES `filaments` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `spool_weights` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `brand` varchar(100) NOT NULL COMMENT 'Fabricant',
  `model` varchar(100) DEFAULT NULL COMMENT 'Modèle / référence',
  `weight_g` decimal(7,2) NOT NULL COMMENT 'Poids bobine vide (g)',
  `spool_size_g` int(11) DEFAULT 1000 COMMENT 'Taille bobine (g de filament)',
  `diameter_mm` decimal(4,2) DEFAULT 1.75,
  `notes` varchar(200) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `entity` varchar(50) NOT NULL,
  `entity_id` int(11) DEFAULT NULL,
  `action` varchar(30) NOT NULL,
  `detail` varchar(500) DEFAULT NULL,
  `diff` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_entity` (`entity`,`entity_id`),
  KEY `idx_date` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `settings` (
  `key_name` varchar(50) NOT NULL,
  `value` text DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`key_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Poids de référence des bobines vides ───────────────────
-- Insérés uniquement si la table est vide (première installation) :
-- ne réintroduit jamais des références supprimées volontairement.
INSERT INTO `spool_weights` (brand, model, weight_g, spool_size_g, diameter_mm, notes)
SELECT * FROM (
  SELECT 'Bambu Lab','Standard AMS','250.00','1000','1.75',NULL
  UNION ALL SELECT 'Bambu Lab','Lite','180.00','1000','1.75',NULL
  UNION ALL SELECT 'Bambu Lab','Matte','250.00','1000','1.75',NULL
  UNION ALL SELECT 'Elegoo','Standard','220.00','1000','1.75',NULL
  UNION ALL SELECT 'Elegoo','Rapid','195.00','1000','1.75',NULL
  UNION ALL SELECT 'Polymaker','PolyTerra','200.00','1000','1.75',NULL
  UNION ALL SELECT 'Polymaker','PolyLite','210.00','1000','1.75',NULL
  UNION ALL SELECT 'Prusament','Standard','201.00','1000','1.75',NULL
  UNION ALL SELECT 'Sunlu','Standard','210.00','1000','1.75',NULL
  UNION ALL SELECT 'Sunlu','S-Eco','190.00','1000','1.75',NULL
  UNION ALL SELECT 'Hatchbox','Standard','227.00','1000','1.75',NULL
  UNION ALL SELECT 'eSUN','Standard','230.00','1000','1.75',NULL
  UNION ALL SELECT 'eSUN','Refill','80.00','1000','1.75',NULL
  UNION ALL SELECT 'Fiberlogy','Standard','205.00','1000','1.75',NULL
  UNION ALL SELECT 'Extrudr','Standard','215.00','1000','1.75',NULL
  UNION ALL SELECT 'Fillamentum','Standard','220.00','1000','1.75',NULL
  UNION ALL SELECT 'FormFutura','Standard','210.00','1000','1.75',NULL
  UNION ALL SELECT 'Raise3D','Standard','230.00','1000','1.75',NULL
  UNION ALL SELECT 'ColorFabb','Standard','215.00','1000','1.75',NULL
  UNION ALL SELECT 'Generic','Carton','150.00','1000','1.75',NULL
  UNION ALL SELECT 'Generic','Plastique leger','180.00','1000','1.75',NULL
  UNION ALL SELECT 'Generic','Plastique lourd','250.00','1000','1.75',NULL
) AS defaults
WHERE NOT EXISTS (SELECT 1 FROM `spool_weights`);

-- ── Réglages par défaut ────────────────────────────────────
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('accent_color','#185FA5');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('auth_enabled','false');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('auth_password','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_destination','local');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_enabled','false');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_keep','7');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_last_run','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_last_status','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_nas_ip','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_nas_password','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_nas_share','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_nas_user','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_schedule','0 3 * * *');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('color_mode','');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('dark_from','20');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('dark_to','7');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('show_locations','true');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('show_prices','true');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('stock_alert_enabled','true');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('stock_alert_threshold','20');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('theme','blue');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('app_name','FilaFlow');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_nas_folder','/filaflow');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_path','/opt/filaflow/backups');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_library_enabled','false');
INSERT IGNORE INTO `settings` (key_name, value) VALUES ('backup_report_email','false');
