<!-- CONTACTGRAPH:CONTACT -->

---
contactgraph: 1
uid: md-katherine-johnson
fn: Katherine Johnson
name:
  given: Katherine
  family: Johnson
title: Mathematician
org: NASA
emails:
  - value: katherine@example.test
    types: [WORK, INTERNET, PREF]
phones:
  - value: "+1-555-0180"
    types: [WORK, VOICE]
addresses:
  - street: Langley Research Center
    city: Hampton
    state: VA
    zip: "23666"
    country: USA
    types: [WORK]
related:
  - uid: md-dorothy-vaughan
    name: Dorothy Vaughan
    type: colleague
fields:
  mission_count:
    type: number
    value: 3
  mission_roles:
    type: list
    value:
      - Mercury
      - Apollo
      - Space Shuttle
  nested_calculation_record:
    type: object
    value:
      method: orbital mechanics
      verified_by:
        - hand calculation
        - machine comparison
      confidence: 1
---
# Notes

Trajectory calculations and careful verification. #space

The body contains mission context that should not disappear.

<!-- CONTACTGRAPH:CONTACT -->

---
contactgraph: 1
uid: md-dorothy-vaughan
fn: Dorothy Vaughan
name:
  given: Dorothy
  family: Vaughan
title: Supervisor
org: NASA
emails:
  - value: dorothy@example.test
    types: [WORK, INTERNET]
related:
  - uid: md-katherine-johnson
    name: Katherine Johnson
    type: colleague
fields:
  programming_language:
    type: string
    value: FORTRAN
  training_groups:
    type: list
    value:
      - West Area Computing
      - Programming transition
  nested_leadership_record:
    type: object
    value:
      teams:
        - name: West Area Computing
          role: supervisor
        - name: Analysis and Computation Division
          role: specialist
      preserves_nested_arrays: true
---
# Notes

Leader, teacher, and systems thinker. #space

Includes a second bundled Markdown body for bundle round-trip tests.
