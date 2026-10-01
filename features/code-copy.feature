Feature: Every code block has a one-tap Copy button (mw-gq6.176)

  Scenario: AC-1: Copy puts the block's exact text on the clipboard and says Copied
    Given a code block with a multi-line command
    When Copy is tapped
    Then the clipboard holds the exact text
    And the button says Copied
