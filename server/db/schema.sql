CREATE TABLE photos (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rel_path      VARCHAR(700) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  file_name     VARCHAR(255) NOT NULL,
  orig_name     VARCHAR(255) NULL,
  width         INT UNSIGNED NULL,
  height        INT UNSIGNED NULL,
  file_size     BIGINT UNSIGNED NULL,
  file_mtime    DATETIME NULL,
  taken_at      DATETIME NULL,
  date_source   ENUM('exif','filename','folder','mtime','manual','unknown') NOT NULL DEFAULT 'unknown',
  rating        TINYINT UNSIGNED NULL,
  photographer  VARCHAR(100) NULL,
  indexed_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_path (rel_path),
  KEY idx_taken (taken_at),
  KEY idx_rating (rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tag_groups (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name      VARCHAR(100) NOT NULL UNIQUE,
  sort      INT NOT NULL DEFAULT 0,
  visible   TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tags (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  group_id  INT UNSIGNED NOT NULL,
  name      VARCHAR(150) NOT NULL,
  active    TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_group_name (group_id, name),
  FOREIGN KEY (group_id) REFERENCES tag_groups(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tag_aliases (
  alias     VARCHAR(150) NOT NULL PRIMARY KEY,
  tag_id    INT UNSIGNED NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE photo_tags (
  photo_id  INT UNSIGNED NOT NULL,
  tag_id    INT UNSIGNED NOT NULL,
  PRIMARY KEY (photo_id, tag_id),
  KEY idx_tag (tag_id),
  FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
