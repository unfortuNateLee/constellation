---
contactgraph: 1
uid: md-grace-hopper
fn: Grace Hopper
name:
  prefix: Rear Admiral
  given: Grace
  additional: Brewster
  family: Hopper
title: Compiler pioneer
org: Navy Computing Group
emails:
  - value: grace@example.test
    types: [WORK, INTERNET]
phones:
  - value: "+1-555-0100"
    types: [CELL, VOICE, PREF]
urls:
  - value: https://example.test/grace
    types: [WORK]
related:
  - uid: md-ada-lovelace
    name: Ada Lovelace
    type: inspiration
custom_clearance_level:
  type: string
  value: historical
fields:
  favorite_number:
    type: number
    value: 9
  languages:
    type: list
    value:
      - COBOL
      - FLOW-MATIC
  nested_service_record:
    type: object
    value:
      branch: Navy
      ranks:
        - Commodore
        - Rear Admiral
      awards:
        compiler:
          year: 1952
          verified: true
---
# Notes

Keeps everything precise and practical. #computing

This body should survive round-trip serialization as Markdown, not just as plain notes.
