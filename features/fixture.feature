Feature: Exporting protocol test vectors for millwright's Go port

  Scenario: AC-1: the generator produces every section the Go port needs
    Given the fixture generator runs
    Then the fixture names the fixed inputs
    And the fixture names the encryptMessage output
    And the fixture names the record script hex
    And the fixture names the signed transaction's raw hex and txid

  Scenario: AC-2: the committed fixture matches a fresh run byte-for-byte
    Given the committed fixture file
    When the generator runs again
    Then its serialized output is identical to the committed file

  Scenario: AC-3: protocol.md names the fixture path and generator
    Given docs/protocol.md
    Then it names the committed fixture path
    And it names the generator script
