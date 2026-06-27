---
constellation: 1
uid: md-ada-lovelace
fn: Ada Lovelace
name:
  prefix: Countess
  given: Ada
  family: Lovelace
title: Analytical collaborator
org: Difference Engine Society
emails:
  - value: ada@example.test
    types: [HOME, INTERNET, PREF]
phones:
  - value: "+44-20-0000-1815"
    types: [WORK, VOICE]
addresses:
  - street: 12 St James Square
    city: London
    state: England
    zip: SW1Y
    country: United Kingdom
    types: [HOME]
urls:
  - value: https://example.test/ada
    types: [PROFILE]
birthday: 1815-12-10
notes:
  - Existing structured note #math
related:
  - uid: md-charles-babbage
    name: Charles Babbage
    type: colleague
tags: [math, computing]
confidence_score: 0.98
source_metadata:
  collection: sample-fixtures
  imported_by: phase-5-tests
  reviewed: true
  empty_marker: ""
fields:
  favorite_color:
    type: color
    value: "#6a5acd"
  active:
    type: boolean
    value: true
  research_topics:
    type: list
    value:
      - symbolic computation
      - notes on engines
      - algorithm design
  nested_profile:
    type: object
    value:
      source: markdown-fixture
      confidence: 0.92
      empty_string: ""
      optional_note: null
      aliases:
        - Augusta Ada King
        - Countess of Lovelace
      review:
        reviewer: test-suite
        approved: true
---
# Notes

Met through a shared interest in computation. #math

- Wrote notes intended to survive Markdown export and reimport.
- Has both structured notes and a Markdown body.
