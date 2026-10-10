Feature: Needs you shows a review or a decision from a hitl:<kind> bead (mw-42919u)

  Scenario: mw-42919u: a review need is decoded and drawn with its own chip and the body's Do this and Done when
    Given the view carries a review need whose body says Do this and Done when
    Then the card is chipped "Review" with its own icon
    And the card shows Do this and Done when as labelled parts

  Scenario: mw-42919u: a decision need is decoded and drawn with its own chip and the body's Do this and Done when
    Given the view carries a decision need whose body says Do this and Done when
    Then the card is chipped "Decision" with its own icon
    And the card shows Do this and Done when as labelled parts

  Scenario: mw-42919u: the review and decision chips differ from every other kind
    Given the view carries a review need and a decision need
    Then no two kinds share a label or an icon

  Scenario: mw-42919u: protocol.md's Needs-you table lists review and decision
    Given docs/protocol.md's Needs-you table
    Then it lists the kinds "review" and "decision"
