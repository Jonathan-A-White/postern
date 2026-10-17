Feature: A card only the home builds reaches the phone within a minute of its event, with no Refresh tap (mw-ev7oyy.39)

  Scenario: mw-ev7oyy.39: the verify card after a landing shows within a minute
    Given the event stream is live and the view was fetched at the start
    When the factory lands a story and the home publishes the view with its verify card 27 seconds later
    Then within a minute of the landing the stored view holds the verify card
    And the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: the approve card after a hold shows within a minute
    Given the event stream is live and the view was fetched at the start
    When the factory holds a live epic's story and the home publishes the view with its approve card 27 seconds later
    Then within a minute of the hold the stored view holds the approve card
    And the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: a hands card for a new bead shows within a minute
    Given the event stream is live and the view was fetched at the start
    When a hitl:hands bead is filed under a story the phone holds and the home publishes the view with its hands card 27 seconds later
    Then within a minute of the filing the stored view holds the hands card
    And the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: a story closing shows its verify card within a minute
    Given the event stream is live and the view was fetched at the start
    When the factory closes a story and the home publishes the view with its verify card 27 seconds later
    Then within a minute of the closing the stored view holds the verify card
    And the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: a bead reopened shows the card it raises within a minute
    Given the event stream is live and the view was fetched at the start
    When the factory reopens a closed story and the home publishes the view with its hands card 27 seconds later
    Then within a minute of the reopening the stored view holds the hands card
    And the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: the view event came before the batch, so the card still shows within a minute
    Given the event stream is live and the view was fetched at the start
    When the home publishes the view with the verify card and its event comes before the batch that names the landing
    Then within a minute of the landing the stored view holds the verify card

  Scenario: mw-ev7oyy.39: a burst of landings in one minute fetches the view once
    Given the event stream is live and the view was fetched at the start
    When ten stories land in one minute and the home publishes the view with their cards
    Then the whole view was fetched twice in all, the second saying card

  Scenario: mw-ev7oyy.39: new beads, claims, jobs and a step closed fetch nothing
    Given the event stream is live and the view was fetched at the start
    When ten minutes pass with the factory busy but nothing that raises a card
    Then the whole view was fetched once in all

  Scenario: mw-ev7oyy.39: a view event that came before the home published the card leaves the quarter-hour window as the last road
    Given the event stream is live and the view was fetched at the start
    When the factory lands a story, a view event comes before the home has published its card, and the home publishes it later without another view event
    Then the view was asked for at the start, saying card on the stale view event, and fifteen minutes after that saying behind, which holds the verify card
