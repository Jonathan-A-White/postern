Feature: Needs you offers Release only on a story that is still held (mw-tbx1n.19)

  Scenario: mw-tbx1n.19: a release card for a deferred story offers Release
    Given a release card whose story is "deferred"
    Then the card offers the button "Release"

  Scenario: mw-tbx1n.19: a release card for a building story says Already released: building
    Given a release card whose story is "in_progress"
    Then the card has no Release button and says "Already released: building"

  Scenario: mw-tbx1n.19: a release card for an open story says Already released
    Given a release card whose story is "open"
    Then the card has no Release button and says "Already released"

  Scenario: mw-tbx1n.19: a release card whose story is not known still offers Release
    Given a release card whose story is not in the view
    Then the card offers the button "Release"

  Scenario: mw-tbx1n.19: the bead page's fresher status wins over the view's
    Given a release card whose view says "deferred" but whose bead page says "in_progress"
    Then the card has no Release button and says "Already released: building"

  Scenario: mw-tbx1n.19: a release card for an epic with a held story under it offers Release
    Given a release card for an epic whose story "mw-f758y.31.2" is "deferred" and whose other stories are open
    Then the card offers the button "Release"

  Scenario: mw-tbx1n.19: a release card for an epic with no held story left says Already released
    Given a release card for an epic whose story "mw-f758y.31.2" is "open" and whose other stories are open
    Then the card has no Release button and says "Already released"
