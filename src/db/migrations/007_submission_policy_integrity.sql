-- Pin on first submission, not at an earlier draft save. Revisions keep the pin.
CREATE OR REPLACE FUNCTION snapshot_plan_submission() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE policy document_policies; student students; rule JSONB; ref JSONB;
BEGIN
  IF NEW.status = 'SUBMITTED' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.project_title IS NULL OR btrim(NEW.project_title) = '' THEN
      RAISE EXCEPTION 'Project title is required before submission'
        USING ERRCODE = '23514', CONSTRAINT = 'submission_project_required';
    END IF;
    SELECT * INTO student FROM students WHERE id = NEW.student_id;
    IF NOT EXISTS (SELECT 1 FROM plan_submissions WHERE plan_id=NEW.id)
      OR NEW.requirement_policy_id IS NULL THEN
      SELECT * INTO policy FROM document_policies WHERE cycle_id = NEW.cycle_id
        AND department = student.department AND program IN ('', student.program)
        ORDER BY (program <> '') DESC, version DESC LIMIT 1;
      IF NEW.requirement_policy_id IS NOT NULL AND NEW.requirement_policy_id IS DISTINCT FROM policy.id THEN
        RAISE EXCEPTION 'Document requirements changed; refresh and save references again'
          USING ERRCODE = '23514', CONSTRAINT = 'submission_policy_changed';
      END IF;
    ELSE
      SELECT * INTO policy FROM document_policies WHERE id = NEW.requirement_policy_id;
    END IF;
    IF policy.id IS NULL OR policy.cycle_id <> NEW.cycle_id OR policy.department <> student.department
      OR policy.program NOT IN ('', student.program) THEN
      RAISE EXCEPTION 'Staff must publish document requirements for this cycle first'
        USING ERRCODE = '23514', CONSTRAINT = 'submission_policy_required';
    END IF;
    FOR rule IN SELECT * FROM jsonb_array_elements(policy.requirements) LOOP
      SELECT value INTO ref FROM jsonb_array_elements(NEW.document_references)
        WHERE value->>'requirement_id' = rule->>'id';
      IF (rule->>'required')::boolean AND (ref IS NULL OR
        (coalesce(ref->>'reference','') = '' AND coalesce(ref->>'url','') = '')) THEN
        RAISE EXCEPTION 'A required document reference is missing'
          USING ERRCODE = '23514', CONSTRAINT = 'submission_reference_required';
      END IF;
      IF ref IS NOT NULL THEN
        IF rule->>'format' IS NOT NULL AND (lower(ref->>'format') IS DISTINCT FROM rule->>'format'
          OR right(lower(ref->>'filename'),char_length(rule->>'format')+1) IS DISTINCT FROM '.'||(rule->>'format')) THEN
          RAISE EXCEPTION 'Declared document format does not match requirements'
            USING ERRCODE = '23514', CONSTRAINT = 'submission_format_invalid';
        END IF;
        IF rule->>'filename_pattern' IS NOT NULL AND ref->>'filename' IS DISTINCT FROM
          replace(rule->>'filename_pattern','{student_number}',student.student_number) THEN
          RAISE EXCEPTION 'Declared document filename does not match requirements'
            USING ERRCODE = '23514', CONSTRAINT = 'submission_filename_invalid';
        END IF;
      END IF;
    END LOOP;
    NEW.requirement_policy_id := policy.id;
    INSERT INTO plan_submissions(id, plan_id, plan_version, policy_id, snapshot, submitted_by)
      VALUES (gen_random_uuid(), NEW.id, NEW.version, policy.id,
        jsonb_build_object('company_id',NEW.company_id,'position_id',NEW.position_id,
          'project_title',NEW.project_title,'notes',NEW.notes,'requirements',policy.requirements,
          'references',NEW.document_references), student.user_id);
  END IF;
  RETURN NEW;
END $$;
