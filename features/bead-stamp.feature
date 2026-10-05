Feature: A bead page checks the chain stamp a landing left on it (mw-zuju64.1)

  Scenario: mw-zuju64.1: a stamp whose commitment and sealed body match this commit checks out
    Given a bead whose comment says it was stamped for a commit of its rig, and the chain holds that stamp
    When he opens the bead page
    Then the Stamp section shows "Checks out"
    And the Stamp section links to the transaction on the chain

  Scenario: mw-zuju64.1: a stamp made for a different commit says the commitment does not match
    Given a bead whose comment says it was stamped for a commit, but the chain's stamp was made for another
    When he opens the bead page
    Then the Stamp section shows "The commitment on chain does not match this commit"
    And the Stamp section does not show "Checks out"
