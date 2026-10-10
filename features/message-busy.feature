Feature: A message sent as a transaction says plainly when WhatsOnChain is busy (mw-qkb7yp)
  A backend without direct delivery gets a message as a transaction, which the backend broadcasts. A busy WhatsOnChain is tried again from the
  outbox, and the message says so in one plain line; the provider's own page and its "said 429" are never printed.

  Scenario: mw-qkb7yp AC-1: a busy broadcast twice then taken sends the message, with the busy line in between
    Given the backend takes messages only as transactions and its broadcast answers WhatsOnChain's busy 502 twice, then takes it
    And the Talk channel "ops" is open
    When he sends "Ship it" from the composer
    Then the thread shows "Ship it" with the line "WhatsOnChain is busy, trying again…"
    And the screen shows none of WhatsOnChain's page and no "said 429"
    When the phone hears it is online again
    Then the line under "Ship it" still reads "WhatsOnChain is busy, trying again…"
    When the phone hears it is online once more
    Then the broadcast has been tried three times
    And the thread shows "Ship it" with no line about WhatsOnChain
    And the page of WhatsOnChain and "said 429" are still nowhere on the screen

  Scenario: mw-qkb7yp AC-2: a broadcast that stays busy keeps one plain line under the message
    Given the backend takes messages only as transactions and its broadcast answers WhatsOnChain's busy 502 every time
    And the Talk channel "ops" is open
    When he sends "Ship it" from the composer
    And the phone hears it is online again
    And the phone hears it is online once more
    Then the thread shows "Ship it" with the line "WhatsOnChain is busy, trying again…"
    And the thread shows that line once
    And the screen shows none of WhatsOnChain's page and no "said 429"

  Scenario: mw-qkb7yp AC-2: a provider page on a 500 becomes one plain line
    Given the backend takes messages only as transactions and its broadcast answers a 502 relaying WhatsOnChain's 500 page every time
    And the Talk channel "ops" is open
    When he sends "Ship it" from the composer
    Then the thread shows "Ship it" with the line "WhatsOnChain answered 500. Try again in a minute."
    And the screen shows none of WhatsOnChain's page and no "said 500"

  Scenario: mw-qkb7yp AC-2: a broadcast the backend refuses for good says so in its words, with Retry and Discard
    Given the backend takes messages only as transactions and its broadcast answers 400 "the transaction was rejected"
    And the Talk channel "ops" is open
    When he sends "Ship it" from the composer
    Then the thread shows "Ship it" marked "Not sent: the transaction was rejected" with Retry and Discard
