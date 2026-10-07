Feature: The Emergency screen is one tap from Needs you, and each emergency can be read aloud (mw-gq6.285)

  Scenario: mw-gq6.285 AC1: Needs you shows an Emergencies row with the count, and a tap opens the Emergency screen
    Given the phone holds two emergencies, "Disk is full" and "Boost is down"
    When the Needs you screen opens
    Then an "Emergencies · 2" row is shown
    When he taps the "Emergencies · 2" row
    Then the Emergency screen opens and lists "Disk is full" and "Boost is down"

  Scenario: mw-gq6.285 AC1: Needs you shows no Emergencies row when the phone holds none
    Given the phone holds no emergency
    When the Needs you screen opens
    Then no Emergencies row is shown

  Scenario: mw-gq6.285 AC2: each emergency has a Read aloud button that reads its words, then Stop reading
    Given the phone holds one emergency, "Disk is full"
    When the Emergency screen opens
    And he taps "Read aloud" on the emergency
    Then the phone reads "Disk is full" and the button now says "Stop reading"
    When he taps "Stop reading" on the emergency
    Then the phone stops reading and the button says "Read aloud" again
