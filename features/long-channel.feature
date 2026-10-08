Feature: A long channel stays light to draw (mw-q6n8m0.6)

  Scenario: mw-q6n8m0.6 AC1: a new message re-parses only itself, not the whole channel
    Given a General channel of 200 messages is open
    When one new message arrives in the database
    Then the Markdown parser ran for the new message only

  Scenario: mw-q6n8m0.6 AC2: only the newest messages are drawn, with Show earlier above them
    Given a General channel of 200 messages is open
    Then only the newest 60 messages are on the screen
    And a reply row and a question card inside that window still show
    When he taps Show earlier until it is gone
    Then all 200 messages are on the screen

  Scenario: mw-q6n8m0.6 AC3: typing does not redraw a single message
    Given a General channel of 200 messages is open
    When he types a sentence into the composer
    Then no message was redrawn
