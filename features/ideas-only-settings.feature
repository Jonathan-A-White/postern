Feature: Settings > Ideas only (mw-8ifimx.3, docs/protocol.md §25)

  The mode is kept on the backend for his key. The Me screen's Ideas only section sets it: presets
  that work the time out on the phone, End now, a weekly schedule and what still reaches him.

  Scenario: mw-8ifimx.3 AC-1: Until 9 pm sets today's 21:00 in the phone's zone
    Given the Me screen is open at 14:00 with Ideas only off
    When "Until 9 pm" is tapped
    Then the backend was told Ideas only until today's 21:00
    And the State row reads "On until Thu 21:00" by the time he set

  Scenario: mw-8ifimx.3 AC-1: after 21:00 Until 9 pm is tomorrow's 21:00
    Given the Me screen is open at 22:00 with Ideas only off
    When "Until 9 pm" is tapped
    Then the backend was told Ideas only until tomorrow's 21:00
    And the State row reads "On until Fri 21:00" by the time he set

  Scenario: mw-8ifimx.3 AC-1: Until 7 am tomorrow sets tomorrow's 07:00
    Given the Me screen is open at 14:00 with Ideas only off
    When "Until 7 am tomorrow" is tapped
    Then the backend was told Ideas only until tomorrow's 07:00
    And the State row reads "On until Fri 07:00" by the time he set

  Scenario: mw-8ifimx.3 AC-1: For an hour sets now plus 3600 seconds
    Given the Me screen is open at 14:00 with Ideas only off
    When "For an hour" is tapped
    Then the backend was told Ideas only until 15:00 today
    And the State row reads "On until Thu 15:00" by the time he set

  Scenario: mw-8ifimx.3 AC-1: Until... takes a date and time he picks
    Given the Me screen is open at 14:00 with Ideas only off
    When "Until..." is tapped, 2026-10-04T18:30 is picked and "Set" is tapped
    Then the backend was told Ideas only until 2026-10-04 18:30 in the phone's zone
    And the State row reads "On until Sun 18:30" by the time he set

  Scenario: mw-8ifimx.3 AC-1: End now sets until to 0
    Given the Me screen is open at 14:00 with Ideas only on until 21:00
    When "End now" is tapped
    Then the backend was told Ideas only until 0
    And the State row reads "Off"

  Scenario: mw-8ifimx.3 AC-1: End now while a schedule window is on says the schedule keeps it on
    Given the Me screen is open at 14:00 with Ideas only on until 21:00 and a schedule window on
    When "End now" is tapped
    Then the backend was told Ideas only until 0
    And the State row reads "On until Thu 23:00" by the schedule
    And the section says the weekly schedule keeps it on

  Scenario: mw-8ifimx.3 AC-2: a weekly schedule on Sunday 09:00 to 21:00 is sent with the phone's zone
    Given the Me screen is open at 14:00 with Ideas only off
    When Sunday is ticked, From is 09:00 and To is 21:00, and "Save schedule" is tapped
    Then the backend was told the schedule in the phone's zone with one window on sun from 09:00 to 21:00

  Scenario: mw-8ifimx.3 AC-2: the two What still reaches me switches are sent
    Given the Me screen is open at 14:00 with Ideas only off
    When "The Mayor's ring" is switched off
    Then the backend was told the ring does not reach him and emergencies do
    When "Emergencies" is switched off
    Then the backend was told neither the ring nor emergencies reach him

  Scenario: mw-8ifimx.3 AC-3: with the backend unreachable the section keeps the last state and says a change could not be saved
    Given the Me screen is open at 14:00 with Ideas only on until 21:00 kept on the phone and the backend down
    Then the State row reads "On until Thu 21:00" kept from before
    When "For an hour" is tapped
    Then the section says it could not be saved
    And the State row reads "On until Thu 21:00" kept from before

  Scenario: mw-8ifimx.3 AC-3: an older backend says it needs a newer backend and its controls are dead
    Given the Me screen is open at 14:00 on a backend that has no Ideas only
    Then the section says Ideas only needs a newer backend
    And "Until 9 pm" cannot be tapped
