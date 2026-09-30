Feature: General shows N replies under a post; tapping it opens that post's thread, where Reply… answers it (mw-hkg17.2)

  Scenario: mw-hkg17.2: General shows a post once with how many replies it has, and not the replies
    Given a General post "the post" with the replies "first answer" and "second answer"
    When General opens
    Then "the post" is shown once
    And its row says "2 replies"
    And "first answer" is not shown in General

  Scenario: mw-hkg17.2: one reply reads as the singular
    Given a General post "a lone post" with the reply "only answer"
    When General opens
    Then its row says "1 reply"

  Scenario: mw-hkg17.2: tapping N replies opens the thread with the post at the top and the replies below in time order
    Given a General post "the post" with the replies "first answer" and "second answer"
    When General opens
    And the "2 replies" row is tapped
    Then the thread shows "the post", "first answer" and "second answer" in that order
    And the composer says "Reply…"

  Scenario: mw-hkg17.2: Reply on a General post opens its thread
    Given a General post "a question" with no replies
    When General opens
    And Reply is tapped on "a question"
    Then the thread shows "a question"
    And the composer says "Reply…"

  Scenario: mw-hkg17.2: sending from Reply… writes a message whose re is the post's txid, shown in the thread and not at General's top level
    Given a General post "the post" with the reply "first answer"
    When General opens
    And the "1 reply" row is tapped
    And "with a link" is sent from the Reply… composer
    Then the message was sent to General with re set to the txid of "the post"
    And the thread shows "the post", "first answer" and "with a link" in that order
    When Back is tapped
    Then General shows "the post" once and its row says "2 replies"
    And "with a link" is not shown in General

  Scenario: mw-hkg17.2: a bead thread renders as before
    Given a bead thread with the messages "first word" and "second word"
    When the bead thread opens
    Then the thread shows "first word" and "second word" in that order
    And no replies row is shown
    And the composer says "Message the Mayor…"
