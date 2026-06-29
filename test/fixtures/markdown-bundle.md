## Katherine Johnson

- **UID:** md-katherine-johnson
- **First Name:** Katherine
- **Last Name:** Johnson
- **Organization:** NASA
- **Title:** Mathematician

### Email
- **Work, Preferred:** katherine@example.test

### Phone
- **Work:** +1-555-0180

### Address
- **Work:**
  Langley Research Center
  Hampton, VA 23666
  USA

### Relationships
- **Colleague:** Dorothy Vaughan

### Notes
Trajectory calculations and careful verification. #space

The body contains mission context that should not disappear.

### Other Fields
- **mission_count:** 3
- **mission_roles:**
  - Mercury
  - Apollo
  - Space Shuttle
- **nested_calculation_record:**
  ```json
  {
    "type": "object",
    "value": {
      "method": "orbital mechanics",
      "verified_by": ["hand calculation", "machine comparison"],
      "confidence": 1
    }
  }
  ```

## Dorothy Vaughan

- **UID:** md-dorothy-vaughan
- **First Name:** Dorothy
- **Last Name:** Vaughan
- **Organization:** NASA
- **Title:** Supervisor

### Email
- **Work:** dorothy@example.test

### Relationships
- **Colleague:** Katherine Johnson

### Notes
Leader, teacher, and systems thinker. #space

Includes a second bundled Markdown body for bundle round-trip tests.

### Other Fields
- **programming_language:** FORTRAN
- **training_groups:**
  - West Area Computing
  - Programming transition
- **nested_leadership_record:**
  ```json
  {
    "type": "object",
    "value": {
      "teams": [
        { "name": "West Area Computing", "role": "supervisor" },
        { "name": "Analysis and Computation Division", "role": "specialist" }
      ],
      "preserves_nested_arrays": true
    }
  }
  ```
