Feature: Issuing licences in a burst does not break the Issued licences list (mw-i7cwnn)

  Scenario: mw-i7cwnn AC-1: three licences issued in a row are listed, with no read error
    Given WhatsOnChain refuses requests that start under 350 ms apart or more than 3 in a second
    And the Key screen of an issuer is open
    When I issue licences to three keys in a row
    Then the Issued licences section lists the three licences
    And it does not say the licences could not be read

  Scenario: mw-i7cwnn AC-2: a list that cannot be read for a while keeps the licence just issued and reads again by itself
    Given WhatsOnChain cannot give the new transaction for three seconds
    And the Key screen of an issuer is open
    When I issue a licence to one key
    Then the new licence shows in the Issued licences section as pending
    And it shows as held once the list is read again
    And no error about the licences not being read was shown
