Feature: The Talk list's unread: a thread's count, the tab badge, the '· new' marker, and thread titles (mw-xhtcup.11)

  Scenario: AC-1: a thread's unread count is the received rows not yet seen, and drops to 0 once the thread is read
    Given the bead thread "mw-f758y.30.2" holds 2 received rows he has not seen, one he has, and one he sent
    When the thread's unread count is read
    Then the count is 2
    When he reads the bead thread "mw-f758y.30.2"
    Then the bead thread's count is 0

  Scenario: AC-2: the Talk tab badge is the sum of every thread's unread and falls as threads are read
    Given a bead thread holds 2 unseen rows, a channel "launch plan" holds 1 and the Factory thread holds 1
    When the cockpit is open on another place
    Then the Talk tab badge reads "4"
    When he reads the bead thread "mw-f758y.30.2"
    Then the Talk tab badge now reads "2"
    When he reads the channel "launch plan" and the Factory thread
    Then the Talk tab shows no badge

  Scenario: AC-3: a received row not yet seen shows '· new' and a seen one does not
    Given a conversation holds a received row "Unseen words" he has not seen and one "Seen words" he has
    When the conversation is shown
    Then the row "Unseen words" shows "· new"
    And the row "Seen words" shows no "· new"

  Scenario: AC-4: opening a thread marks it seen, so its count is gone from the Talk list after Back
    Given the Talk list shows the bead thread "mw-f758y.30.2" with 2 unseen rows and a channel "launch plan" with 1
    When he opens the bead thread and goes Back
    Then the bead thread's row shows no count
    And the channel "launch plan" still shows its count of 1

  Scenario: AC-5: a thread is titled by the view's bead title, the bead id when the view lacks it, or the channel's name
    Given the view names the bead "mw-f758y.30.2" "GET /api/events streams message and view changes"
    When the Talk list is built for the bead thread, a bead thread the view does not hold, and a channel "launch plan"
    Then the titles are the bead's title, "mw-nowhere.9" and "launch plan"
