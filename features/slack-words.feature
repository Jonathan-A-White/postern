Feature: Postern says channel and thread, and shows no topic and no hash mark (mw-909ci.5)

  Scenario: mw-6ww.51 Q2: the Talk list is titled Channels with New channel and Find a channel
    Given the factory is live with a channel named "desktop move"
    When Talk is opened on the list
    Then the screen is titled "Channels" and says "Every channel with the Mayor"
    And the list offers a "New channel" button and a "Find a channel" search box

  Scenario: mw-6ww.51 Q2: the Share screen offers New channel
    Given the factory is live with a channel named "desktop move"
    When a screenshot is shared and the Share screen is opened
    Then the first row of Where to says "New channel"

  Scenario: mw-6ww.51 Q2: a named channel's subtitle reads Channel
    Given the factory is live with a channel named "desktop move"
    When the channel "desktop move" is opened
    Then the screen is titled "desktop move" and its subtitle reads "Channel"

  Scenario: mw-6ww.51 Q2: an open channel offers Archive channel
    Given the factory is live with a channel named "desktop move"
    When the channel "desktop move" is opened
    Then the screen offers "Archive channel"

  Scenario: mw-6ww.51 Q3: no screen shows topic or a # before a channel name
    Given the factory is live with a channel named "desktop move"
    When the Talk list, a channel, a thread and the Share screen are each opened
    Then none of them shows the word topic
    And no channel title starts with a hash mark

  Scenario: mw-6ww.51: an old thread link still lands in that channel
    Given the factory is live with a channel named "desktop move"
    When the old link "?screen=thread&thread=bead%3Amw-f758y.30.2" is opened
    Then the channel of "mw-f758y.30.2" is open with the title "GET /api/events streams message and view changes" and the Archive channel button
