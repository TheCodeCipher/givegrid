-- =====================================================================
-- schema.sql  —  every table, rule and trigger of the GiveGrid database
-- =====================================================================
-- Run by "npm run setup" (scripts/setup.js). You never run it by hand.
-- Setup creates an empty database first, then runs this whole file.
--
-- Big idea: the DATABASE refuses bad data by itself. Even if our
-- JavaScript had a bug, these rules would still stop:
--   * negative or impossible quantities      (CHECK)
--   * two accounts with one email            (UNIQUE)
--   * links to rows that do not exist        (FOREIGN KEY)
--   * missing required values                (NOT NULL)
--   * anyone editing or deleting history     (TRIGGER + privileges)
--
-- ENGINE=InnoDB on every table: InnoDB is the MySQL storage engine that
-- supports transactions, row locks and foreign keys. We need all three.
-- =====================================================================


-- ---------------------------------------------------------------------
-- users: every account (donor, NGO person, admin)
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            INT          AUTO_INCREMENT PRIMARY KEY,  -- 1, 2, 3... chosen by MySQL
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,             -- no two accounts with one email
    password_hash VARCHAR(255) NOT NULL,                    -- bcrypt hash, never the password
    role          VARCHAR(10)  NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_role CHECK (role IN ('DONOR', 'NGO', 'ADMIN'))
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- ngos: the NGO profile. One NGO account owns exactly one NGO.
-- An admin must set status to VERIFIED before the NGO can post needs or claim.
-- ---------------------------------------------------------------------
CREATE TABLE ngos (
    id         INT          AUTO_INCREMENT PRIMARY KEY,
    user_id    INT          NOT NULL UNIQUE,                -- UNIQUE = one NGO per account
    name       VARCHAR(150) NOT NULL,
    city       VARCHAR(100) NOT NULL,
    locality   VARCHAR(100) NULL,                           -- optional (area inside the city)
    status     VARCHAR(10)  NOT NULL DEFAULT 'PENDING',
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_ngos_status CHECK (status IN ('PENDING', 'VERIFIED', 'REJECTED')),
    CONSTRAINT fk_ngos_user FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- categories: fixed list of kinds of goods (filled at the bottom of this file)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    id   INT          AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- donations: something a donor is giving away.
--   total_quantity     = how many the donor offered. Never changes.
--   available_quantity = how many are still free to claim right now.
-- A claim lowers available_quantity. Only a cancel or an expiry raises it again.
-- ---------------------------------------------------------------------
CREATE TABLE donations (
    id                 INT          AUTO_INCREMENT PRIMARY KEY,
    donor_id           INT          NOT NULL,
    category_id        INT          NOT NULL,
    title              VARCHAR(150) NOT NULL,
    description        VARCHAR(500) NULL,
    total_quantity     INT          NOT NULL,
    available_quantity INT          NOT NULL,
    unit               VARCHAR(30)  NOT NULL,              -- e.g. "chairs", stored lowercase
    city               VARCHAR(100) NOT NULL,
    locality           VARCHAR(100) NULL,
    status             VARCHAR(10)  NOT NULL DEFAULT 'OPEN',  -- CLOSED = no new claims
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_donations_total     CHECK (total_quantity > 0),
    -- The key safety net: stock can never go below 0 or above the total.
    CONSTRAINT chk_donations_available CHECK (available_quantity >= 0 AND available_quantity <= total_quantity),
    CONSTRAINT chk_donations_status    CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT fk_donations_donor    FOREIGN KEY (donor_id)    REFERENCES users (id),
    CONSTRAINT fk_donations_category FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- needs: something an NGO is asking for.
--   quantity_required  = how many the NGO asked for. Never changes.
--   remaining_quantity = how many the NGO still needs.
-- ---------------------------------------------------------------------
CREATE TABLE needs (
    id                 INT          AUTO_INCREMENT PRIMARY KEY,
    ngo_id             INT          NOT NULL,
    category_id        INT          NOT NULL,
    title              VARCHAR(150) NOT NULL,
    quantity_required  INT          NOT NULL,
    remaining_quantity INT          NOT NULL,
    unit               VARCHAR(30)  NOT NULL,
    urgency            VARCHAR(10)  NOT NULL,
    city               VARCHAR(100) NOT NULL,
    locality           VARCHAR(100) NULL,
    status             VARCHAR(10)  NOT NULL DEFAULT 'OPEN',
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_needs_required  CHECK (quantity_required > 0),
    CONSTRAINT chk_needs_remaining CHECK (remaining_quantity >= 0 AND remaining_quantity <= quantity_required),
    CONSTRAINT chk_needs_urgency   CHECK (urgency IN ('LOW', 'MEDIUM', 'HIGH')),
    CONSTRAINT chk_needs_status    CHECK (status IN ('OPEN', 'CLOSED')),
    CONSTRAINT fk_needs_ngo      FOREIGN KEY (ngo_id)      REFERENCES ngos (id),
    CONSTRAINT fk_needs_category FOREIGN KEY (category_id) REFERENCES categories (id)
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- allocations: a CLAIM. "This many items of this donation go to this need."
-- This is the link table that makes donations <-> needs many-to-many:
-- one donation can be split across many needs, one need filled by many donations.
--
-- Life of a claim:
--   HELD -> CONFIRMED -> PICKED_UP -> DELIVERED -> RECEIVED
--   HELD -> EXPIRED          (48 hours passed without confirmation)
--   HELD or CONFIRMED -> CANCELLED   (NGO cancels before pickup)
-- EXPIRED and CANCELLED give the quantity back. Every other status keeps it used.
-- ---------------------------------------------------------------------
CREATE TABLE allocations (
    id          INT         AUTO_INCREMENT PRIMARY KEY,
    donation_id INT         NOT NULL,
    need_id     INT         NOT NULL,
    quantity    INT         NOT NULL,
    status      VARCHAR(12) NOT NULL,
    created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at  DATETIME    NOT NULL,                       -- created_at + 48 hours
    CONSTRAINT chk_alloc_quantity CHECK (quantity > 0),
    CONSTRAINT chk_alloc_status   CHECK (status IN
        ('HELD', 'CONFIRMED', 'PICKED_UP', 'DELIVERED', 'RECEIVED', 'CANCELLED', 'EXPIRED')),
    CONSTRAINT fk_alloc_donation FOREIGN KEY (donation_id) REFERENCES donations (id),
    CONSTRAINT fk_alloc_need     FOREIGN KEY (need_id)     REFERENCES needs (id)
) ENGINE=InnoDB;


-- ---------------------------------------------------------------------
-- donation_events: the HISTORY of every donation. Append-only:
-- new rows can be added, old rows can never be changed or removed.
--   seq = 1, 2, 3 ... counted separately for each donation.
--   actor_id = who did it. NULL means GiveGrid itself (the expiry timer).
-- ---------------------------------------------------------------------
CREATE TABLE donation_events (
    id            INT         AUTO_INCREMENT PRIMARY KEY,
    donation_id   INT         NOT NULL,
    seq           INT         NOT NULL,
    action        VARCHAR(30) NOT NULL,
    quantity      INT         NULL,
    actor_id      INT         NULL,
    allocation_id INT         NULL,
    created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No two events of the same donation can have the same number.
    CONSTRAINT uq_events_seq  UNIQUE (donation_id, seq),
    CONSTRAINT chk_events_seq CHECK (seq > 0),
    CONSTRAINT chk_events_action CHECK (action IN
        ('DONATION_POSTED', 'DONATION_CLOSED', 'CLAIM_HELD', 'HOLD_CONFIRMED', 'HOLD_EXPIRED',
         'CLAIM_CANCELLED', 'PICKED_UP', 'DELIVERED', 'RECEIPT_CONFIRMED')),
    CONSTRAINT fk_events_donation   FOREIGN KEY (donation_id)   REFERENCES donations (id),
    CONSTRAINT fk_events_actor      FOREIGN KEY (actor_id)      REFERENCES users (id),
    CONSTRAINT fk_events_allocation FOREIGN KEY (allocation_id) REFERENCES allocations (id)
) ENGINE=InnoDB;

-- Layer 1 of "append-only": triggers. A trigger is SQL that MySQL runs
-- automatically. BEFORE UPDATE / BEFORE DELETE fire before the change happens,
-- and SIGNAL raises an error, so the change is cancelled. This stops every
-- account, including the table's administrator.
-- (Layer 2, privileges, is in scripts/setup.js.)
CREATE TRIGGER donation_events_no_update
    BEFORE UPDATE ON donation_events FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'donation_events is append-only: UPDATE is not allowed';

CREATE TRIGGER donation_events_no_delete
    BEFORE DELETE ON donation_events FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'donation_events is append-only: DELETE is not allowed';


-- ---------------------------------------------------------------------
-- Indexes. MySQL already made an index for every PRIMARY KEY, every UNIQUE
-- and every FOREIGN KEY column. These extra ones each speed up one query.
-- Proof (EXPLAIN output): docs/02-DATABASE.md, section "Indexes".
-- ---------------------------------------------------------------------
-- Matching: "donations / needs with the same category and unit".
CREATE INDEX idx_donations_match ON donations (category_id, unit);
CREATE INDEX idx_needs_match     ON needs (category_id, unit);
-- Expiry timer: "HELD claims whose expires_at has passed".
CREATE INDEX idx_alloc_expiry    ON allocations (status, expires_at);
-- NOT added on purpose: an index on needs.status. Almost every need is OPEN,
-- so such an index would not narrow anything down (EXPLAIN showed MySQL ignores it).


-- ---------------------------------------------------------------------
-- Reference data. Medical supplies and food are deliberately NOT here.
-- ---------------------------------------------------------------------
INSERT INTO categories (name) VALUES
    ('Furniture'), ('Electronics'), ('Computers and IT equipment'), ('Clothing'),
    ('Books'), ('Educational supplies'), ('Construction materials'), ('Office equipment'),
    ('Event materials'), ('Household items'), ('Appliances');
