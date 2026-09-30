Feature: A Talk row shows the newest entry its thread shows, a bead's Mayor note included (mw-gq6.158)

  Scenario: mw-gq6.158: a Mayor note newer than the last message is the row's preview and order
    Given the bead "mw-l.1" is open with a message "Fixed, close on review" from "2" days ago
    And the bead "mw-l.1" has a Mayor note "Answered on Postern just now" from "10" minutes ago
    And the bead "mw-l.2" is open with a message "A newer message" from "1" day ago
    When Talk opens
    Then the row of "mw-l.1" previews "Answered on Postern just now"
    And the row of "mw-l.1" is listed above the row of "mw-l.2"

  Scenario: mw-gq6.158: a thread with only messages keeps its last message as the preview
    Given the bead "mw-l.3" is open with a message "Only a message" from "1" day ago
    When Talk opens
    Then the row of "mw-l.3" previews "Only a message"
