Feature: The bead page offers Release only on a bead that has a path (mw-tcmhmh.1)

  Scenario: mw-tcmhmh.1: a held story with a path offers Release
    Given the bead page of a held story with a rig and a branch
    Then the page offers the button "Release"

  Scenario: mw-tcmhmh.1: a held bead with no path has no Release button
    Given the bead page of a held bead with no path
    Then the page has no Release button

  Scenario: mw-tcmhmh.1: a held bead with a rig but no branch has no Release button
    Given the bead page of a held bead with a rig but no branch
    Then the page has no Release button

  Scenario: mw-tcmhmh.1: a held bead with a branch but no rig has no Release button
    Given the bead page of a held bead with a branch but no rig
    Then the page has no Release button
