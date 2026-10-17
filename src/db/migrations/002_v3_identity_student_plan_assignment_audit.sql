-- Issue #56: forward-only V3 identity, Student, Plan, assignment, and audit schema.
-- This migration preserves all V2 rows and deliberately creates no user,
-- identity, Student profile, assignment, or other fixture data.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE users (
    id UUID PRIMARY KEY,
    role TEXT NOT NULL,
    account_status TEXT NOT NULL DEFAULT 'ACTIVE',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_users_role
        CHECK (role IN ('STUDENT', 'ADVISOR', 'STAFF', 'ADMIN', 'SYSTEM')),
    CONSTRAINT chk_users_account_status
        CHECK (account_status IN ('ACTIVE', 'DISABLED')),
    CONSTRAINT chk_users_version CHECK (version >= 1)
);

CREATE TABLE external_identity_links (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,
    external_issuer TEXT COLLATE "C" NOT NULL,
    external_subject TEXT COLLATE "C" NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_external_identity_links_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_external_identity_links_revoked_by
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT uq_external_identity_links_identity
        UNIQUE (external_issuer, external_subject),
    CONSTRAINT chk_external_identity_links_status
        CHECK (status IN ('ACTIVE', 'REVOKED')),
    CONSTRAINT chk_external_identity_links_key
        CHECK (
            char_length(external_issuer) > 0
            AND external_issuer = btrim(external_issuer)
            AND char_length(external_subject) > 0
            AND external_subject = btrim(external_subject)
        ),
    CONSTRAINT chk_external_identity_links_revoked
        CHECK (
            (status = 'REVOKED' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
            OR
            (status = 'ACTIVE' AND revoked_at IS NULL AND revoked_by IS NULL)
        )
);

CREATE UNIQUE INDEX uq_external_identity_links_active_user
    ON external_identity_links (user_id)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_external_identity_links_resolution
    ON external_identity_links (external_issuer, external_subject, status);

ALTER TABLE students
    ADD COLUMN user_id UUID,
    ADD COLUMN student_number TEXT,
    ADD COLUMN full_name TEXT,
    ADD COLUMN preferred_name TEXT,
    ADD COLUMN institutional_email TEXT,
    ADD COLUMN department TEXT,
    ADD COLUMN program TEXT,
    ADD COLUMN major TEXT,
    ADD COLUMN academic_year INTEGER,
    ADD COLUMN enrollment_status TEXT,
    ADD COLUMN created_at TIMESTAMPTZ,
    ADD COLUMN version INTEGER;

UPDATE students
SET created_at = updated_at,
    version = 1;

ALTER TABLE students
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN created_at SET NOT NULL,
    ALTER COLUMN version SET DEFAULT 1,
    ALTER COLUMN version SET NOT NULL,
    ADD CONSTRAINT fk_students_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT uq_students_user UNIQUE (user_id),
    ADD CONSTRAINT chk_students_version CHECK (version >= 1),
    ADD CONSTRAINT chk_students_academic_year
        CHECK (academic_year IS NULL OR academic_year > 0),
    ADD CONSTRAINT chk_students_enrollment_status
        CHECK (enrollment_status IS NULL OR enrollment_status IN ('ACTIVE', 'INACTIVE')),
    ADD CONSTRAINT chk_students_preferred_name
        CHECK (
            preferred_name IS NULL
            OR (char_length(preferred_name) > 0 AND preferred_name = btrim(preferred_name))
        ),
    ADD CONSTRAINT chk_students_linked_profile_complete
        CHECK (
            user_id IS NULL
            OR (
                student_number IS NOT NULL AND char_length(btrim(student_number)) > 0
                AND full_name IS NOT NULL AND char_length(btrim(full_name)) > 0
                AND institutional_email IS NOT NULL AND char_length(btrim(institutional_email)) > 0
                AND department IS NOT NULL AND char_length(btrim(department)) > 0
                AND program IS NOT NULL AND char_length(btrim(program)) > 0
                AND major IS NOT NULL AND char_length(btrim(major)) > 0
                AND academic_year IS NOT NULL
                AND enrollment_status IS NOT NULL
            )
        );

CREATE UNIQUE INDEX uq_students_student_number
    ON students (student_number)
    WHERE student_number IS NOT NULL;

CREATE INDEX idx_students_staff_scope
    ON students (department, program, academic_year)
    WHERE user_id IS NOT NULL;

ALTER TABLE rounds
    ADD COLUMN semester INTEGER,
    ADD COLUMN status TEXT,
    ADD COLUMN end_date TIMESTAMPTZ;

-- Existing rounds have no approved operational state. CLOSED is the fail-closed
-- backfill and prevents review actions until an operator explicitly validates them.
UPDATE rounds SET status = 'CLOSED';

ALTER TABLE rounds
    ALTER COLUMN status SET NOT NULL,
    ADD CONSTRAINT chk_rounds_semester CHECK (semester IS NULL OR semester > 0),
    ADD CONSTRAINT chk_rounds_status CHECK (status IN ('OPEN', 'CLOSED'));

ALTER TABLE positions
    ADD CONSTRAINT uq_positions_id_company UNIQUE (id, company_id);

ALTER TABLE plans
    ADD COLUMN cycle_id UUID,
    ADD COLUMN company_id UUID,
    ADD COLUMN position_id UUID,
    ADD COLUMN notes TEXT,
    ADD COLUMN status TEXT,
    ADD COLUMN version INTEGER,
    ADD COLUMN created_at TIMESTAMPTZ,
    ADD COLUMN legacy_compatibility BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE plans
SET cycle_id = round_id,
    status = 'DRAFT',
    version = 1,
    created_at = updated_at,
    legacy_compatibility = TRUE;

ALTER TABLE plans
    ALTER COLUMN status SET DEFAULT 'DRAFT',
    ALTER COLUMN status SET NOT NULL,
    ALTER COLUMN version SET DEFAULT 1,
    ALTER COLUMN version SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP,
    ALTER COLUMN created_at SET NOT NULL,
    DROP CONSTRAINT fk_plans_student,
    ADD CONSTRAINT fk_plans_student
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_plans_cycle
        FOREIGN KEY (cycle_id) REFERENCES rounds(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_plans_company
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT,
    ADD CONSTRAINT fk_plans_position_company
        FOREIGN KEY (position_id, company_id)
        REFERENCES positions(id, company_id) ON DELETE RESTRICT,
    ADD CONSTRAINT chk_plans_status
        CHECK (status IN (
            'DRAFT', 'SUBMITTED', 'UNDER_REVIEW',
            'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
        )),
    ADD CONSTRAINT chk_plans_version CHECK (version >= 1),
    ADD CONSTRAINT chk_plans_notes
        CHECK (
            notes IS NULL
            OR (
                char_length(notes) BETWEEN 1 AND 2000
                AND notes = btrim(notes)
            )
        ),
    ADD CONSTRAINT chk_plans_position_requires_company
        CHECK (position_id IS NULL OR company_id IS NOT NULL),
    ADD CONSTRAINT chk_plans_round_cycle_compatibility
        CHECK (round_id IS NULL OR round_id = cycle_id),
    ADD CONSTRAINT chk_plans_v3_cycle_required
        CHECK (legacy_compatibility OR cycle_id IS NOT NULL),
    ADD CONSTRAINT chk_plans_submittable_fields
        CHECK (
            status IN ('DRAFT', 'CANCELLED')
            OR (cycle_id IS NOT NULL AND company_id IS NOT NULL AND position_id IS NOT NULL)
        );

CREATE UNIQUE INDEX uq_plans_active_student_cycle
    ON plans (student_id, cycle_id)
    WHERE status <> 'CANCELLED' AND cycle_id IS NOT NULL;

CREATE INDEX idx_plans_cycle_status ON plans (cycle_id, status);
CREATE INDEX idx_plans_company_position ON plans (company_id, position_id);

CREATE TABLE advisor_assignments (
    id UUID PRIMARY KEY,
    advisor_id UUID NOT NULL,
    student_id UUID NOT NULL,
    academic_year INTEGER NOT NULL,
    semester INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID,
    revocation_reason TEXT,
    assigned_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_advisor_assignments_advisor
        FOREIGN KEY (advisor_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_advisor_assignments_student
        FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE RESTRICT,
    CONSTRAINT fk_advisor_assignments_revoked_by
        FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_advisor_assignments_assigned_by
        FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_advisor_assignments_year CHECK (academic_year > 0),
    CONSTRAINT chk_advisor_assignments_semester CHECK (semester > 0),
    CONSTRAINT chk_advisor_assignments_status
        CHECK (status IN ('ACTIVE', 'REVOKED', 'EXPIRED')),
    CONSTRAINT chk_advisor_assignments_effective_period
        CHECK (effective_to > effective_from),
    CONSTRAINT chk_advisor_assignments_revoked
        CHECK (
            (
                status = 'REVOKED'
                AND revoked_at IS NOT NULL
                AND revoked_by IS NOT NULL
            )
            OR
            (
                status <> 'REVOKED'
                AND revoked_at IS NULL
                AND revoked_by IS NULL
                AND revocation_reason IS NULL
            )
        ),
    CONSTRAINT ex_advisor_assignment_no_overlap
        EXCLUDE USING gist (
            student_id WITH =,
            tstzrange(effective_from, effective_to, '[)') WITH &&
        ) WHERE (status = 'ACTIVE')
);

CREATE INDEX idx_advisor_assignments_advisor_active
    ON advisor_assignments (advisor_id, academic_year, semester, effective_from, effective_to)
    WHERE status = 'ACTIVE';

CREATE INDEX idx_advisor_assignments_student
    ON advisor_assignments (student_id, status);

CREATE TABLE staff_scopes (
    id UUID PRIMARY KEY,
    staff_id UUID NOT NULL,
    department TEXT NOT NULL,
    program TEXT,
    academic_year INTEGER,
    status TEXT NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_staff_scopes_staff
        FOREIGN KEY (staff_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_staff_scopes_department
        CHECK (char_length(department) > 0 AND department = btrim(department)),
    CONSTRAINT chk_staff_scopes_program
        CHECK (program IS NULL OR (char_length(program) > 0 AND program = btrim(program))),
    CONSTRAINT chk_staff_scopes_academic_year
        CHECK (academic_year IS NULL OR academic_year > 0),
    CONSTRAINT chk_staff_scopes_status
        CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE UNIQUE INDEX uq_staff_scopes_unique
    ON staff_scopes (
        staff_id,
        department,
        COALESCE(program, ''),
        COALESCE(academic_year, 0)
    );

CREATE INDEX idx_staff_scopes_active_lookup
    ON staff_scopes (staff_id, department, program, academic_year)
    WHERE status = 'ACTIVE';

CREATE TABLE plan_operations (
    operation_id UUID PRIMARY KEY,
    plan_id UUID NOT NULL,
    actor_id UUID NOT NULL,
    action TEXT NOT NULL,
    request_hash CHAR(64) NOT NULL,
    response_status SMALLINT NOT NULL,
    response_payload JSONB NOT NULL,
    result_version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_plan_operations_plan
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
    CONSTRAINT fk_plan_operations_actor
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT chk_plan_operations_action
        CHECK (char_length(action) > 0 AND action = btrim(action)),
    CONSTRAINT chk_plan_operations_request_hash
        CHECK (request_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT chk_plan_operations_response_status
        CHECK (response_status BETWEEN 200 AND 299),
    CONSTRAINT chk_plan_operations_result_version CHECK (result_version >= 1)
);

CREATE INDEX idx_plan_operations_plan_created
    ON plan_operations (plan_id, created_at);

CREATE TABLE audit_events (
    event_id UUID PRIMARY KEY,
    plan_id UUID,
    actor_id UUID NOT NULL,
    actor_role TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID NOT NULL,
    from_state TEXT,
    to_state TEXT,
    notes TEXT,
    correlation_id UUID,
    operation_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_events_plan
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_actor
        FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE RESTRICT,
    CONSTRAINT fk_audit_events_operation
        FOREIGN KEY (operation_id) REFERENCES plan_operations(operation_id) ON DELETE RESTRICT,
    CONSTRAINT chk_audit_events_actor_role
        CHECK (actor_role IN ('STUDENT', 'ADVISOR', 'STAFF', 'ADMIN', 'SYSTEM')),
    CONSTRAINT chk_audit_events_action
        CHECK (char_length(action) > 0 AND action = btrim(action)),
    CONSTRAINT chk_audit_events_resource_type
        CHECK (char_length(resource_type) > 0 AND resource_type = btrim(resource_type)),
    CONSTRAINT chk_audit_events_from_state
        CHECK (
            from_state IS NULL OR from_state IN (
                'DRAFT', 'SUBMITTED', 'UNDER_REVIEW',
                'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
            )
        ),
    CONSTRAINT chk_audit_events_to_state
        CHECK (
            to_state IS NULL OR to_state IN (
                'DRAFT', 'SUBMITTED', 'UNDER_REVIEW',
                'NEEDS_REVISION', 'APPROVED', 'CANCELLED'
            )
        ),
    CONSTRAINT chk_audit_events_notes
        CHECK (
            notes IS NULL
            OR (
                char_length(notes) BETWEEN 1 AND 2000
                AND notes = btrim(notes)
            )
        )
);

CREATE INDEX idx_audit_events_plan_created
    ON audit_events (plan_id, created_at, event_id)
    WHERE plan_id IS NOT NULL;

CREATE INDEX idx_audit_events_resource_created
    ON audit_events (resource_type, resource_id, created_at, event_id);

CREATE INDEX idx_audit_events_correlation
    ON audit_events (correlation_id)
    WHERE correlation_id IS NOT NULL;

CREATE FUNCTION reject_immutable_row_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; % is not allowed', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_audit_events_immutable
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

CREATE TRIGGER trg_plan_operations_immutable
    BEFORE UPDATE OR DELETE ON plan_operations
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();

CREATE TRIGGER trg_advisor_assignments_no_delete
    BEFORE DELETE ON advisor_assignments
    FOR EACH ROW EXECUTE FUNCTION reject_immutable_row_mutation();
