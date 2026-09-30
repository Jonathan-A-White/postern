Feature: An epic's bead page offers Release for the stories held under it (mw-gq6.157)

  Scenario: mw-gq6.157 AC1: an epic page with two held stories offers Release 2 held and sends the release
    Given the bead page of an epic with two held stories, one behind an open blocker
    Then the page offers the button "Release 2 held"
    When he taps "Release 2 held"
    Then the release for the epic is sent

  Scenario: mw-gq6.157 AC2: an epic page with no held stories offers no Release
    Given the bead page of an epic with no held stories
    Then the page has no Release button

  Scenario: mw-gq6.157 AC3: a deferred story's page still offers a plain Release
    Given the bead page of a deferred story
    Then the page offers the button "Release"
