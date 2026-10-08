Feature: The Mayor's answer reaches a phone whose app is in the background (mw-j0f2d.38)

  Scenario: mw-j0f2d.38 AC-2: a talk answer's push shows "The Mayor answered" when the app is not on his screen
    Given the app is open but hidden
    When the push for a talk answer arrives
    Then a notification titled "The Mayor answered" is shown with none of the answer's words

  Scenario: mw-j0f2d.38 AC-2b: a talk answer's push shows nothing while the app is on his screen
    Given the app is focused and visible
    When the push for a talk answer arrives
    Then no talk notification is shown

  Scenario: mw-j0f2d.38 AC-2c: a tap on the talk answer's notification opens the Talk line
    Given the app is open but hidden
    And the push for a talk answer arrives
    When he taps the notification
    Then the app is sent to the Talk line

  Scenario: mw-q6n8m0.2 AC-2d: another message's push, while the Talk line is on his screen, shows without sound or buzz
    Given the Talk line is focused and visible
    When the push for a landing arrives
    Then a notification is shown that is silent and does not vibrate

  Scenario: mw-q6n8m0.2 AC-2e: another message's push still sounds when a different place is on his screen
    Given the Needs you place is focused and visible
    When the push for a landing arrives
    Then a notification is shown that is not silent

  Scenario: mw-q6n8m0.2 AC-2f: the Mayor's ring still rings while the Talk line is on his screen
    Given the Talk line is focused and visible
    When the push for a ring arrives
    Then a notification is shown that is not silent
