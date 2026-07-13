## Ada Lovelace

- **UID:** md-ada-lovelace
- **First Name:** Ada
- **Last Name:** Lovelace
- **Prefix:** Countess
- **Organization:** Difference Engine Society
- **Title:** Analytical collaborator

### Email
- **Home, Preferred:** ada@example.test

### Phone
- **Work:** +44-20-0000-1815

### Website
- **Home:** https://example.test/ada

### Address
- **Home:**
  12 St James Square
  London, England SW1Y
  United Kingdom

### Dates
- **Birthday:** 1815-12-10

### Relationships
- **Colleague:** Charles Babbage

### Tags
#math, #computing

### Notes
Met through a shared interest in computation. #math

Wrote notes intended to survive Markdown export and reimport.

### Other Fields
- **favorite_color:** #6a5acd
- **active:** true
- **research_topics:**
  - symbolic computation
  - notes on engines
  - algorithm design
- **nested_profile:**
  ```json
  {
    "type": "object",
    "value": {
      "source": "markdown-fixture",
      "confidence": 0.92,
      "empty_string": "",
      "optional_note": null,
      "aliases": [
        "Augusta Ada King",
        "Countess of Lovelace"
      ],
      "review": {
        "reviewer": "test-suite",
        "approved": true
      }
    }
  }
  ```

## Grace Hopper

- **UID:** md-grace-hopper
- **First Name:** Grace
- **Middle Name:** Brewster
- **Last Name:** Hopper
- **Prefix:** Rear Admiral
- **Organization:** Navy Computing Group
- **Title:** Compiler pioneer

### Email
- **Work:** grace@example.test

### Phone
- **Mobile, Preferred:** +1-555-0100

### Website
- **Work:** https://example.test/grace

### Relationships
- **Inspiration:** Ada Lovelace

### Notes
Keeps everything precise and practical. #computing

This body should survive round-trip serialization as Markdown, not just as plain notes.

### Other Fields
- **custom_clearance_level:** historical
- **favorite_number:** 9
- **languages:**
  - COBOL
  - FLOW-MATIC
- **nested_service_record:**
  ```json
  {
    "type": "object",
    "value": {
      "branch": "Navy",
      "ranks": [
        "Commodore",
        "Rear Admiral"
      ],
      "awards": {
        "compiler": {
          "year": 1952,
          "verified": true
        }
      }
    }
  }
  ```

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
      "verified_by": [
        "hand calculation",
        "machine comparison"
      ],
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
        {
          "name": "West Area Computing",
          "role": "supervisor"
        },
        {
          "name": "Analysis and Computation Division",
          "role": "specialist"
        }
      ],
      "preserves_nested_arrays": true
    }
  }
  ```
