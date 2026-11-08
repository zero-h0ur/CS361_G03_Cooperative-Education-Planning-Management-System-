# Confirmed department criteria — 2568 / round 1/69

Owner confirmation: 2026-11-08, in this project's conversation. The owner confirmed these are the department's actual criteria. Source authority here is that explicit confirmation; no additional official announcement was retrieved or invented. Status: local source, not RDS publication or deployment.

Canonical implementation: [shared criteria](../../src/shared/faculty-criteria.js), ID `TU_CS_2568_CONFIRMED_2026_11_08`. The existing eligibility baseline remains GPAX **2.75**, group GPA **2.50**, entry year **2567 or earlier**. All counted courses have **3 credits**; compare thresholds before rounding.

| Curriculum | Counted courses | Additional studies (enrolled or studied counts) |
| --- | --- | --- |
| 61 | CS101, CS102, CS111, program course, CS251, CS264 | CS384 AND at least one of CS266 / CS322 / CS348 |
| 66 | CS100, CS101, CS102, CS111, program course, CS251, CS261 | CS180 AND at least one of CS262 / CS331 / CS240 |

Program course is **CS213 for regular/CIS**, **CS216 for special/ACS**. The other program's course is excluded, not converted to zero/F. A retained registration program type takes precedence over a payload declaration; inconsistent major/program or selected course blocks readiness/review.

Every counted course must be **C (2.00) or higher**, even when the overall average exceeds 2.50. Use the highest grade. Input for a current Student form is one highest-grade value per course, not every attempt. The original schema's `attempt` index is retained for compatibility; a single recorded value does not establish how many times a student actually took that course. Owner clarification on 2026-11-08: the university registration system already prevents retaking after C, so **CO-ED does not check that registration rule and Coordinator is not required to recheck it**.

This counts 6 courses / 18 credits for curriculum 61 and 7 courses / 21 credits for curriculum 66, including one assigned program course. The other alternative is not counted twice. These sums are the group calculation, not an invented overall accumulated-credit eligibility threshold. See [local verification](../operations/confirmed-criteria-verification.md) for the current test/deployment boundary.

## Evidence and limitations

The server handles retained legacy attempt lists by using the highest valid grade, without validating registration eligibility or rejecting a record based on its position after a passing grade. C minima and program assignment remain enforced. **Coordinator compares the supplied highest grade and GPAX with Transcript**, together with the other existing evidence checks. CO-ED does not request an extra retake-history review or a Student declaration about no retake after C. No OCR/automatic Transcript verification is claimed.

The existing required-course acknowledgement now names these conditions and stores `academic_criteria_acknowledgement=<criteria ID>` when explicitly checked. Old Draft acknowledgement booleans alone do not assert acceptance of the stronger new statement. New readiness/Submit requires the current ID and the existing seven true acknowledgements. Old immutable submitted statements and payloads are not rewritten. A historical pending submission without the new acknowledgement can still be manually reviewed against the current policy, with separate Coordinator evidence; it is not relabeled as Student acceptance of a new statement.

## Versioned policy publication prerequisite

Actual review certification still requires the latest verified, non-synthetic policy for the exact cycle/curriculum, source year 2568 and a nonempty source reference. `faculty.policyData(curriculum)` prepares the required data:

```json
{
  "criteria_id": "TU_CS_2568_CONFIRMED_2026_11_08",
  "credits": {"<each required/alternative course code>": "3"},
  "repeat_rule": "HIGHEST",
  "alternative_rule": "PROGRAM_TYPE",
  "course_grade_min": "2.00",
  "grade_input": "HIGHEST_ONLY"
}
```

The credits object above is a schematic example, not an executable policy. The shared helper includes all course codes, including both CS213 and CS216. An old `LATEST`/`STUDENT_SELECTED` policy, contradictory credits, missing fields, synthetic policy or unverified record cannot certify under this contract; the result stays `UNKNOWN` until a matching policy is published. Knowing the criteria in source does not manufacture a verified RDS policy.

Publish a **new version**, retain the original policy rows, and never update an old submission's pinned policy. Policy publishing needs separately approved owner access/data operation. The runtime gains no policy write privileges. New Draft readiness and new submission snapshots use/pin this criteria version. Historical submitted views retain their old criteria/attempt display; current corrections use the current contract and require re-acknowledgement as appropriate.

The new academic-review 023 files are still uncommitted and unreleased. Their review guard now requires this exact contract and 3-credit metadata, and their hashes were updated together. No historical migration bytes/checksums were changed. Review/handoff operation IDs, scope, deadlines, locks, immutable evidence and maintenance gates remain as in the [handoff contract](v4-academic-review.md).
