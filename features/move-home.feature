Feature: One tap moves the factory's home between the desktop and the laptop (mw-43v9x.9)

  Scenario: AC-1: the Me screen shows the home and disables its own button
    Given the view names the desktop as home
    When the Me screen is opened
    Then the Home row shows "desktop"
    And "Move home to desktop" is disabled
    And "Move home to laptop" is enabled

  Scenario: AC-2: nothing is sent until he confirms the move
    Given the view names the desktop as home
    And the Me screen is opened
    When he taps "Move home to laptop"
    Then he is asked "Move the factory's home to laptop? The Mayor there takes over."
    And nothing has been sent
    When he confirms
    Then one move-home message for "laptop" is sent

  Scenario: AC-3: a standby answer offers the move on any screen
    Given the API answers 503 standby with home "desktop"
    When any screen is opened
    Then the status area says "Home is down"
    And it offers "Move home to laptop" but not "Move home to desktop"
