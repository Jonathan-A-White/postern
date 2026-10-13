Feature: The issue form says why the balance could not be read, reads it again, and updates it after an Issue (mw-swrev1)

  Scenario: mw-swrev1 AC-1: a refused balance read shows the reason, as the Key screen does
    Given the chain refuses the issuer's balance with "the node is out to lunch"
    When the issue form opens
    Then the cost line reads "Balance unavailable (WhatsOnChain): the node is out to lunch"

  Scenario: mw-swrev1 AC-2: a refused balance read is tried again with growing waits, and a later success shows the balance
    Given the chain refuses the issuer's balance twice and then answers 12345 sats
    When the issue form opens and time passes
    Then the cost line reads "Balance: 12,345 sats."
    And the balance was read three times

  Scenario: mw-swrev1 AC-3: after a successful Issue the balance is read again
    Given the chain answers 50000 sats and then 48000 sats
    When the issue form opens and a licence is issued
    Then the cost line reads "Balance: 48,000 sats."
