Feature: No notification for what he is already looking at (mw-gq6.166)

  Scenario: mw-gq6.166 AC-1: a push for a message on the channel a focused window shows makes no notification and asks the app to sync
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is focused and open on the channel "ops"
    When the push for that message arrives
    Then no notification is shown
    And the app is told to sync its inbox

  Scenario: mw-gq6.166 AC-2: a push with no focused window shows its notification
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is open on the channel "ops" but not focused
    When the push for that message arrives
    Then the notification is shown

  Scenario: mw-gq6.166 AC-3: a push for a channel other than the one on screen shows its notification
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is focused and open on the channel "plans"
    When the push for that message arrives
    Then the notification is shown

  Scenario: mw-gq6.166 AC-4: a push the app does not answer within 3 seconds shows its notification
    Given the app is focused and open but never answers
    When the push for a message arrives
    And 3 seconds pass
    Then the notification is shown

  Scenario: mw-gq6.166 AC-5: a shown notification is closed when the app renders its message
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is focused and open on the channel "plans"
    And the push for that message arrives
    And the notification is shown
    When he opens the channel "ops"
    Then the notification is closed

  Scenario: mw-gq6.166 AC-6: a decision card's push follows the same rule
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is focused and open on the channel "ops"
    When the push for that message arrives as a decision
    Then no notification is shown

  Scenario: mw-gq6.166 AC-7: a message in a hidden app does not close its notification
    Given the phone holds the Mayor's message in the channel "ops"
    And the app is focused and open on the channel "plans"
    And the push for that message arrives
    And the app is hidden
    When he opens the channel "ops"
    Then the notification is still shown
