Feature: The door and the bead page keep their guards (mw-xhtcup.12)

  Scenario: mw-xhtcup.12 AC-1: a locked key behind a passkey offers the fingerprint button
    Given a phone whose key is kept behind a passkey
    When the Unlock screen is shown
    Then the screen offers "Unlock with your fingerprint"

  Scenario: mw-xhtcup.12 AC-2: a dismissed fingerprint prompt says it was cancelled
    Given a phone whose key is kept behind a passkey
    And the fingerprint prompt will be dismissed
    When the Unlock screen is shown
    And he taps "Unlock with your fingerprint"
    Then the screen says "Unlock cancelled. Tap Unlock to try again."
    And the key is still locked

  Scenario: mw-xhtcup.12 AC-3: Me's Turn on subscribes this phone to notifications
    Given the key is unlocked and this phone is not yet subscribed
    When he opens Me and taps "Turn on"
    Then the push service is asked to subscribe with his key
    And a toast says "Notifications are on"

  Scenario: mw-xhtcup.12 AC-4: Me's Turn on shows why a subscription failed
    Given the key is unlocked and this phone is not yet subscribed
    And the push service will refuse with "Notification permission was not granted."
    When he opens Me and taps "Turn on"
    Then an error toast says "Notification permission was not granted."
    And "Turn on" is offered again

  Scenario: mw-xhtcup.12 AC-5: a Markdown description shows as a heading and a list
    Given a bead whose description is a Markdown heading and a two-item list
    When he opens the bead page
    Then the description has a heading "Plan" and the items "first step" and "second step"

  Scenario: mw-xhtcup.12 AC-6: a bead with no description says so
    Given a bead with no description
    When he opens the bead page
    Then the description says "No description."

  Scenario: mw-xhtcup.12 AC-7: the beads inside an epic are listed by priority, then name
    Given an epic holding a P2 story "Banana", a P1 story "Urgent" and a P2 story "Cherry"
    When he opens the bead page
    Then the beads inside it read "Urgent", "Banana", "Cherry"
