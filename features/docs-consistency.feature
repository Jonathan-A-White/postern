Feature: docs/api.md defers to docs/protocol.md for the message payload shape

  Scenario: AC-1: api.md's message payload example matches protocol.md §1 exactly
    Given docs/protocol.md's §1 envelope example
    And docs/api.md's message record example
    Then api.md's payload has exactly the same fields as protocol.md's envelope

  Scenario: AC-2: api.md names protocol.md as the source of truth for the payload shape
    Given docs/api.md's payload description
    Then it points to docs/protocol.md as the source of truth
