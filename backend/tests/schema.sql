-- 測試資料庫的結構，取自正式庫 DDL。
-- 建表順序必須是父表在前，否則外鍵建立會失敗。

CREATE TABLE IF NOT EXISTS `student` (
  `grade` varchar(20) NOT NULL,
  `case_id` varchar(50) NOT NULL,
  `school` varchar(100) NOT NULL,
  PRIMARY KEY (`grade`,`case_id`,`school`)
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
