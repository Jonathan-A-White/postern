Feature: The phone's history does not grow without end, and tidying it never walks the whole of a table (mw-gq6.718)

  Scenario: mw-gq6.718 AC-1: a long history of events is cut to the newest when the app is shown, every emergency stays, at his phone's pace
    Given the phone holds a long history of events, all projected, and two emergencies among the oldest, one tapped away
    When the app is shown and tidies its history, at his phone's pace
    Then only the newest events and both emergencies are held
    And the banner still shows the emergency he has not tapped away
    And the tidying took only a few steps of a cursor

  Scenario: mw-gq6.718 AC-1: events the phone has not projected yet are not cut, however many there are
    Given the phone holds a long history of events, none projected yet
    When the app is shown and tidies its history, at his phone's pace
    Then every event is still held

  Scenario: mw-gq6.718 AC-2: removing the events rows an older build stored does not walk every message
    Given the phone holds a long history of messages and two rows an older build stored from events records
    When the app is shown and tidies its history, at his phone's pace
    Then the stored events rows are gone and every message is still held
    And the tidying took only a few steps of a cursor

  Scenario: mw-gq6.718 AC-3: the lists of messages and the unread count are read without a cursor step for every message held
    Given the phone holds a long history of messages: plain, in threads, Talk turns, call records and cards, some unread
    When every list of messages, the Talk line, the unread count and a thread being read are asked for, at his phone's pace
    Then each list holds the rows it always held, in its own order, and the unread rows of the thread are marked read
    And the reading took only a few steps of a cursor

  Scenario: mw-gq6.719 AC-1: a reply held direct and on chain is told from the rest by one look at each message, and the direct copy stays
    Given the phone holds a very long history of messages, some answers held twice: on chain first, direct first, and a third copy
    When the app is shown and tidies its history, at his phone's pace
    Then every answer held twice is held once, the direct copy, and every other message is still held
    And the twin step read the table once and took only a few steps of a cursor

  Scenario: mw-gq6.719 AC-2: finding the twins among twenty thousand messages takes a fraction of a second
    Given the phone holds twenty thousand messages, a few of them twins
    When the twins among them are asked for
    Then they are named in under 200 milliseconds, and only the chain copies
