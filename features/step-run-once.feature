Feature: A step's run shows once in a bead's thread, and its output wraps on a phone (mw-t64a3.23)

  Scenario: mw-t64a3.23 AC1: a run said by a bead comment and by a message shows once, as the Mayor's message
    Given a hands step's run is recorded as a bead comment and sent as a message re his approval
    When the bead's thread is read
    Then the thread holds one card, from the Mayor

  Scenario: mw-t64a3.23 AC4: a long output line in a thread message wraps instead of scrolling
    Given a thread message whose output block holds a 120-character line
    When the thread is shown
    Then the message's Markdown is set to wrap its code
