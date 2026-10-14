Feature: A card is a thread root like any post (mw-q6n8m0.13)

  The Mayor answers a card in its thread (a reply whose re is the card). Tapping the notification
  for that reply, or opening the thread any other way, shows the card with the reply under it, never
  "That post is not on this phone".

  Scenario: mw-q6n8m0.13 AC-1: the notification for a reply to a live card opens a Thread showing the card and the reply
    Given the phone holds the live card "Your ideas from Ideas only (4)" in Factory
    And the Mayor has replied to it with "Four ideas, all recorded"
    When he taps the notification for that reply
    Then the Thread opens on the card
    And the Thread shows the card "Your ideas from Ideas only (4)" and under it "Four ideas, all recorded"
    And the Thread does not say "That post is not on this phone"

  Scenario: mw-q6n8m0.13 AC-2: a plain post is a thread root
    Given the phone holds the post "the post" in Factory
    And the Mayor has replied to it with "the answer"
    When he taps the notification for that reply
    Then the Thread opens on the post
    And the Thread shows the post "the post" and under it "the answer"

  Scenario: mw-q6n8m0.13 AC-2: a live card sent to a bead's channel opens its Thread in that channel
    Given the phone holds the live card "Top 5" in the channel of bead "mw-t.1"
    And the Mayor has replied to it with "Look at the first"
    When he taps the notification for that reply
    Then the Thread opens on the card in the channel of bead "mw-t.1"
    And the Thread shows the card "Top 5" and under it "Look at the first"

  Scenario: mw-q6n8m0.13 AC-2: a reply to a card-update is a reply to its card
    Given the phone holds the live card "Top 5" in Factory
    And the Mayor has updated that card
    And the Mayor has replied to the update with "About the change"
    When he taps the notification for that reply
    Then the Thread opens on the card
    And the Thread shows the card "Top 5" and under it "About the change"

  Scenario: mw-q6n8m0.13 AC-2: a decision card is a thread root
    Given the phone holds the decision card "Where should it live?" on bead "mw-q"
    And the Mayor has replied to it with "I will wait for you"
    When he taps the notification for that reply
    Then the Thread opens on the decision card in the channel of bead "mw-q"
    And the Thread shows the decision card and under it "I will wait for you"

  Scenario: mw-q6n8m0.13 AC-2: his own message, held by Ideas only, is a thread root
    Given the phone holds his own message "an idea about maps" in Factory
    And the Mayor has replied to it with "Recorded for later"
    When he taps the notification for that reply
    Then the Thread opens on his message
    And the Thread shows his message "an idea about maps" and under it "Recorded for later"

  Scenario: mw-q6n8m0.13 AC-2: a card with no reply yet still opens as a Thread, with the card and the composer
    Given the phone holds the live card "Top 5" in Factory
    When the Thread of that card is opened from a link
    Then the Thread shows the card "Top 5"
    And the Thread does not say "That post is not on this phone"
    And the Thread offers a Reply box
