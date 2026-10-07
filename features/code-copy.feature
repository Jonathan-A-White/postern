Feature: Every code block has a one-tap Copy button (mw-gq6.176)

  Scenario: AC-1: Copy puts the block's exact text on the clipboard and says Copied
    Given a code block with a multi-line command
    When Copy is tapped
    Then the clipboard holds the exact text
    And the button says Copied

  Scenario: AC-2: Copy on a multi-line fenced block in a message copies its lines and nothing more (mw-6ww.92)
    Given a message holding a fenced block of several script lines
    When Copy is tapped on the block
    Then the clipboard holds exactly the block's lines joined by newlines
    And no line of it ends in a backslash
