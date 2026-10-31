Feature: With the keyboard open he can see what he types (mw-ojmy9q3)

  Scenario: mw-ojmy9q3: the tab bar steps aside while a composer has focus in a short window, so it never covers the text field
    Given the app's stylesheet and shell as shipped
    Then the phone's tab bar is marked, and the wide layout's sidebar is not
    And a window under 35rem tall with a composer holding focus hides the tab bar
    And the rule keys on focus-within, so a tap on Send does not bring the bar back mid-tap

  Scenario: mw-ojmy9q3: the text field never takes more than 28 percent of the window
    Given the app's stylesheet and shell as shipped
    Then the composer's field max height is the smaller of 200px and 28dvh
