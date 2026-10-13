Feature: Reminders have their own setting, apart from the factory's notifications (mw-ev7oyy.9)

  Scenario: mw-ev7oyy.9 AC-4: the Me screen has a Reminders section of its own with sound on and quiet hours off
    Given the Me screen is opened
    Then there is a Reminders section apart from the Notifications rows
    And Reminders shows sound on and quiet hours off

  Scenario: mw-ev7oyy.9 AC-4: turning Reminders sound off silences a reminder push and no other class
    Given the Me screen is opened
    When he turns Sound off in Reminders
    Then a reminder push is shown silent
    And a pushed record of class "message" is still not silent

  Scenario: mw-ev7oyy.9 AC-4: quiet hours set on the Me screen silence a reminder push inside them only
    Given the Me screen is opened
    When he turns on quiet hours in Reminders from 22:00 to 07:00
    Then a reminder push at 23:30 is shown silent
    And a reminder push at 12:00 is shown with sound

  Scenario: mw-ev7oyy.9 AC-4: Reset to defaults on the Notifications rows leaves Reminders as he set it
    Given the Me screen is opened
    When he turns Sound off in Reminders
    And he taps "Reset to defaults" on the Notifications rows
    Then Reminders shows sound off
