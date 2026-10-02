Feature: A live card is one numbered list that ticks itself off and grows in place (mw-nqur1n.11)

  Scenario: mw-nqur1n.11: a card record shows its items with their links in Needs you
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    Then the card "Top 5" is in the You list
    And its items are numbered 1, 2 and 3 with their texts
    And item 2 links to bead "mw-b.1"

  Scenario: mw-debsil.1: a web address and a bead id in an item are links as in a message
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with an item "Install https://example.com/x.apk then see mw-gq6.222"
    Then item 1 has a link to "https://example.com/x.apk" that opens in a new tab
    And item 1 has a link to bead "mw-gq6.222" in the app

  Scenario: mw-nqur1n.11: a bead event for an item's expected state ticks it with the time and fetches nothing
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    When the event that bead "mw-a.1" is verified arrives
    Then item 1 shows a tick and the time as HH:MM
    And items 2 and 3 have no tick
    And the view was not fetched

  Scenario: mw-nqur1n.11: an event for another state of the bead ticks nothing
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    When the event that bead "mw-a.1" is claimed arrives
    Then no item shows a tick

  Scenario: mw-nqur1n.11: a card-update adds a link to item 2 and the same card shows it
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    When the Mayor sends a card-update for that card adding the link "mw-b.2" to item 2
    Then item 2 links to bead "mw-b.1" and to bead "mw-b.2"
    And there is still one card "Top 5" in the You list
    And the view was not fetched

  Scenario: mw-nqur1n.11: a card-update adds a new item to the same card
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    When the Mayor sends a card-update for that card adding item 4 "Look at the door" on bead "mw-d.1"
    Then the card "Top 5" has four items and the fourth reads "Look at the door"

  Scenario: mw-nqur1n.11: a card whose items are all done moves from You to Done
    Given Needs you is open and the Mayor has sent a card titled "Top 5" with three items on beads "mw-a.1", "mw-b.1" and "mw-c.1"
    When the events that "mw-a.1", "mw-b.1" and "mw-c.1" are verified arrive
    Then the card "Top 5" is no longer in the You list
    And a Done section reads "Done · 1" and lists the card "Top 5"

  Scenario: mw-nqur1n.11: a card shows in the thread it was sent to
    Given the Mayor has sent a card titled "Top 5" to the thread of bead "mw-t.1" with an item on bead "mw-a.1"
    When the bead's channel opens
    Then the channel shows the card "Top 5" with its item
    And the card is not shown as a message
