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
