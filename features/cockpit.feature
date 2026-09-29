Feature: The Governor's cockpit (plans/0021)

  Scenario: plans/0021 AC-1 (decision 8): the queue shows every kind of need, most blocking first, the recommendation first
    Given the factory is live and his key is unlocked
    When the cockpit opens
    Then the first need is the question "Where should the BSV library live?" with "New repo bsv-kit (recommended)" as its first answer
    And the queue also holds an approval, a step for his hands, a landing to verify and an alarm

  Scenario: plans/0021 AC-2 (decisions 7, 8): tapping the recommendation answers the question and it leaves the queue
    Given the factory is live and his key is unlocked
    When the cockpit opens
    And "New repo bsv-kit (recommended)" is tapped
    Then a reply naming "mw-2rbm.10" with the answer "New repo bsv-kit" is delivered directly to the Mayor
    And the question leaves the queue

  Scenario: plans/0021 AC-3 (decision 7): releasing held work is one tap
    Given the factory is live and his key is unlocked
    When the cockpit opens
    And "Release" is tapped on the approval
    Then a release action for "mw-f758y.31" is delivered directly to the Mayor

  Scenario: plans/0021 AC-4 (decision 10): unread words from the Mayor read as words, not JSON
    Given the factory is live and his key is unlocked
    When the cockpit opens
    Then "Unread from the Mayor" shows the question as "Where should the BSV library live?"

  Scenario: plans/0021 AC-5 (decision 9): the map zooms from the factory to an epic's board
    Given the factory is live and his key is unlocked
    When the map is opened
    Then the two maps are listed before the epics
    When the epic "mw-f758y.30" is opened as a board
    Then its work sits in the columns Working, Ready and Blocked

  Scenario: plans/0021 AC-6 (decisions 9, 10): a bead's page holds its detail and its whole conversation
    Given the factory is live and his key is unlocked
    When the bead "mw-f758y.30.2" is opened
    Then its acceptance criteria, its path and a Builder's comment are shown
    And the voice note shows what was heard in it

  Scenario: mw-f758y.24: an image he attached shows once, as his message, never as a desktop path
    Given the factory is live and his key is unlocked
    When the bead "mw-f758y.30.2" is opened
    Then the image he attached is shown once, with his words
    And no desktop path is shown

  Scenario: plans/0021 AC-7 (decision 10): what he says on a bead's page goes to that bead's thread
    Given the factory is live and his key is unlocked
    When the bead "mw-f758y.30.2" is opened
    And "use 20 seconds instead" is sent from its composer
    Then a message in the thread of "mw-f758y.30.2" saying "use 20 seconds instead" is delivered directly

  Scenario: plans/0021 AC-8 (decision 13): one search finds beads and messages
    Given the factory is live and his key is unlocked
    When "ping" is searched
    Then beads and messages that mention it are listed in their own groups

  Scenario: plans/0021 AC-9 (decision 14): one unlock lasts the day, across a relaunch
    Given the factory is live and his key was unlocked earlier today
    When the app relaunches
    Then it opens on the queue without asking to unlock

  Scenario: plans/0021 AC-10 (decision 12): a file shared from another app goes to the thread he picks
    Given the factory is live and his key is unlocked
    And an image was shared into Postern from another app
    When the Share screen is opened and "Factory" is chosen
    Then the Factory thread opens with the image waiting in its composer

  Scenario: plans/0021 AC-11 (his hands, 2026-09-28): a step for his hands is approved from the queue and delivered signed
    Given the factory is live and his key is unlocked
    When the cockpit opens
    And "Approve and run" is tapped on the step "linger" and confirmed
    Then a run action for step "linger" of "mw-f758y.8" is delivered, signed by his key over that exact step
    And a step that already ran shows its outcome instead of the buttons

  Scenario: mw-f758y.23: the map's list shows the newest activity first, not the oldest ids
    Given the factory is live and his key is unlocked
    When the epic "mw-f758y.30" is opened as a list
    Then its work is listed newest activity first

  Scenario: mw-t64a3.1: a reply on an alarm with no bead says it went to Factory, and Open shows that thread
    Given the factory is live with an alarm that names no bead and his key is unlocked
    When the cockpit opens
    And "On it, thanks" is sent as a reply on the alarm
    Then a toast says "Sent to the Mayor in Factory"
    When "Open" is tapped on the toast
    Then the Talk thread "Factory" shows "On it, thanks" and the Mayor's earlier "Good morning" message

  Scenario: mw-t64a3.1: a reply on a bead's card says it went to that bead, and Open shows its thread
    Given the factory is live and his key is unlocked
    When the cockpit opens
    And "Hold this one" is sent as a reply on the approval
    Then a toast says "Sent to the Mayor in mw-f758y.31"
    When "Open" is tapped on the toast
    Then the Talk thread "mw-f758y.31" shows "Hold this one"

  Scenario: mw-t64a3.3: one tap on Release sends once, shows it was sent at once, and cannot be tapped again
    Given the factory is live and his key is unlocked
    And the backend is slow to take a message
    When the cockpit opens
    And "Release" is tapped twice on the approval
    Then one release action for "mw-f758y.31" is sent
    And the approval says it was sent and is waiting for the factory, with no Release button to tap

  Scenario: mw-t64a3.3: a failed send says so on the card and gives the button back
    Given the factory is live and his key is unlocked
    And the backend refuses the next message
    When the cockpit opens
    And "Release" is tapped on the approval
    Then a toast says "The backend refused the message."
    And the approval offers "Release" again

  Scenario: mw-t64a3.3: one tap on Verified on the bead's page sends once and cannot be tapped again
    Given the factory is live and his key is unlocked
    And the backend is slow to take a message
    When the bead "mw-gq6.130" is opened
    And "Verified" is tapped twice on the bead's page
    Then one verified action for "mw-gq6.130" is sent
    And the bead's page says it was sent and is waiting for the factory, with no Verified button to tap
