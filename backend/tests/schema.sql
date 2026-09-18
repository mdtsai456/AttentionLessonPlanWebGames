-- 測試資料庫的結構，取自正式庫 DDL。
-- 建表順序必須是父表在前，否則外鍵建立會失敗：
--   school ← student ← assessment_result ← 五張 *_result
--   school ← teacher

-- 參照資料：場域清單。student / teacher 都以外鍵掛在它底下，故必須最先建。
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
  -- student_id：純粹為了登入帳號而加的代理鍵。(grade, case_id) 每個場域都會重複
  -- （每場域都有 G1_S01），不能拿來當全域唯一的登入帳號，所以另外開一個
  -- AUTO_INCREMENT 欄位；不動原本的複合主鍵，assessment_result 等表的外鍵不受影響。
  `student_id` int NOT NULL AUTO_INCREMENT,
  -- account：真正拿來登入的全域唯一帳號，由 seed.py / 之後的正式灌檔流程指派
  -- 成 S0001 這種格式（見該檔）。DEFAULT NULL 而不是 DEFAULT ''：同一時間多筆
  -- 都還沒指派帳號時，UNIQUE 索引才不會因為「多個空字串重複」而炸掉
  -- （MySQL 的 UNIQUE 對 NULL 不視為重複，對空字串會）。
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
  `TGame_obstacleHitCount` int(11) DEFAULT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`,`uuid`),
  CONSTRAINT `fk_tgame_assessment` FOREIGN KEY (`grade`, `case_id`, `school`, `uuid`)
    REFERENCES `assessment_result` (`grade`, `case_id`, `school`, `uuid`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 老師名錄。掛在 school 底下（外鍵）。
CREATE TABLE IF NOT EXISTS `teacher` (
  `teacher_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  `password_hash` varchar(255) NOT NULL DEFAULT '',
  -- account：登入用的全域唯一帳號（見 student.account 的說明——teacher.name 只在
  -- 同一場域內唯一，不能直接當登入帳號）。由 seed_directory.py 指派成 T0001 這種格式。
  `account` varchar(20) DEFAULT NULL,
  PRIMARY KEY (`teacher_id`),
  UNIQUE KEY `uq_teacher_school_name` (`school`, `name`),
  UNIQUE KEY `uq_teacher_account` (`account`),
  CONSTRAINT `fk_teacher_school` FOREIGN KEY (`school`)
    REFERENCES `school` (`school`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 登入 token（帳密登入後發放）。刻意不叫 session：這個系統已經用 session 泛指
-- 「遊戲場次」（assessment_result），這裡是「登入憑證」，用 login_session 避免混淆。
-- teacher_id 與 (grade, case_id, school) 恰好一組非 NULL：老師登入只填 teacher_id，
-- 學生登入只填後三者。MySQL/MariaDB 的外鍵只要有一欄是 NULL 就不檢查該筆，
-- 所以兩種情況都合法，不用拆兩張表。
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
