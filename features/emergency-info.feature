Feature: An emergency tells him its words: the tap opens them, and an information emergency shows in the banner for ten minutes (mw-gq6.277)

  Scenario: mw-gq6.277: tapping the emergency notification opens the emergency's words, who sent it and when
    Given the Mayor's information emergency "Mayor: the Talk answer is fixed" is held on the phone
    When he taps the emergency notification
    Then the Emergency screen shows "Mayor: the Talk answer is fixed"
    And the Emergency screen names the actor "mayor@laptop" and the time

  Scenario: mw-gq6.277: an information emergency whose job is done shows in the banner, and Dismiss takes it away without leaving the screen
    Given the Map is open on a phone
    When the sync pages the Mayor's information emergency "Mayor: the Talk answer is fixed" from a minute ago
    Then the banner at the top of the Map says "Mayor: the Talk answer is fixed"
    When he dismisses the banner
    Then the banner is gone
    And the Map is still open

  Scenario: mw-gq6.277: an information emergency from more than ten minutes ago shows no banner
    Given the Map is open on a phone
    When the sync pages the Mayor's information emergency "Mayor: the Talk answer is fixed" from eleven minutes ago
    Then no banner shows

  Scenario: mw-gq6.277: a failed emergency from more than ten minutes ago still shows until it is cleared
    Given the Map is open on a phone
    When the sync pages the doctor's failed emergency "Boost is down" from eleven minutes ago
    Then the banner at the top of the Map says "Boost is down"
