Feature: The factory's pulse says what is up next (mw-njb33n.2)

  Scenario: mw-njb33n.2 AC1: a view with up_next shows Up next: 3 and the three titles open on a tap, each opening its bead
    Given a view whose host lists three stories in up_next
    When the pulse is drawn
    Then it says "Up next: 3" and shows no titles yet
    When he taps "Up next: 3"
    Then the three titles show, each a link to its bead

  Scenario: mw-njb33n.2 AC1: a view without up_next shows no Up next line
    Given a view whose hosts list no up_next
    When the pulse is drawn
    Then there is no Up next line
