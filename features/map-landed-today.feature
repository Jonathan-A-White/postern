Feature: The Landed today tile opens the beads its count counted (mw-gq6.155)

  Scenario: mw-gq6.155: Landed today opens only what closed in the last 24 hours
    Given beads closed 2 hours, 30 hours and 6 days ago
    When the Map opens
    Then the Landed today tile counts 1
    When the Landed today tile is tapped
    Then the list is headed "Landed today · 1" and holds only the bead closed 2 hours ago

  Scenario: mw-gq6.155: the Done column still lists every closed bead
    Given beads closed 2 hours, 30 hours and 6 days ago
    When the Map opens on the Done column
    Then the list holds all three beads
