Feature: The Projects and Project screens

  Scenario: AC-1: the Projects screen orders epics by priority with a question first, and shows counts
    Given the snapshot has a higher-priority epic with nothing needing him and a lower-priority epic holding a question
    When the Projects screen is opened and unlocked
    Then the epic holding the question is listed before the other epic
    And each epic's row shows its Needs you, Landed and Working counts

  Scenario: AC-2: the Project screen shows Needs you, Landed and Working in order, each sorted correctly
    Given the snapshot has one epic with two needs-you questions, two landings and two working stories
    When the Project screen is opened and unlocked
    Then the groups appear in the order Needs you, Landed, Working
    And the Needs you questions are listed oldest first
    And the Landed items are listed newest first
    And the Working stories are listed in-progress first, then ready by priority

  Scenario: AC-3: a failed fetch shows the cached snapshot with its age and offline
    Given the Projects screen has already fetched and cached a snapshot
    When the Projects screen is opened again while the backend is unreachable
    Then the cached snapshot is shown with "Offline, as of" and its age

  Scenario: AC-4: tapping a Needs you row opens the bead screen with the question's brief
    Given the snapshot has one epic with one needs-you question
    And the Project screen is opened and unlocked
    When the question's row is tapped
    Then the bead screen shows the question's title, "Needs you", its recommended answer and its options

  Scenario: AC-5: a non-snapshot body at /snapshot shows a friendly message, not a decoder error
    Given the backend answers /snapshot with the SPA's index.html instead of a snapshot
    When the Projects screen is opened and unlocked
    Then the Projects screen shows "No snapshot published yet" and no decoder error

  Scenario: mw-f758y.21.5 AC-1: a Discuss control on an epic row opens that epic's thread
    Given the snapshot has one epic
    And the Projects screen is opened and unlocked
    When the epic row's Discuss control is used
    Then the thread screen for that epic is shown, titled with the epic's own title

  Scenario: mw-f758y.21.5 AC-2: a Discuss control on a story row opens that bead's thread
    Given the snapshot has one epic with one needs-you question
    And the Project screen is opened and unlocked
    When the question row's Discuss control is used
    Then the thread screen for that bead is shown, titled with the question's title

  Scenario: mw-tfne4.18 AC2: a dismissed fingerprint prompt on the projects screen says "Unlock cancelled"
    Given the Projects screen is opened with a PRF-wrapped vault and the fingerprint prompt will be dismissed
    When "Unlock with your fingerprint" is tapped
    Then the error says "Unlock cancelled. Tap Unlock to try again."
    And the raw browser sentence and the w3.org link never appear
    And "Unlock with your fingerprint" is still offered
