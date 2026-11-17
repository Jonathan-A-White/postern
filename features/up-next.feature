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

  Scenario: mw-njb33n.7 AC1+2: a story that may run on any host is shown once, and the chip counts stories not rows
    Given a view where four hosts list the same two auto stories and one pinned story
    When the pulse is drawn
    Then it says "Up next: 3" and shows no titles yet
    When he taps "Up next: 3"
    Then each story shows once, the auto ones under "Any host"

  Scenario: mw-njb33n.7 AC3: a host that is not answering has no rows of its own and its pinned story waits for it
    Given a view where the desktop has not answered for hours and holds a pinned story
    When the pulse is drawn
    And he taps "Up next: 3"
    Then the pinned story says "waits for desktop" and no list is headed for the desktop's own rows

  Scenario: mw-njb33n.7 AC4: a story that cannot start yet shows the reason mw gives
    Given a view whose up_next story says it is waiting: shares a file with a running story
    When the pulse is drawn
    And he taps "Up next: 1"
    Then the story's row carries the reason

