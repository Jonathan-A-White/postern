Feature: A Search result opens at the thing it found (mw-ev7oyy.38)

  Scenario: mw-ev7oyy.38 AC1: a message older than the channel's first page opens at it, marked
    Given Factory holds 150 messages, and the 20th, older than the newest 60, says "I have this David Allan black book"
    When "Allan" is typed into Search and the Factory message under Messages is tapped
    Then Factory opens with the "David Allan black book" message on the screen, marked as the one found
    And the newest message is not the one marked

  Scenario: mw-ev7oyy.38 AC2: a message on the channel's first page opens at it too
    Given Factory holds 150 messages, and the 140th says "delete coins"
    When "coins" is typed into Search and the Factory message under Messages is tapped
    Then Factory opens with the "delete coins" message on the screen, marked as the one found

  Scenario: mw-ev7oyy.38 sweep: a reply in a thread opens its thread at the reply, marked
    Given Factory holds a post with a reply saying "the Allan chapter is next"
    When "Allan" is typed into Search and the Factory message under Messages is tapped
    Then the thread of the post opens with the "Allan chapter" reply on the screen, marked as the one found

  Scenario: mw-ev7oyy.38 sweep: a message in a bead's channel opens that channel at it, marked
    Given the bead's channel holds 150 messages, and the 20th says "pelican"
    When "pelican" is typed into Search and the message under Messages is tapped
    Then the bead's channel opens with the "pelican" message on the screen, marked as the one found

  Scenario: mw-ev7oyy.38 sweep: a comment result opens its bead at the comment, marked
    Given a bead holds 150 messages and a comment saying "ostrich"
    When "ostrich" is typed into Search and the comment under Descriptions and comments is tapped
    Then the bead opens with the "ostrich" comment on the screen, marked as the one found

  Scenario: mw-ev7oyy.38 sweep: a bead result opens that bead
    Given the view holds the bead "mw-2rbm.10"
    When "BSV library" is typed into Search and the bead under Beads is tapped
    Then the bead screen for "mw-2rbm.10" is opened

  Scenario: mw-ev7oyy.38: a link that names a message the phone does not hold opens the channel as usual
    Given Factory holds 150 messages, and the 20th, older than the newest 60, says "I have this David Allan black book"
    When Factory is opened at a message that is not there
    Then Factory opens at its newest message and nothing is marked
