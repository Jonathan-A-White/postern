Feature: Postern says what changed with each release (mw-s061bg.3)

  Scenario: AC-1: the Update ready banner names the waiting version and what is in it
    Given the changelog of the waiting build lists 2 new and 1 fixed in a version newer than the running one
    And Postern is open on a phone whose service worker has that build waiting
    Then the update banner shows the version with "2 new, 1 fixed" and a What's new button
    And the Update ready, tap to reload button is still there

  Scenario: AC-1: What's new on the banner opens the sheet with the waiting version's lines and a tap on Close puts it away
    Given the changelog of the waiting build lists 2 new and 1 fixed in a version newer than the running one
    And Postern is open on a phone whose service worker has that build waiting
    When he taps What's new on the banner
    Then the What's new sheet lists the waiting version's New lines before its Fixed line
    When he taps Close on the sheet
    Then the What's new sheet is gone

  Scenario: AC-1: with no changelog the banner reads as it always did
    Given the waiting build's changelog cannot be read
    And Postern is open on a phone whose service worker has that build waiting
    Then the update banner shows no What's new button
    And the Update ready, tap to reload button is still there

  Scenario: AC-1: the What's new sheet shows once after an update and not again
    Given the last version he saw was older than the running one
    When Postern opens
    Then the What's new sheet lists the versions since, newest first
    When he taps Close on the sheet
    And Postern opens again
    Then there is no What's new sheet

  Scenario: AC-1: a first install shows no sheet and remembers the version
    Given he has never seen a version before
    When Postern opens
    Then there is no What's new sheet
    And the running version is remembered

  Scenario: AC-1: About lists every version, and the version links to CHANGELOG.md on GitHub
    When the About screen is opened
    Then About lists every version with its lines
    And the version is a link to "https://github.com/Jonathan-A-White/postern/blob/main/CHANGELOG.md" at its heading

  Scenario: AC-1: Check for updates says Up to date when nothing is waiting
    When the About screen is opened
    And he taps Check for updates
    Then it says "Up to date"

  Scenario: AC-1: the shipped changelog tells the first release's story
    Then public/changelog.json has "What's new in the app" as a New line for the version after 0.5.10
    And CHANGELOG.md has a heading for that version with the same line
