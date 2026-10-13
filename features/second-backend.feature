Feature: A second Postern backend runs under another Linux user, from its own env and data (mw-9rp4hu.3)
  `postern setup` makes one backend per user: its own env file, keys, data directory and user unit,
  with the holder's issuer key shared. These scenarios run the real `postern` binary with a stand-in
  for systemctl.

  Scenario: mw-9rp4hu.3 AC3: setup in a fresh home writes the env, the keys and the unit and starts the unit
    Given the postern binary and a fresh home
    When postern setup runs there with an address and the issuer key
    Then the env file names that address, that issuer key, a data directory under the home and two different keys
    And the user unit is installed and was enabled and started
    And the output prints the Mayor key's public half and no private key

  Scenario: mw-9rp4hu.3 AC3: a second setup in the same home refuses and changes nothing
    Given the postern binary and a fresh home
    When postern setup runs there with an address and the issuer key
    And postern setup runs there again
    Then the second run fails saying the file is already there
    And the env file is unchanged

  Scenario: mw-9rp4hu.3 AC1: two backends from two homes answer health on two ports with different Mayor keys
    Given the postern binary and two homes each set up on its own port
    When both backends are started from their env files
    Then both answer /healthz
    And their Mayor keys differ and so do their data directories
