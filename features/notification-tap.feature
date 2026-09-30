Feature: Tapping a push notification opens the app at what it is about (mw-f758y.25)

  Scenario: mw-f758y.25 AC-1: a message push whose message is already here opens that bead's thread
    Given the phone already holds a decrypted message on the thread of bead "mw-2rbm.10"
    And the Mayor's message push for that message arrives
    When he taps the notification
    Then the app opens at the thread of bead "mw-2rbm.10"

  Scenario: mw-f758y.25 AC-2: a tap with the app already open focuses it and sends it to the thread
    Given the phone already holds a decrypted message on the thread of bead "mw-2rbm.10"
    And the Mayor's message push for that message arrives
    And the app is already open
    When he taps the notification
    Then the open app is focused and told to go to the thread of bead "mw-2rbm.10"

  Scenario: mw-f758y.25 AC-3: a watchdog alarm push opens the alarm itself
    Given the watchdog pushes the alarm "desktop unreachable" with the body "since 09:12Z"
    When he taps the notification
    Then the app opens at an alarm screen showing "desktop unreachable" and "since 09:12Z"

  Scenario: mw-f758y.25 AC-4: a message the phone has not fetched yet lands on a screen that moves to its thread once it arrives
    Given the Mayor's message push arrives for a message the phone does not hold yet
    When he taps the notification
    And the app opens where the notification pointed
    And the message arrives and decrypts on the thread of bead "mw-2rbm.10"
    Then the app moves to the thread of bead "mw-2rbm.10"

  Scenario: mw-f758y.25 AC-5: a message that never arrives falls back to where its class belongs
    Given the Mayor's decision push arrives for a message the phone does not hold yet
    When he taps the notification
    And the app opens where the notification pointed
    And the message does not arrive in time
    Then the app moves to the Needs-you queue

  Scenario: mw-gq6.160 AC-6: a push for a reply whose message is already here opens the reply thread of the post it answers
    Given the phone already holds a General post and the Mayor's reply to it
    And the Mayor's message push for that reply arrives
    When he taps the notification
    Then the app opens at the reply thread of the General post

  Scenario: mw-gq6.160 AC-7: a push for a reply not fetched yet lands on a screen that moves to the reply thread once it arrives
    Given the phone holds a General post
    And the Mayor's message push arrives for a reply the phone does not hold yet
    When he taps the notification
    And the app opens where the notification pointed
    And the reply arrives and decrypts
    Then the app moves to the reply thread of the General post
