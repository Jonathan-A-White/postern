Feature: The Question screen

  Scenario: AC-1: a decision-needed message with a §6 body opens the Question screen
    Given a decision-needed message carrying a §6 question is in the inbox
    When the inbox is opened, unlocked and the question message is tapped
    Then the Question screen shows the question text, "Recommended: ship", a button for each option and a free-text box

  Scenario: AC-2: tapping an option sends the reply, shows the txid and clears Needs you
    Given a decision-needed message carrying a §6 question is in the inbox
    And the same bead is listed under Needs you in the snapshot
    And the backend has spendable coins and accepts the broadcast
    And the inbox is opened, unlocked and the question message is tapped
    When the "wait" option is tapped
    Then the broadcast message decrypts to the reply {"bead":"mw-epic.1","answer":"wait"}
    And the transaction id is shown
    And the Project screen no longer lists that bead under Needs you

  Scenario: AC-3: sending free text sends the reply and clears Needs you
    Given a decision-needed message carrying a §6 question is in the inbox
    And the same bead is listed under Needs you in the snapshot
    And the backend has spendable coins and accepts the broadcast
    And the inbox is opened, unlocked and the question message is tapped
    When free text "let's ship at 5pm" is typed and sent
    Then the broadcast message decrypts to the reply {"bead":"mw-epic.1","answer":"let's ship at 5pm"}
    And the Project screen no longer lists that bead under Needs you

  Scenario: AC-4: a plain decision-needed text with no §6 body shows as an ordinary message
    Given a decision-needed message with plain text is in the inbox
    When the inbox is opened and unlocked
    Then the message is shown as an ordinary message
    And tapping it does not open the Question screen

  Scenario: AC-5: tapping a Needs you row opens the same Question screen
    Given the same bead is listed under Needs you in the snapshot with no matching message synced
    And the Project screen is opened and unlocked
    When the Needs you row is tapped
    Then the Question screen shows the question text, "Recommended: ship", a button for each option and a free-text box
