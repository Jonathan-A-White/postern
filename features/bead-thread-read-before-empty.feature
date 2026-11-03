Feature: A bead page never says its conversation is empty before the phone has read it, and a failed local read is retried and said plainly (mw-gq6.901)

  Scenario: mw-gq6.901 AC1: a bead page with no conversation reads Reading while the phone's own read is held back
    Given the phone holds the bead "mw-x.1" and nothing in its conversation and the backend has answered
    And the phone is slow to read the bead's posts
    When the bead "mw-x.1" is opened
    Then "Reading this conversation…" is shown and "No conversation yet" is never shown until the phone has read it
    And "No conversation yet" is then shown

  Scenario: mw-gq6.901 AC3: a bead page with no conversation reads Reading until the first sync has answered
    Given the phone holds the bead "mw-x.1" and nothing in its conversation and the backend has not answered yet
    When the bead "mw-x.1" is opened
    Then "Reading this conversation…" is shown and "No conversation yet" is not
    When the backend answers
    Then it then reads "No conversation yet" and not "Reading this conversation…"

  Scenario: mw-gq6.901 AC2: a bead page says plainly when the backend could not be reached
    Given the phone holds the bead "mw-x.1" and nothing in its conversation and the first sync has failed
    When the bead "mw-x.1" is opened
    Then "Can't reach the Mayor yet" is shown and "No conversation yet" is not

  Scenario: mw-gq6.901 AC2: a bead page whose local read fails says so and then retries it
    Given the phone holds the bead "mw-x.1" and nothing in its conversation and the backend has answered
    And the phone's read of the bead's posts fails once
    When the bead "mw-x.1" is opened
    Then "Couldn't read this conversation on the phone" is shown and "No conversation yet" is not
    And it then reads "No conversation yet" and not "Couldn't read this conversation on the phone"

  Scenario: mw-gq6.901 AC4: a channel whose local read fails says so and then retries it
    Given the phone holds nothing in the channel "quiet" and the backend has answered
    And the phone's read of the channel's posts fails once
    When the channel "quiet" is opened
    Then "Couldn't read this channel on the phone" is shown and "Reading this channel…" is not
    And it then reads "Nothing said here yet" and not "Couldn't read this channel on the phone"

  Scenario: mw-gq6.901 AC4: the share list's channel whose local read fails says so and then retries it
    Given the phone holds nothing in the channel "quiet" and the backend has answered
    And the phone's read of the channel's posts fails once
    When the share list shows the channel "quiet"
    Then "Couldn't read this channel on the phone" is shown and "Reading this channel…" is not
    And it then reads "Nothing said here yet" and not "Couldn't read this channel on the phone"
