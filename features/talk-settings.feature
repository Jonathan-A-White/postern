Feature: Me > Talk: how the mic is worked and when a spoken message goes (mw-06ggew.6)

  Scenario: AC-1: Me has a Talk section with Talk (Hold or Tap) and Send (On release or By button), Hold and On release to begin with
    Given the Me screen is open
    Then the Talk section offers "Talk": "Hold" and "Tap"
    And the Talk section offers "Send": "On release" and "By button"
    And "Hold" is chosen for "Talk" and "On release" is chosen for "Send"

  Scenario: AC-1: choosing Tap and By button changes the compose bar at once, with no reload
    Given the Me screen is open beside the compose bar with its bar out
    When he chooses "Tap" for "Talk"
    And he chooses "By button" for "Send"
    Then the compose bar says it can be tapped to keep the mic on and that the words wait in the box
    And the choices are kept on the device

  Scenario: AC-1: a choice kept before is chosen when Me opens again
    Given "Tap" and "By button" were kept on the device
    When the Me screen is open
    Then "Tap" is chosen for "Talk" and "By button" is chosen for "Send"
