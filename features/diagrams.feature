Feature: A fenced mermaid block draws as a diagram (mw-hy6f4.2)

  Scenario: AC-4a: a message with a diagram shows the diagram
    Given a message with a fenced mermaid block whose diagram draws cleanly
    When the message is rendered
    Then the diagram is shown

  Scenario: AC-4b: a message with a broken diagram shows its text and the error
    Given a message with a fenced mermaid block whose diagram fails to draw
    When the message is rendered
    Then the block's source text is shown
    And the error is shown
