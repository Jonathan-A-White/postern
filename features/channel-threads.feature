Feature: Every channel has reply threads: N replies under a post, Reply opens its thread, the bead page shows the same, a notification for a reply lands in it (mw-909ci.2)

  Scenario: mw-6ww.51 Q1: a bead channel shows a post once with 2 replies, not the replies
    Given a post "the post" in the channel of bead "mw-a.1" with the replies "first answer" and "second answer"
    When the channel of bead "mw-a.1" opens
    Then "the post" is shown once
    And its row says "2 replies"
    And "first answer" is not shown in the channel

  Scenario: mw-6ww.51 Q1: a named channel's post shows 1 reply
    Given a post "a lone post" in the named channel "wiring" with the reply "only answer"
    When the named channel "wiring" opens
    Then its row says "1 reply"
    And "only answer" is not shown in the channel

  Scenario: mw-6ww.51 Q1: tapping N replies in a bead channel opens Thread with the post first and its replies in time order, Back returns to the bead channel
    Given a post "the post" in the channel of bead "mw-a.1" with the replies "first answer" and "second answer"
    When the channel of bead "mw-a.1" opens
    And the "2 replies" row is tapped
    Then the screen is titled "Thread" and says "A post in mw-a.1 and its replies"
    And the thread shows "the post", "first answer" and "second answer" in that order
    And the composer says "Reply…"
    When Back is tapped
    Then the channel of bead "mw-a.1" shows "the post" once and its row says "2 replies"

  Scenario: mw-6ww.51 Q1: Reply... in a named channel sends a message whose thread is that channel and whose re is the post's txid, and it shows in the thread, not at the top level
    Given a post "the post" in the named channel "wiring" with the reply "first answer"
    When the named channel "wiring" opens
    And the "1 reply" row is tapped
    And "with a link" is sent from the Reply… composer
    Then the message was sent to the channel "topic:wiring" with re set to the txid of "the post"
    And the thread shows "the post", "first answer" and "with a link" in that order
    When Back is tapped
    Then the named channel "wiring" shows "the post" once and its row says "2 replies"
    And "with a link" is not shown in the channel

  Scenario: mw-6ww.51 Q1: a bead comment stays a post
    Given the channel of bead "mw-f758y.30.2" holds the Builder's comment "a builder note", a post "a question" with the reply "an answer" and a message "an orphan" answering a message that is not here
    When the channel of bead "mw-f758y.30.2" opens
    Then "a builder note", "a question" and "an orphan" are shown as posts in that order
    And "a question" is the only one with a replies row

  Scenario: mw-6ww.51 Q1: the bead page shows the post once with 1 reply linking to the thread, and Reply there opens it
    Given a post "the post" in the channel of bead "mw-f758y.30.2" with the reply "only answer"
    When the page of bead "mw-f758y.30.2" opens
    Then "the post" is shown once
    And its row says "1 reply" and links to the thread of "the post" in that channel
    And "only answer" is not shown in the channel
    When Reply is tapped on "the post"
    Then the thread shows "the post" and "only answer" in that order

  Scenario: mw-6ww.51 Q1: a notification for a reply in a bead channel opens that post's thread
    Given a post "the post" in the channel of bead "mw-a.1" with the reply "first answer"
    When the notification for the reply "first answer" is tapped
    Then the app opens the thread of "the post" in the channel of bead "mw-a.1"

  Scenario: mw-909ci.4: a picture with re is a reply in the post's thread and a transcript is not
    Given a post "the post" in the named channel "wiring" with the picture reply "a screenshot" and the transcript "what was heard"
    When the named channel "wiring" opens
    Then its row says "1 reply"
    And "a screenshot" is not shown in the channel
    When the "1 reply" row is tapped
    Then the thread shows "the post" and "a screenshot" in that order
