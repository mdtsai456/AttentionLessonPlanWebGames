-- 測試資料庫的結構，取自正式庫 DDL。
-- 建表順序必須是父表在前，否則外鍵建立會失敗：
--   school ← student ← assessment_result ← 五張 *_result
--   school ← teacher

-- 場域清單。student／teacher 的外鍵皆指向此表，因此須先建立此表。
CREATE TABLE IF NOT EXISTS `school` (
  `school` varchar(100) NOT NULL,        -- 與 student.school 完全相同的字串
  `display_name` varchar(100) NOT NULL,  -- 前端下拉顯示用
  `sort_order` int NOT NULL DEFAULT 0,
  PRIMARY KEY (`school`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `student` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL DEFAULT '',
  -- student_id 是產生登入帳號所需的代理鍵。(grade, case_id) 可能在不同場域重複，
  -- 例如每個場域皆有 G1_S01，因此無法作為全域唯一的登入帳號。另設
  -- AUTO_INCREMENT 欄位，並保留既有複合主鍵與 assessment_result 等表的外鍵。
  `student_id` int NOT NULL AUTO_INCREMENT,
  -- account 是全域唯一的登入帳號。seed.py 或正式資料匯入流程
  -- 指派 S0001 格式的帳號。預設值使用 NULL，讓尚未指派帳號的多筆資料
  -- 可通過 UNIQUE 約束。若使用空字串，多筆資料會違反唯一性約束。
  -- MySQL 的 UNIQUE 允許多個 NULL 值，但不允許重複的空字串。
  `account` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`),
  UNIQUE KEY `uq_student_id` (`student_id`),
  UNIQUE KEY `uq_student_account` (`account`),
  CONSTRAINT `fk_student_school` FOREIGN KEY (`school`)
    REFERENCES `school` (`school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `assessment_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `start_time` datetime NOT NULL,
  `game_type` varchar(20) NOT NULL,
  `mode` enum('single','double') NOT NULL DEFAULT 'single',
  `pair_id` varchar(36) DEFAULT NULL,
  `current_day` int(11) NOT NULL,
  `end_time` datetime DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_assessment_student` FOREIGN KEY (`grade`, `case_id`, `school`)
    REFERENCES `student` (`grade`, `case_id`, `school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `dccs_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `level_accuracy` varchar(64) DEFAULT NULL,
  `avg_reaction_ms` double DEFAULT NULL,
  `question_count` int(11) DEFAULT NULL,
  `aim_ratio` double DEFAULT NULL,
  `focus_ms` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `frameWrongCount` int(11) DEFAULT NULL,
  `categoryWrongCount` int(11) DEFAULT NULL,
  `modelWrongCount` int(11) DEFAULT NULL,
  `frameCorrectCount` int(11) DEFAULT NULL,
  `categoryCorrectCount` int(11) DEFAULT NULL,
  `modelCorrectCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_dccs_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `dat_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `level_accuracy` varchar(64) DEFAULT NULL,
  `avg_reaction_ms` double DEFAULT NULL,
  `question_count` int(11) DEFAULT NULL,
  `aim_ratio` double DEFAULT NULL,
  `focus_ms` double DEFAULT NULL,
  `DAT_avgReactionTime` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `DAT_outOfTarget` int(11) DEFAULT NULL,
  `DAT_wrongClickWhenShouldNot` int(11) DEFAULT NULL,
  `DAT_missedClickWhenShouldClick` int(11) DEFAULT NULL,
  `DAT_wrongMathAnswer` int(11) DEFAULT NULL,
  `DAT_wrongColorMatch` int(11) DEFAULT NULL,
  `DAT_wrongColorText` int(11) DEFAULT NULL,
  `DAT_correctClickWhenShouldNot` int(11) DEFAULT NULL,
  `DAT_correctClickWhenShouldClick` int(11) DEFAULT NULL,
  `DAT_correctMathAnswer` int(11) DEFAULT NULL,
  `DAT_correctColorMatch` int(11) DEFAULT NULL,
  `DAT_correctColorText` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_dat_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `eft_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `level_accuracy` varchar(64) DEFAULT NULL,
  `avg_reaction_ms` double DEFAULT NULL,
  `question_count` int(11) DEFAULT NULL,
  `aim_ratio` double DEFAULT NULL,
  `focus_ms` double DEFAULT NULL,
  `EFT_avgReactionTime` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `EFT_wrongDirectionCount` int(11) DEFAULT NULL,
  `EFT_wrongColorDistractionCount` int(11) DEFAULT NULL,
  `EFT_wrongDottedLineCount` int(11) DEFAULT NULL,
  `EFT_wrongMovingBubbleCount` int(11) DEFAULT NULL,
  `EFT_correctDirectionCount` int(11) DEFAULT NULL,
  `EFT_correctColorDistractionCount` int(11) DEFAULT NULL,
  `EFT_correctDottedLineCount` int(11) DEFAULT NULL,
  `EFT_correctMovingBubbleCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_eft_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `im_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `level_accuracy` varchar(64) DEFAULT NULL,
  `avg_reaction_ms` double DEFAULT NULL,
  `question_count` int(11) DEFAULT NULL,
  `aim_ratio` double DEFAULT NULL,
  `focus_ms` double DEFAULT NULL,
  `levelsPlayed` varchar(255) DEFAULT NULL,
  `take_played` int(11) DEFAULT NULL,
  `take_passed` int(11) DEFAULT NULL,
  `take_failed` int(11) DEFAULT NULL,
  `place_played` int(11) DEFAULT NULL,
  `place_passed` int(11) DEFAULT NULL,
  `place_failed` int(11) DEFAULT NULL,
  `goto_played` int(11) DEFAULT NULL,
  `goto_passed` int(11) DEFAULT NULL,
  `goto_failed` int(11) DEFAULT NULL,
  `IM_stages` longtext DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_im_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `tgame_result` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `uuid` varchar(36) NOT NULL,
  `correct_count` int(11) DEFAULT NULL,
  `wrong_count` int(11) DEFAULT NULL,
  `accuracy` double DEFAULT NULL,
  `duration` double DEFAULT NULL,
  `stage` int(11) DEFAULT NULL,
  `level_accuracy` varchar(64) DEFAULT NULL,
  `avg_reaction_ms` double DEFAULT NULL,
  `question_count` int(11) DEFAULT NULL,
  `aim_ratio` double DEFAULT NULL,
  `focus_ms` double DEFAULT NULL,
  `TGame_obstacleHitCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_tgame_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 老師名錄。外鍵指向 school。
CREATE TABLE IF NOT EXISTS `teacher` (
  `teacher_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL DEFAULT '',
  -- account 是全域唯一的登入帳號，見 student.account 說明。teacher.name 僅在同一場域內唯一，
  -- 無法作為登入帳號。seed_directory.py 指派 T0001 格式的帳號。
  `account` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teacher_school_name` (`school`, `name`),
  UNIQUE KEY `uq_teacher_account` (`account`),
  CONSTRAINT `fk_teacher_school` FOREIGN KEY (`school`)
    REFERENCES `school` (`school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 帳號與密碼驗證成功後，發放登入 token。本系統以 session 表示遊戲場次，
-- 對應 assessment_result。登入憑證則使用 login_session，避免名稱混淆。
-- teacher_id 與 (grade, case_id, school) 僅有一組為非 NULL。老師登入只填 teacher_id，
-- 學生登入只填後三個欄位。MySQL／MariaDB 的外鍵包含 NULL 時，不檢查該筆資料，
-- 因此兩種登入憑證可使用同一張表。
CREATE TABLE IF NOT EXISTS `login_session` (
  `token` varchar(64) NOT NULL,
  `subject_type` enum('teacher','student') NOT NULL,
  `teacher_id` int DEFAULT NULL,
  `grade` varchar(20) DEFAULT NULL,
  `case_id` varchar(50) DEFAULT NULL,
  `school` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `expires_at` datetime NOT NULL,
  PRIMARY KEY (`token`),
  CONSTRAINT `fk_login_session_teacher` FOREIGN KEY (`teacher_id`)
    REFERENCES `teacher` (`teacher_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_login_session_student` FOREIGN KEY (`grade`, `case_id`, `school`)
    REFERENCES `student` (`grade`, `case_id`, `school`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
