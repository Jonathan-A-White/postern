Feature: An opened channel shows the posts the phone holds at once, never an empty state first, and the list and the pane agree on Factory's posts (mw-gq6.265)

  Scenario: mw-gq6.265 AC1: Factory opens with its posts on the first paint while the phone is still reading
    Given the phone holds the Factory post "Factory first post"
    And the Channels list is open
    And the phone is slow to read one channel's posts
    When Factory is opened from the list
    Then "Factory first post" is shown at once
    And "Nothing said here yet" is never shown

  Scenario: mw-gq6.265 AC1: a bead channel opens with its posts on the first paint while the phone is still reading
    Given the phone holds the post "Bead first post" in the channel of bead "mw-f758y.30.2"
    And the Channels list is open
    And the phone is slow to read one channel's posts
    When the channel of bead "mw-f758y.30.2" is opened from the list
    Then "Bead first post" is shown at once
    And "Nothing said here yet" is never shown

  Scenario: mw-gq6.265 AC2: a Factory post stored with a null thread is in the list's preview and in the Factory pane
    Given the phone holds the Factory post "Null thread post" stored with a null thread
    And the Channels list is open
    Then the Factory row previews "Null thread post"
    When Factory is opened from the list
    Then "Null thread post" is shown once the phone has read the channel

  Scenario: mw-gq6.265 AC3: a channel with no posts still says Nothing said here yet
    Given the phone holds the Factory post "Only Factory post"
    And the Channels list is open
    When the named channel "quiet" is opened from the list
    Then "Nothing said here yet" is shown once the phone has read the channel
