Feature: A share can land in any channel, or in a post's thread inside one (mw-909ci.4)

  Scenario: mw-6ww.51: Threads on Factory lists its 5 newest posts with their reply counts
    Given the factory is live and two screenshots were shared into Postern
    And the Factory has the posts "post one" to "post six", and "post five" has 2 replies
    When the Share screen is opened and "Threads in Factory" is tapped
    Then under Factory come "post six", "post five", "post four", "post three" and "post two" in that order
    And "post five" says "2 replies" and "post six" says no replies
    When "Threads in Factory" is tapped again
    Then no posts are listed under Factory

  Scenario: mw-6ww.51: picking a post opens its Thread with both shared images in the Reply... composer, and the parked share is gone
    Given the factory is live and two screenshots were shared into Postern
    And the Factory has the posts "post one" to "post six", and "post five" has 2 replies
    When the Share screen is opened and "Threads in Factory" is tapped and the post "post six" is tapped
    Then the Thread of "post six" opens at "?v=talk&t=general&r=" followed by its txid
    And the Reply... composer holds both screenshots
    And the parked share is gone

  Scenario: mw-6ww.51: sending from there writes ONE message with re = the post's txid and both files in attachments, shown as one reply in the thread and counted in N replies
    Given the factory is live and two screenshots were shared into Postern
    And the Factory has the posts "post one" to "post six", and "post five" has 2 replies
    When the Share screen is opened and "Threads in Factory" is tapped and the post "post five" is tapped
    And Send is tapped in the Reply... composer
    Then one message was delivered, with re set to the txid of "post five" and both files in attachments
    And the Thread shows "post five", its 2 replies and one reply holding two images
    When Back is tapped
    Then the Factory shows "post five" once and its row says "3 replies"

  Scenario: mw-6ww.51: the same in a bead's channel
    Given the factory is live and two screenshots were shared into Postern
    And the bead channel of "mw-f758y.30.2" has the post "a bead post"
    When the Share screen is opened and "Threads in GET /api/events streams message and view changes" is tapped and the post "a bead post" is tapped
    Then the Thread of "a bead post" opens at "?v=talk&t=bead%3Amw-f758y.30.2&r=" followed by its txid
    And the Reply... composer holds both screenshots
    When Send is tapped in the Reply... composer
    Then one message was delivered, with re set to the txid of "a bead post" and both files in attachments

  Scenario: mw-6ww.51: tapping the channel row itself still opens the channel with the files
    Given the factory is live and two screenshots were shared into Postern
    When the Share screen is opened and the "Factory" row is tapped
    Then the channel opens at "?v=talk&t=general"
    And the composer holds both screenshots

  Scenario: mw-6ww.51: choosing a thread remembers its channel as Last used
    Given the factory is live and two screenshots were shared into Postern
    And the bead channel of "mw-f758y.30.2" has the post "a bead post"
    When the Share screen is opened and "Threads in GET /api/events streams message and view changes" is tapped and the post "a bead post" is tapped
    And two screenshots are shared into Postern again and the Share screen is opened
    Then the first row says "New topic" and the second is "GET /api/events streams message and view changes" marked "Last used"
