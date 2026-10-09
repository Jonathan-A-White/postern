Feature: A live card untouched for 48 hours leaves Needs you for 'Archived cards', where it still updates (mw-v1uyku.1)

  Scenario: mw-v1uyku.1 AC1: a card sent 47 hours ago is still in Needs you
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    When Needs you is opened 47 hours later
    Then the card "Top 5" is in the You list
    And there is no "Archived cards" row

  Scenario: mw-v1uyku.1 AC1: at 49 hours the card is gone from Needs you and listed under Archived cards
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    When Needs you is opened 49 hours later
    Then the card "Top 5" is not in the You list
    And an "Archived cards · 1" row links to the archive

  Scenario: mw-v1uyku.1 AC1: opening the card in the archive shows its items
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    When the archive is opened 49 hours later
    Then the archive lists the card "Top 5" closed, with 0 of 2 done
    When the card "Top 5" is opened in the archive
    Then its items 1 and 2 are shown

  Scenario: mw-v1uyku.1 AC1: an event that ticks an item brings the card back to Needs you
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And Needs you is opened 49 hours later
    When the event that bead "mw-a.1" is verified arrives
    Then the card "Top 5" is in the You list
    And there is no "Archived cards" row

  Scenario: mw-v1uyku.1 AC1: an update brings the card back to Needs you
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And Needs you is opened 49 hours later
    When the Mayor sends a card-update for that card adding the link "mw-b.2" to item 2
    Then the card "Top 5" is in the You list
    And there is no "Archived cards" row

  Scenario: mw-v1uyku.1 AC1: a message that names the card's bead brings it back to Needs you
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And Needs you is opened 49 hours later
    When a message arrives in the thread of bead "mw-b.1"
    Then the card "Top 5" is in the You list

  Scenario: mw-v1uyku.1 AC1: a tap on one of its links counts as touched
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And the card was sent 47 hours ago and Needs you is open
    When he taps the link to bead "mw-b.1"
    And 3 hours pass and Needs you is opened again
    Then the card "Top 5" is in the You list

  Scenario: mw-v1uyku.1 AC1: without a tap the same card is archived at 50 hours
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And the card was sent 47 hours ago and Needs you is open
    When 3 hours pass and Needs you is opened again
    Then the card "Top 5" is not in the You list

  Scenario: mw-v1uyku.1 AC2: a card in the archive keeps ticking, with the archive closed and nothing reloaded
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    And Needs you is opened 49 hours later
    When the event that bead "mw-a.1" is verified arrives
    Then item 1 of the card "Top 5" shows a tick

  Scenario: mw-v1uyku.1: Share still works on a card in the archive
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    When the archive is opened 49 hours later
    And the card "Top 5" is opened in the archive
    Then the card "Top 5" has a Share button

  Scenario: mw-v1uyku.1: Me has an Archived cards row too
    Given the Mayor sent a card titled "Top 5" on beads "mw-a.1" and "mw-b.1"
    When Me is opened 49 hours later
    Then an "Archived cards · 1" row links to the archive
