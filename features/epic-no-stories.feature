Feature: A held epic with no stories offers no Release anywhere (mw-gq6.159)

  Scenario: mw-gq6.159 AC1: a deferred epic with no stories shows no Release and says the Mayor drafts them
    Given the bead page of a deferred epic with no stories
    Then the page has no Release button and says "No stories yet: the Mayor drafts them."

  Scenario: mw-gq6.159 AC2: a deferred epic with one held story shows Release 1 held
    Given the bead page of a deferred epic with one held story
    Then the page offers the button "Release 1 held"
    And the page does not say "No stories yet: the Mayor drafts them."

  Scenario: mw-gq6.159 AC3: a deferred story still shows its own Release
    Given the bead page of a deferred story
    Then the page offers the button "Release"

  Scenario: mw-gq6.159 AC4: the Needs you card for an epic with no stories offers no Release
    Given a release card for an epic with no stories
    Then the card has no Release button and says "No stories yet: the Mayor drafts them."

  Scenario: mw-gq6.159 AC4: the Map page of a deferred epic with no stories offers no Release
    Given the Map opened on a deferred epic with no stories
    Then the Map has no Release button
