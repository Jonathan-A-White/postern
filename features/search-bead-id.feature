Feature: Search finds a bead by its id even when the phone's view lacks it

  Scenario: mw-t64a3.15: an id the view holds ranks that bead first, however it is typed
    Given the view holds the bead "mw-2rbm.10"
    When " MW-2RBM.10 -" is typed into Search
    Then the bead "mw-2rbm.10" is the first hit

  Scenario: mw-t64a3.15: an id the view lacks is offered, fetched and opened
    Given the view does not hold the bead "mw-eq5nn.4" but the backend does
    When "mw-eq5nn.4" is typed into Search and Open is tapped
    Then the bead screen for "mw-eq5nn.4" is opened

  Scenario: mw-t64a3.15: an id nobody knows says there is no such bead
    Given neither the view nor the backend holds the bead "mw-nope.9"
    When "mw-nope.9" is typed into Search and Open is tapped
    Then Search says "no bead mw-nope.9"
